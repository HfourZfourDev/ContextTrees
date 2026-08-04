/** Shared data model for the macro (design map) and micro (session/agent memory) layers. */

/**
 * Open taxonomy label for a node's place in the hierarchy (e.g. "system",
 * "feature", "sub-feature"). The roadmap itself is the tree — nesting is
 * unconstrained, not fixed to a 3-tier System/Subsystem/Component shape.
 */
export type DesignMapNodeKind = string;

/** Lifecycle stage of a roadmap node. */
export type FeatureStatus = "built" | "planned" | "shell" | "unintegrated";

export interface DesignMapNodeContent {
  summary: string;
  status: FeatureStatus;
  roadmap: string[];
  bugs: string[];
  futureReview: string[];
}

export interface DesignMapNodeVersion {
  version: number;
  content: DesignMapNodeContent;
  committedAt: number;
  sessionId?: string;
}

export interface ActivationEvent {
  active: boolean;
  atEpochMs: number;
  reason?: string;
  sessionId?: string;
}

export interface DesignMapNode {
  id: string;
  kind: DesignMapNodeKind;
  name: string;
  parentId: string | null;
  history: DesignMapNodeVersion[];
  /** Append-only log of activate/deactivate events. Empty history means active by default. */
  activationHistory: ActivationEvent[];
}

/** Open taxonomy label for what an edge means (e.g. "flows-into", "integrates-with", "planned-integration"). */
export type EdgeKind = string;

/**
 * How much of an edge's target branch to pull into context when assembling
 * a session's scope:
 * - "full": the target's entire active subtree, full content — genuinely
 *   co-dependent features that both need full mutual context.
 * - "interface": just the target node's own current content, no
 *   descendants — "this is our data flow hookup point."
 * - "reference": just an identifying pointer (name + status) — bare
 *   acknowledgement that something exists, aggressively pruned.
 */
export type ContextPruneLevel = "full" | "interface" | "reference";

export interface DesignMapEdge {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  kind: EdgeKind;
  pruneLevel: ContextPruneLevel;
  note?: string;
}

export interface AgentLineage {
  parentAgentId: string;
  originatingSessionId: string;
}

export interface RetainedContextGroup {
  id: string;
  concept: string;
  content: string;
  sessionId: string;
  timestamp: number;
  version: number;
  relevanceScore: number;
  reuseScore: number;
}

export type ReviewMode = "auto" | "manual";

export interface ReviewModeConfig {
  designMap: ReviewMode;
  agentMemory: ReviewMode;
}

export interface Harness {
  id: string;
  name: string;
  tools: string[];
  systemPrompt: string;
  constraints: string[];
}

export type AgentRole = "macro" | "micro";

export interface AgentDescriptor {
  id: string;
  role: AgentRole;
  harnessId: string;
  lineage?: AgentLineage;
}
