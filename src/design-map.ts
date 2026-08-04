import type {
  ActivationEvent,
  DesignMapEdge,
  DesignMapNode,
  DesignMapNodeContent,
  DesignMapNodeKind,
  DesignMapNodeVersion,
  EdgeKind,
  EdgeRelevance,
} from "./types.js";
import { classifyDetail, DEFAULT_TRAVERSAL_OPTIONS, type ContextDetailLevel, type ContextTraversalOptions } from "./context-traversal.js";

let nodeCounter = 0;
function nextNodeId(): string {
  nodeCounter += 1;
  return `node_${nodeCounter}_${Date.now().toString(36)}`;
}

let edgeCounter = 0;
function nextEdgeId(): string {
  edgeCounter += 1;
  return `edge_${edgeCounter}_${Date.now().toString(36)}`;
}

const EMPTY_CONTENT: DesignMapNodeContent = {
  summary: "",
  status: "planned",
  roadmap: [],
  bugs: [],
  futureReview: [],
};

export interface AssembledReference {
  node: DesignMapNode;
  /** Accumulated weight (product of every hop's weight from the primary branch) that got this node included. */
  weight: number;
  detail: ContextDetailLevel;
  /** The edge whose weight decided this node's winning path, if the winning hop was an explicit edge rather than default hierarchy decay. */
  via?: DesignMapEdge;
}

export interface AssembledContext {
  /** The requested branch's own active subtree, always full detail, unaffected by decay. */
  primary: DesignMapNode[];
  /**
   * Nodes pulled in by spreading weighted relevance out from the primary
   * branch — across edges and down hierarchy — until weight decays below
   * the inclusion threshold. Deduplicated against `primary` and against
   * each other (a node reached by multiple paths keeps its highest-weight
   * path).
   */
  references: AssembledReference[];
}

/**
 * Persistent, versioned roadmap tree — the roadmap *is* the design map.
 * Every node is a branch (built feature, planned feature, shell,
 * unintegrated piece, or a nested expansion of any of those); nodes are
 * append-only versioned, and can additionally be marked active/dormant
 * without ever being deleted.
 */
export class DesignMap {
  private nodes = new Map<string, DesignMapNode>();
  private edges = new Map<string, DesignMapEdge>();
  private traversalDefaults: ContextTraversalOptions;

  constructor(traversalDefaults: Partial<ContextTraversalOptions> = {}) {
    this.traversalDefaults = { ...DEFAULT_TRAVERSAL_OPTIONS, ...traversalDefaults };
  }

  addNode(
    kind: DesignMapNodeKind,
    name: string,
    parentId: string | null = null,
    initialContent: Partial<DesignMapNodeContent> = {},
  ): DesignMapNode {
    if (parentId !== null && !this.nodes.has(parentId)) {
      throw new Error(`DesignMap.addNode: unknown parentId "${parentId}"`);
    }
    const id = nextNodeId();
    const version: DesignMapNodeVersion = {
      version: 1,
      content: { ...EMPTY_CONTENT, ...initialContent },
      committedAt: Date.now(),
    };
    const node: DesignMapNode = { id, kind, name, parentId, history: [version], activationHistory: [] };
    this.nodes.set(id, node);
    return node;
  }

  get(id: string): DesignMapNode | undefined {
    return this.nodes.get(id);
  }

  requireNode(id: string): DesignMapNode {
    const node = this.nodes.get(id);
    if (!node) throw new Error(`DesignMap: unknown node "${id}"`);
    return node;
  }

  /** Latest committed content for a node. */
  current(id: string): DesignMapNodeContent {
    const node = this.requireNode(id);
    const latest = node.history[node.history.length - 1];
    if (!latest) throw new Error(`DesignMap: node "${id}" has no versions`);
    return latest.content;
  }

  /** Full version history for a node, oldest first — read-only audit trail. */
  history(id: string): readonly DesignMapNodeVersion[] {
    return this.requireNode(id).history;
  }

  /**
   * Append a new version. Conflicting concurrent edits are not merged or
   * flagged — the new version simply becomes current; prior versions remain
   * queryable via `history`.
   */
  update(id: string, content: DesignMapNodeContent, opts: { sessionId?: string } = {}): DesignMapNodeVersion {
    const node = this.requireNode(id);
    const prev = node.history[node.history.length - 1];
    const version: DesignMapNodeVersion = {
      version: (prev?.version ?? 0) + 1,
      content,
      committedAt: Date.now(),
      sessionId: opts.sessionId,
    };
    node.history.push(version);
    return version;
  }

  children(id: string): DesignMapNode[] {
    return [...this.nodes.values()].filter((n) => n.parentId === id);
  }

  /** Ancestor chain from root to `id`, inclusive. */
  path(id: string): DesignMapNode[] {
    const chain: DesignMapNode[] = [];
    let node: DesignMapNode | undefined = this.requireNode(id);
    while (node) {
      chain.unshift(node);
      node = node.parentId ? this.nodes.get(node.parentId) : undefined;
    }
    return chain;
  }

  /**
   * The full structural subtree rooted at `id`, regardless of activation
   * state — this is what a roadmap listing/audit view uses ("this node has
   * 3 branches, 2 dormant"). For what an AI pass should actually see, use
   * `activeBranch` or `assembleContext`.
   */
  branch(id: string): DesignMapNode[] {
    const root = this.requireNode(id);
    const result: DesignMapNode[] = [root];
    const queue = [root];
    while (queue.length > 0) {
      const node = queue.shift()!;
      const kids = this.children(node.id);
      result.push(...kids);
      queue.push(...kids);
    }
    return result;
  }

  allNodes(): DesignMapNode[] {
    return [...this.nodes.values()];
  }

  // ---- Activation (dormant, not deleted) ----------------------------------

  isActive(id: string): boolean {
    const node = this.requireNode(id);
    const last = node.activationHistory[node.activationHistory.length - 1];
    return last ? last.active : true;
  }

  private setActive(id: string, active: boolean, opts: { reason?: string; sessionId?: string } = {}): ActivationEvent {
    const node = this.requireNode(id);
    const event: ActivationEvent = { active, atEpochMs: Date.now(), reason: opts.reason, sessionId: opts.sessionId };
    node.activationHistory.push(event);
    return event;
  }

  /** Mark a node dormant: excluded from `activeBranch`/`assembleContext`, never deleted, still listed by `branch`/`allNodes`. */
  deactivate(id: string, opts: { reason?: string; sessionId?: string } = {}): ActivationEvent {
    return this.setActive(id, false, opts);
  }

  /** Bring a dormant node back into context passes. */
  activate(id: string, opts: { reason?: string; sessionId?: string } = {}): ActivationEvent {
    return this.setActive(id, true, opts);
  }

  /** Every dormant node in the map, or within a given branch — the audit list. */
  dormantNodes(rootId?: string): DesignMapNode[] {
    const pool = rootId ? this.branch(rootId) : this.allNodes();
    return pool.filter((n) => !this.isActive(n.id));
  }

  /**
   * Like `branch`, but stops at dormant nodes: a dormant node and its whole
   * subtree are excluded. Returns `[]` if `id` itself is dormant.
   */
  activeBranch(id: string): DesignMapNode[] {
    if (!this.isActive(id)) return [];
    const root = this.requireNode(id);
    const result: DesignMapNode[] = [root];
    const queue = [root];
    while (queue.length > 0) {
      const node = queue.shift()!;
      for (const child of this.children(node.id)) {
        if (!this.isActive(child.id)) continue;
        result.push(child);
        queue.push(child);
      }
    }
    return result;
  }

  // ---- Cross-branch edges ---------------------------------------------------

  /**
   * `relevance` combines dependency (structural coupling) and importance
   * (criticality independent of coupling) into the weight decay math uses.
   * Works between any two nodes — including a parent and its own child, to
   * override the default hierarchy decay for that specific pair (e.g. "this
   * child stays 90%+ as relevant as its parent, don't decay it normally").
   */
  addEdge(fromNodeId: string, toNodeId: string, kind: EdgeKind, relevance: EdgeRelevance, note?: string): DesignMapEdge {
    this.requireNode(fromNodeId);
    this.requireNode(toNodeId);
    const edge: DesignMapEdge = { id: nextEdgeId(), fromNodeId, toNodeId, kind, relevance, note };
    this.edges.set(edge.id, edge);
    return edge;
  }

  edgesFrom(nodeId: string): DesignMapEdge[] {
    return [...this.edges.values()].filter((e) => e.fromNodeId === nodeId);
  }

  edgesTo(nodeId: string): DesignMapEdge[] {
    return [...this.edges.values()].filter((e) => e.toNodeId === nodeId);
  }

  allEdges(): DesignMapEdge[] {
    return [...this.edges.values()];
  }

  // ---- Context assembly ------------------------------------------------------

  /**
   * Targeted context for a session scoped to `rootId`: the branch's own
   * active subtree in full, plus everything reachable by spreading weighted
   * relevance out from it — across edges and down hierarchy — until weight
   * decays below `inclusionThreshold`. Unlike a fixed hop limit, this is
   * self-bounding: a strong edge can chase several hops deep, a weak one
   * dies out almost immediately, without per-branch threshold tuning (see
   * `ContextTraversalOptions.inclusionThreshold`). Dormant targets are
   * skipped, and their subtrees are not expanded into.
   */
  assembleContext(rootId: string, overrides: Partial<ContextTraversalOptions> = {}): AssembledContext {
    const options: ContextTraversalOptions = { ...this.traversalDefaults, ...overrides };
    const primary = this.activeBranch(rootId);
    const visited = new Set(primary.map((n) => n.id));
    const references: AssembledReference[] = [];

    interface Candidate {
      nodeId: string;
      weight: number;
      via?: DesignMapEdge;
    }
    const frontier: Candidate[] = [];

    const enqueueFrom = (node: DesignMapNode, weight: number) => {
      const outgoing = this.edgesFrom(node.id);
      for (const child of this.children(node.id)) {
        if (visited.has(child.id)) continue;
        const override = outgoing.find((e) => e.toNodeId === child.id);
        const stepWeight = override ? options.combinator(override.relevance) : options.hierarchyDecay;
        frontier.push({ nodeId: child.id, weight: weight * stepWeight, via: override });
      }
      for (const edge of outgoing) {
        if (visited.has(edge.toNodeId)) continue;
        frontier.push({ nodeId: edge.toNodeId, weight: weight * options.combinator(edge.relevance), via: edge });
      }
    };

    for (const node of primary) enqueueFrom(node, 1);

    while (frontier.length > 0) {
      frontier.sort((a, b) => b.weight - a.weight);
      const candidate = frontier.shift()!;
      // Sorted descending: once the global max drops below the threshold, nothing remaining can qualify either.
      if (candidate.weight < options.inclusionThreshold) break;
      if (visited.has(candidate.nodeId)) continue;
      if (!this.isActive(candidate.nodeId)) {
        visited.add(candidate.nodeId);
        continue;
      }
      visited.add(candidate.nodeId);
      const node = this.requireNode(candidate.nodeId);
      references.push({ node, weight: candidate.weight, detail: classifyDetail(candidate.weight, options), via: candidate.via });
      enqueueFrom(node, candidate.weight);
    }

    return { primary, references };
  }

  /** Renders an AssembledContext to text, respecting each node's computed detail level. */
  contextText(assembled: AssembledContext): string {
    const parts: string[] = [];
    for (const node of assembled.primary) parts.push(this.renderFull(node));
    for (const ref of assembled.references) {
      if (ref.detail === "full") parts.push(this.renderFull(ref.node));
      else if (ref.detail === "interface") parts.push(this.renderInterface(ref.node));
      else parts.push(this.renderReference(ref.node));
    }
    return parts.join(" ");
  }

  private renderFull(node: DesignMapNode): string {
    const content = this.current(node.id);
    return [node.name, `[${content.status}]`, content.summary, ...content.roadmap, ...content.bugs, ...content.futureReview].join(" ");
  }

  private renderInterface(node: DesignMapNode): string {
    const content = this.current(node.id);
    return [node.name, `[${content.status}]`, content.summary].join(" ");
  }

  private renderReference(node: DesignMapNode): string {
    const content = this.current(node.id);
    return `${node.name} [${content.status}]`;
  }
}
