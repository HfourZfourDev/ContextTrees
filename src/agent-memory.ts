import type { AgentLineage, RetainedContextGroup } from "./types.js";

let groupCounter = 0;
function nextGroupId(): string {
  groupCounter += 1;
  return `ctx_${groupCounter}_${Date.now().toString(36)}`;
}

export interface RetainInput {
  concept: string;
  content: string;
  sessionId: string;
  relevanceScore: number;
  reuseScore: number;
  timestamp?: number;
}

export type TrimAction = "retain" | "drop";

export interface TrimRecommendationItem {
  group: RetainedContextGroup;
  action: TrimAction;
  score: number;
  reason: string;
}

export interface ParallelAgentRecommendation {
  concept: string;
  group: RetainedContextGroup;
  reason: string;
}

function scoreGroup(group: RetainedContextGroup, threshold: number): TrimRecommendationItem {
  const score = (group.relevanceScore + group.reuseScore) / 2;
  const action: TrimAction = score >= threshold ? "retain" : "drop";
  const reason =
    action === "retain"
      ? `relevance ${group.relevanceScore.toFixed(2)} + reuse ${group.reuseScore.toFixed(2)} >= threshold ${threshold}`
      : `relevance ${group.relevanceScore.toFixed(2)} + reuse ${group.reuseScore.toFixed(2)} < threshold ${threshold}`;
  return { group, action, score, reason };
}

/**
 * Per-agent retained-context store. Conflicting groups on the same concept
 * are versioned (append-only), never overwritten — `current` surfaces the
 * most recent version by default, `history` exposes the rest.
 */
export class AgentMemory {
  readonly agentId: string;
  readonly lineage?: AgentLineage;
  private groups = new Map<string, RetainedContextGroup[]>();

  constructor(agentId: string, lineage?: AgentLineage) {
    this.agentId = agentId;
    this.lineage = lineage;
  }

  retain(input: RetainInput): RetainedContextGroup {
    const existing = this.groups.get(input.concept) ?? [];
    const prev = existing[existing.length - 1];
    const group: RetainedContextGroup = {
      id: nextGroupId(),
      concept: input.concept,
      content: input.content,
      sessionId: input.sessionId,
      timestamp: input.timestamp ?? Date.now(),
      version: (prev?.version ?? 0) + 1,
      relevanceScore: input.relevanceScore,
      reuseScore: input.reuseScore,
    };
    this.groups.set(input.concept, [...existing, group]);
    return group;
  }

  current(concept: string): RetainedContextGroup | undefined {
    const list = this.groups.get(concept);
    return list?.[list.length - 1];
  }

  history(concept: string): readonly RetainedContextGroup[] {
    return this.groups.get(concept) ?? [];
  }

  /** Most recent version of every retained concept. */
  all(): RetainedContextGroup[] {
    return [...this.groups.values()].map((versions) => versions[versions.length - 1]!);
  }

  /** Remove a concept's history entirely (used to apply a manual-review deselection). */
  drop(concept: string): void {
    this.groups.delete(concept);
  }

  /**
   * Score every already-retained group on relevance + reuse and recommend
   * retain/drop, for pruning history accumulated across past sessions.
   * Simple average of the two caller-supplied signals against a threshold —
   * kept legible rather than a black-box model.
   */
  trimRecommendation(threshold = 0.4): TrimRecommendationItem[] {
    return this.all().map((group) => scoreGroup(group, threshold));
  }

  /**
   * Score candidate groups proposed at the end of a session, without
   * committing them to the store. This is what a session's output goes
   * through before it's allowed to become retained memory — items scored
   * "drop" and not overridden by the caller simply never get retained.
   */
  evaluateCandidates(candidates: RetainInput[], sessionId: string, threshold = 0.4): TrimRecommendationItem[] {
    return candidates.map((input) => {
      const existing = this.groups.get(input.concept) ?? [];
      const prev = existing[existing.length - 1];
      const proposed: RetainedContextGroup = {
        id: nextGroupId(),
        concept: input.concept,
        content: input.content,
        sessionId,
        timestamp: input.timestamp ?? Date.now(),
        version: (prev?.version ?? 0) + 1,
        relevanceScore: input.relevanceScore,
        reuseScore: input.reuseScore,
      };
      return scoreGroup(proposed, threshold);
    });
  }

  /**
   * A group is a parallel-agent candidate when it's reused a lot but not
   * relevant to what the agent is currently scoped to — the classic signal
   * that a feature outgrew single-agent scope and should split off a sibling
   * scoped to that group's sub-branch.
   */
  recommendParallelAgents(
    reuseThreshold = 0.7,
    relevanceCeiling = 0.3,
  ): ParallelAgentRecommendation[] {
    return this.all()
      .filter((group) => group.reuseScore >= reuseThreshold && group.relevanceScore <= relevanceCeiling)
      .map((group) => ({
        concept: group.concept,
        group,
        reason: `reuse ${group.reuseScore.toFixed(2)} >= ${reuseThreshold} but relevance ${group.relevanceScore.toFixed(2)} <= ${relevanceCeiling}: likely outgrew this agent's scope`,
      }));
  }
}

/** Registry of per-agent memories, keyed by agent id. */
export class AgentMemoryStore {
  private memories = new Map<string, AgentMemory>();

  getOrCreate(agentId: string, lineage?: AgentLineage): AgentMemory {
    let memory = this.memories.get(agentId);
    if (!memory) {
      memory = new AgentMemory(agentId, lineage);
      this.memories.set(agentId, memory);
    }
    return memory;
  }

  get(agentId: string): AgentMemory | undefined {
    return this.memories.get(agentId);
  }
}
