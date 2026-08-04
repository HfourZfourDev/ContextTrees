import type { DesignMapNode, DesignMapNodeContent, DesignMapNodeKind, DesignMapNodeVersion } from "./types.js";

let nodeCounter = 0;
function nextNodeId(): string {
  nodeCounter += 1;
  return `node_${nodeCounter}_${Date.now().toString(36)}`;
}

const EMPTY_CONTENT: DesignMapNodeContent = {
  summary: "",
  roadmap: [],
  bugs: [],
  futureReview: [],
};

/**
 * Persistent, versioned System -> Subsystem -> Component tree.
 * Nodes are append-only: `update` never overwrites history, it appends a new version.
 */
export class DesignMap {
  private nodes = new Map<string, DesignMapNode>();

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
    const node: DesignMapNode = { id, kind, name, parentId, history: [version] };
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
   * The subtree rooted at `id` — this is what a micro session gets assembled
   * from ("a relevant branch of the design map") rather than the whole map.
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

  /**
   * Flattened text for a branch — node names plus current-version content —
   * for scorers to compare candidate context against.
   */
  branchText(id: string): string {
    return this.branch(id)
      .map((node) => {
        const content = this.current(node.id);
        return [node.name, content.summary, ...content.roadmap, ...content.bugs, ...content.futureReview].join(" ");
      })
      .join(" ");
  }
}
