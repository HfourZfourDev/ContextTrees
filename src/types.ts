/** Shared data model for the macro (design map) and micro (session/agent memory) layers. */

export type DesignMapNodeKind = "system" | "subsystem" | "component";

export interface DesignMapNodeContent {
  summary: string;
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

export interface DesignMapNode {
  id: string;
  kind: DesignMapNodeKind;
  name: string;
  parentId: string | null;
  history: DesignMapNodeVersion[];
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
