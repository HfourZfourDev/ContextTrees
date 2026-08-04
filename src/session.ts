import type { AgentDescriptor, DesignMapNodeContent, ReviewModeConfig } from "./types.js";
import type { AssembledContext } from "./design-map.js";

export interface ContextPass {
  atEpochMs: number;
  note: string;
}

export type SessionStatus = "running" | "ended";

let sessionCounter = 0;
function nextSessionId(): string {
  sessionCounter += 1;
  return `session_${sessionCounter}_${Date.now().toString(36)}`;
}

export interface MicroSessionInit {
  description: string;
  branchNodeId: string;
  agents: AgentDescriptor[];
  reviewMode: ReviewModeConfig;
  /** Computed by Director.startSession from the design map — the targeted context this session was actually given. */
  context: AssembledContext;
  contextText: string;
}

/**
 * Ephemeral, feature-scoped working session. Assembled from a branch of the
 * design map rather than user copy-paste; context is re-passed to its agents
 * on a recurring loop as it progresses (`recordContextPass`), not injected
 * once at creation.
 */
export class MicroSession {
  readonly id: string;
  readonly description: string;
  readonly branchNodeId: string;
  readonly agents: AgentDescriptor[];
  readonly reviewMode: ReviewModeConfig;
  readonly context: AssembledContext;
  readonly contextText: string;
  status: SessionStatus = "running";
  private passes: ContextPass[] = [];

  constructor(init: MicroSessionInit) {
    this.id = nextSessionId();
    this.description = init.description;
    this.branchNodeId = init.branchNodeId;
    this.agents = init.agents;
    this.reviewMode = init.reviewMode;
    this.context = init.context;
    this.contextText = init.contextText;
  }

  recordContextPass(note: string): ContextPass {
    if (this.status !== "running") {
      throw new Error(`MicroSession ${this.id} has already ended`);
    }
    const pass = { atEpochMs: Date.now(), note };
    this.passes.push(pass);
    return pass;
  }

  contextPasses(): readonly ContextPass[] {
    return this.passes;
  }

  end(): void {
    this.status = "ended";
  }
}

export interface DesignMapUpdateRequest {
  nodeId: string;
  content: DesignMapNodeContent;
}

/** A director decision to bring a node into or out of AI-pass context, without deleting it. */
export interface ActivationUpdateRequest {
  nodeId: string;
  active: boolean;
  reason?: string;
}

/**
 * What a session proposes to retain, before relevance is resolved. Omitting
 * `relevanceScore` tells the director to compute it via the configured
 * `RelevanceScorer` against the session's design-map branch; pass it
 * explicitly to bypass the scorer for a given candidate.
 */
export interface RetainCandidate {
  concept: string;
  content: string;
  reuseScore: number;
  relevanceScore?: number;
  timestamp?: number;
}

export interface AgentMemoryUpdateRequest {
  agentId: string;
  retain: RetainCandidate[];
}

export interface EndSessionInput {
  designMapUpdates: DesignMapUpdateRequest[];
  agentMemoryUpdates: AgentMemoryUpdateRequest[];
  activationUpdates?: ActivationUpdateRequest[];
  trimThreshold?: number;
}
