import { DesignMap } from "./design-map.js";
import { AgentMemoryStore, type ParallelAgentRecommendation, type TrimRecommendationItem } from "./agent-memory.js";
import { HarnessRegistry } from "./harness.js";
import { MicroSession, type EndSessionInput, type MicroSessionInit } from "./session.js";
import type { DesignMapNodeContent, ReviewMode } from "./types.js";

export interface DesignMapOutcome {
  mode: ReviewMode;
  recommendation: { nodeId: string; content: DesignMapNodeContent }[];
  committed: boolean;
  /** Manual mode: commit some/all of the recommendation. Auto mode: already committed. */
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

  constructor(
    designMap: DesignMap = new DesignMap(),
    harnesses: HarnessRegistry = new HarnessRegistry(),
    agentMemories: AgentMemoryStore = new AgentMemoryStore(),
  ) {
    this.designMap = designMap;
    this.harnesses = harnesses;
    this.agentMemories = agentMemories;
  }

  /** Scope a new micro session to a design-map branch and equip it with agents. */
  startSession(init: MicroSessionInit): MicroSession {
    this.designMap.requireNode(init.branchNodeId);
    for (const agent of init.agents) {
      this.harnesses.requireHarness(agent.harnessId);
    }
    return new MicroSession(init);
  }

  /**
   * End a session and produce the two independent update branches (design
   * map, agent memory). Auto-mode branches commit immediately; manual-mode
   * branches return a recommendation the caller commits via `.apply()`.
   */
  endSession(session: MicroSession, input: EndSessionInput): SessionOutcome {
    session.end();
    const threshold = input.trimThreshold ?? 0.4;

    const applyDesignMap = (selectedNodeIds?: string[]) => {
      const toApply = selectedNodeIds
        ? input.designMapUpdates.filter((u) => selectedNodeIds.includes(u.nodeId))
        : input.designMapUpdates;
      for (const update of toApply) {
        this.designMap.update(update.nodeId, update.content, { sessionId: session.id });
      }
    };
    const designMapMode = session.reviewMode.designMap;
    if (designMapMode === "auto") applyDesignMap();
    const designMap: DesignMapOutcome = {
      mode: designMapMode,
      recommendation: input.designMapUpdates,
      committed: designMapMode === "auto",
      apply: applyDesignMap,
    };

    const recommendation: Record<string, TrimRecommendationItem[]> = {};
    const parallelAgentRecommendations: Record<string, ParallelAgentRecommendation[]> = {};
    for (const update of input.agentMemoryUpdates) {
      const memory = this.agentMemories.getOrCreate(update.agentId);
      recommendation[update.agentId] = memory.evaluateCandidates(update.retain, session.id, threshold);
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
