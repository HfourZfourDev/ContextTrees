import { DesignMap } from "./design-map.js";
import type { DesignMapNode } from "./types.js";
import { AgentMemoryStore, type ParallelAgentRecommendation, type RetainInput, type TrimRecommendationItem } from "./agent-memory.js";
import { HarnessRegistry } from "./harness.js";
import { MicroSession, type ActivationUpdateRequest, type EndSessionInput, type MicroSessionInit } from "./session.js";
import type { DesignMapNodeContent, ReviewMode } from "./types.js";
import { KeywordOverlapScorer } from "./scoring/keyword-overlap.js";
import type { RelevanceScorer } from "./scoring/types.js";

/** What a caller supplies to start a session — `context`/`contextText` are computed by the director, not passed in. */
export type StartSessionInput = Omit<MicroSessionInit, "context" | "contextText">;

export interface DesignMapOutcome {
  mode: ReviewMode;
  recommendation: { nodeId: string; content: DesignMapNodeContent }[];
  activationRequests: ActivationUpdateRequest[];
  committed: boolean;
  /** Manual mode: commit some/all of the recommendation (content and activation updates alike). Auto mode: already committed. */
  apply: (selectedNodeIds?: string[]) => void;
}

export interface AgentMemoryOutcome {
  mode: ReviewMode;
  recommendation: Record<string, TrimRecommendationItem[]>;
  parallelAgentRecommendations: Record<string, ParallelAgentRecommendation[]>;
  committed: boolean;
  /** Manual mode: commit some/all of the recommendation, keyed by agentId -> concepts to retain. */
  apply: (selected?: Record<string, string[]>) => void;
}

export interface SessionOutcome {
  session: MicroSession;
  designMap: DesignMapOutcome;
  agentMemory: AgentMemoryOutcome;
}

/**
 * Macro agent: routes design-map context into micro sessions and reconciles
 * their outcomes back. Owns the design map, harness registry, and per-agent
 * memories — the persistent state a director maintains coherence over.
 */
export class Director {
  readonly designMap: DesignMap;
  readonly harnesses: HarnessRegistry;
  readonly agentMemories: AgentMemoryStore;
  /** Computes relevanceScore for retain candidates that don't supply one. Defaults to the no-model keyword scorer. */
  readonly scorer: RelevanceScorer;

  constructor(
    designMap: DesignMap = new DesignMap(),
    harnesses: HarnessRegistry = new HarnessRegistry(),
    agentMemories: AgentMemoryStore = new AgentMemoryStore(),
    scorer: RelevanceScorer = new KeywordOverlapScorer(),
  ) {
    this.designMap = designMap;
    this.harnesses = harnesses;
    this.agentMemories = agentMemories;
    this.scorer = scorer;
  }

  /**
   * Scope a new micro session to a design-map branch and equip it with
   * agents. Context passed to the session is assembled here: the branch's
   * own active subtree in full, plus whatever it references via edges, at
   * each edge's prune level — not the whole map.
   */
  startSession(init: StartSessionInput): MicroSession {
    this.designMap.requireNode(init.branchNodeId);
    if (!this.designMap.isActive(init.branchNodeId)) {
      throw new Error(
        `Director.startSession: node "${init.branchNodeId}" is dormant — reactivate it (designMap.activate) before scoping a session to it`,
      );
    }
    for (const agent of init.agents) {
      this.harnesses.requireHarness(agent.harnessId);
    }
    const context = this.designMap.assembleContext(init.branchNodeId);
    const contextText = this.designMap.contextText(context);
    return new MicroSession({ ...init, context, contextText });
  }

  /** Dormant nodes for review — stored, excluded from context passes, never deleted. Scope to a branch or omit for the whole map. */
  auditDormantBranches(rootId?: string): DesignMapNode[] {
    return this.designMap.dormantNodes(rootId);
  }

  /**
   * End a session and produce the two independent update branches (design
   * map, agent memory). Auto-mode branches commit immediately; manual-mode
   * branches return a recommendation the caller commits via `.apply()`.
   */
  async endSession(session: MicroSession, input: EndSessionInput): Promise<SessionOutcome> {
    session.end();
    const threshold = input.trimThreshold ?? 0.4;
    const branchContext = session.contextText;
    const activationUpdates = input.activationUpdates ?? [];

    const applyDesignMap = (selectedNodeIds?: string[]) => {
      const contentToApply = selectedNodeIds
        ? input.designMapUpdates.filter((u) => selectedNodeIds.includes(u.nodeId))
        : input.designMapUpdates;
      for (const update of contentToApply) {
        this.designMap.update(update.nodeId, update.content, { sessionId: session.id });
      }

      const activationToApply = selectedNodeIds
        ? activationUpdates.filter((u) => selectedNodeIds.includes(u.nodeId))
        : activationUpdates;
      for (const update of activationToApply) {
        const opts = { reason: update.reason, sessionId: session.id };
        if (update.active) this.designMap.activate(update.nodeId, opts);
        else this.designMap.deactivate(update.nodeId, opts);
      }
    };
    const designMapMode = session.reviewMode.designMap;
    if (designMapMode === "auto") applyDesignMap();
    const designMap: DesignMapOutcome = {
      mode: designMapMode,
      recommendation: input.designMapUpdates,
      activationRequests: activationUpdates,
      committed: designMapMode === "auto",
      apply: applyDesignMap,
    };

    const recommendation: Record<string, TrimRecommendationItem[]> = {};
    const parallelAgentRecommendations: Record<string, ParallelAgentRecommendation[]> = {};
    for (const update of input.agentMemoryUpdates) {
      const memory = this.agentMemories.getOrCreate(update.agentId);
      const resolved: RetainInput[] = await Promise.all(
        update.retain.map(async (candidate) => ({
          concept: candidate.concept,
          content: candidate.content,
          sessionId: session.id,
          timestamp: candidate.timestamp,
          reuseScore: candidate.reuseScore,
          relevanceScore:
            candidate.relevanceScore ??
            (await this.scorer.scoreRelevance({ content: candidate.content, branchContext })),
        })),
      );
      recommendation[update.agentId] = memory.evaluateCandidates(resolved, session.id, threshold);
    }

    const applyAgentMemory = (selected?: Record<string, string[]>) => {
      for (const update of input.agentMemoryUpdates) {
        const memory = this.agentMemories.getOrCreate(update.agentId);
        const items = recommendation[update.agentId] ?? [];
        const selectedConcepts = selected?.[update.agentId];
        for (const item of items) {
          const shouldRetain = selectedConcepts ? selectedConcepts.includes(item.group.concept) : item.action === "retain";
          if (!shouldRetain) continue;
          memory.retain({
            concept: item.group.concept,
            content: item.group.content,
            relevanceScore: item.group.relevanceScore,
            reuseScore: item.group.reuseScore,
            sessionId: session.id,
          });
        }
        parallelAgentRecommendations[update.agentId] = memory.recommendParallelAgents();
      }
    };
    const agentMemoryMode = session.reviewMode.agentMemory;
    if (agentMemoryMode === "auto") applyAgentMemory();
    // Manual mode: parallel-agent recommendations are computed against
    // pre-existing memory only, since candidates aren't committed yet.
    if (agentMemoryMode === "manual") {
      for (const update of input.agentMemoryUpdates) {
        const memory = this.agentMemories.getOrCreate(update.agentId);
        parallelAgentRecommendations[update.agentId] = memory.recommendParallelAgents();
      }
    }

    const agentMemory: AgentMemoryOutcome = {
      mode: agentMemoryMode,
      recommendation,
      parallelAgentRecommendations,
      committed: agentMemoryMode === "auto",
      apply: applyAgentMemory,
    };

    return { session, designMap, agentMemory };
  }
}
