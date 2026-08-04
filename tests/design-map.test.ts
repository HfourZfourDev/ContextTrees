import { describe, expect, it } from "vitest";
import { DesignMap } from "../src/design-map.js";

describe("DesignMap", () => {
  it("versions updates append-only instead of overwriting", () => {
    const map = new DesignMap();
    const system = map.addNode("system", "Core");
    map.update(system.id, { summary: "v2", status: "built", roadmap: [], bugs: [], futureReview: [] });
    map.update(system.id, { summary: "v3", status: "built", roadmap: [], bugs: [], futureReview: [] });

    expect(map.current(system.id).summary).toBe("v3");
    expect(map.history(system.id)).toHaveLength(3);
    expect(map.history(system.id).map((v) => v.version)).toEqual([1, 2, 3]);
  });

  it("defaults a new node's status to planned", () => {
    const map = new DesignMap();
    const node = map.addNode("feature", "New thing");
    expect(map.current(node.id).status).toBe("planned");
  });

  it("assembles a structural branch as the node plus its descendants, regardless of activation", () => {
    const map = new DesignMap();
    const system = map.addNode("system", "Core");
    const sub = map.addNode("subsystem", "Auth", system.id);
    const component = map.addNode("component", "Login form", sub.id);
    const unrelated = map.addNode("system", "Unrelated");
    map.deactivate(component.id);

    const branch = map.branch(sub.id).map((n) => n.id);
    expect(branch).toEqual([sub.id, component.id]);
    expect(branch).not.toContain(system.id);
    expect(branch).not.toContain(unrelated.id);
  });

  it("returns the ancestor path from root to node", () => {
    const map = new DesignMap();
    const system = map.addNode("system", "Core");
    const sub = map.addNode("subsystem", "Auth", system.id);
    const component = map.addNode("component", "Login form", sub.id);

    expect(map.path(component.id).map((n) => n.name)).toEqual(["Core", "Auth", "Login form"]);
  });

  it("rejects a node created against an unknown parent", () => {
    const map = new DesignMap();
    expect(() => map.addNode("subsystem", "Orphan", "does-not-exist")).toThrow();
  });

  describe("activation", () => {
    it("defaults every node to active", () => {
      const map = new DesignMap();
      const node = map.addNode("feature", "X");
      expect(map.isActive(node.id)).toBe(true);
    });

    it("deactivate/activate never delete the node — it stays in branch() and allNodes()", () => {
      const map = new DesignMap();
      const node = map.addNode("feature", "X");
      map.deactivate(node.id, { reason: "not relevant right now" });

      expect(map.isActive(node.id)).toBe(false);
      expect(map.allNodes().map((n) => n.id)).toContain(node.id);
      expect(map.get(node.id)).toBeDefined();

      map.activate(node.id, { reason: "relevant again" });
      expect(map.isActive(node.id)).toBe(true);
    });

    it("activeBranch excludes a dormant node's entire subtree, but branch() still lists it", () => {
      const map = new DesignMap();
      const feature = map.addNode("feature", "Billing");
      const child = map.addNode("feature", "Billing sub-option", feature.id);
      map.deactivate(child.id);

      expect(map.branch(feature.id).map((n) => n.id)).toEqual([feature.id, child.id]);
      expect(map.activeBranch(feature.id).map((n) => n.id)).toEqual([feature.id]);
    });

    it("dormantNodes lists deactivated nodes for audit, scoped to a branch or the whole map", () => {
      const map = new DesignMap();
      const a = map.addNode("feature", "A");
      const b = map.addNode("feature", "B", a.id);
      const c = map.addNode("feature", "C", a.id);
      map.deactivate(b.id);
      map.deactivate(c.id);

      const audit = map.dormantNodes(a.id);
      expect(audit.map((n) => n.id).sort()).toEqual([b.id, c.id].sort());
    });
  });

  describe("edges + weighted context assembly", () => {
    const strong = { dependency: 0.9, importance: 0.6 }; // combinator ~0.795
    const weak = { dependency: 0.1, importance: 0.1 }; // combinator ~0.1

    it("a strong edge pulls the target in at 'full' detail, and decay carries into its own children", () => {
      const map = new DesignMap();
      const checkout = map.addNode("feature", "Checkout", null, { status: "built" });
      const payments = map.addNode("feature", "Payments", null, { status: "built" });
      const paymentsDetail = map.addNode("feature", "Payments retry logic", payments.id, { status: "built" });
      map.addEdge(checkout.id, payments.id, "integrates-with", strong);

      const assembled = map.assembleContext(checkout.id);
      const byId = new Map(assembled.references.map((r) => [r.node.id, r]));
      expect(byId.get(payments.id)?.detail).toBe("full");
      // paymentsDetail is reached via default hierarchy decay (0.795 * 0.7 ≈ 0.56), not a "full" edge --
      // still included (>= inclusionThreshold) but at a lower detail tier than its parent.
      expect(byId.has(paymentsDetail.id)).toBe(true);
      expect(byId.get(paymentsDetail.id)?.detail).not.toBe("full");
    });

    it("a weak edge is excluded entirely", () => {
      const map = new DesignMap();
      const a = map.addNode("feature", "A");
      const b = map.addNode("feature", "B", null, { status: "shell" });
      map.addEdge(a.id, b.id, "loosely-related", weak);

      const assembled = map.assembleContext(a.id);
      expect(assembled.references).toHaveLength(0);
    });

    it("skips dormant edge targets, and does not expand into their subtree", () => {
      const map = new DesignMap();
      const a = map.addNode("feature", "A");
      const b = map.addNode("feature", "B");
      const bChild = map.addNode("feature", "B child", b.id);
      map.addEdge(a.id, b.id, "flows-into", strong);
      map.deactivate(b.id);

      const assembled = map.assembleContext(a.id);
      expect(assembled.references).toHaveLength(0);
      expect(assembled.references.map((r) => r.node.id)).not.toContain(bChild.id);
    });

    it("chases edges transitively, decaying with each hop, unlike a fixed one-hop limit", () => {
      const map = new DesignMap();
      const a = map.addNode("feature", "A");
      const b = map.addNode("feature", "B");
      const c = map.addNode("feature", "C");
      map.addEdge(a.id, b.id, "flows-into", strong);
      map.addEdge(b.id, c.id, "flows-into", strong);

      const assembled = map.assembleContext(a.id);
      const referenceIds = assembled.references.map((r) => r.node.id);
      expect(referenceIds).toContain(b.id);
      expect(referenceIds).toContain(c.id); // two strong hops still clears the threshold
      const cRef = assembled.references.find((r) => r.node.id === c.id)!;
      expect(cRef.weight).toBeLessThan(assembled.references.find((r) => r.node.id === b.id)!.weight);
    });

    it("an explicit parent-child edge overrides the default hierarchy decay for that one hop", () => {
      const map = new DesignMap();
      const a = map.addNode("feature", "A");
      const b = map.addNode("feature", "B");
      const ordinaryChild = map.addNode("feature", "ordinary child", b.id);
      const specialChild = map.addNode("feature", "special child", b.id);
      map.addEdge(a.id, b.id, "flows-into", weak); // deliberately weak so default-decay children fall below threshold
      map.addEdge(b.id, specialChild.id, "critical-path", { dependency: 0.95, importance: 0.9 });

      const assembled = map.assembleContext(a.id);
      const referenceIds = assembled.references.map((r) => r.node.id);
      expect(referenceIds).not.toContain(ordinaryChild.id);
      expect(referenceIds).not.toContain(b.id); // b itself is already below threshold at "weak"
    });

    it("contextText renders full/interface/reference nodes at different detail levels", () => {
      const map = new DesignMap();
      const a = map.addNode("feature", "Root", null, { status: "built", summary: "root summary", roadmap: ["roadmap item"] });
      const fullTarget = map.addNode("feature", "FullTarget", null, { status: "built", summary: "full summary", roadmap: ["hidden-if-pruned"] });
      const refTarget = map.addNode("feature", "RefTarget", null, { status: "shell", summary: "ref summary", roadmap: ["never-shown"] });
      map.addEdge(a.id, fullTarget.id, "integrates-with", { dependency: 1, importance: 1 });
      map.addEdge(a.id, refTarget.id, "data-hookup", { dependency: 0.3, importance: 0.2 });

      const text = map.contextText(map.assembleContext(a.id));
      expect(text).toContain("hidden-if-pruned");
      expect(text).toContain("RefTarget");
      expect(text).not.toContain("never-shown");
    });

    it("per-call traversal options can override the DesignMap's defaults", () => {
      const map = new DesignMap();
      const a = map.addNode("feature", "A");
      const b = map.addNode("feature", "B");
      map.addEdge(a.id, b.id, "flows-into", weak); // ~0.1, below the default 0.2 inclusionThreshold

      expect(map.assembleContext(a.id).references).toHaveLength(0);
      const lenient = map.assembleContext(a.id, { inclusionThreshold: 0.05 });
      expect(lenient.references.map((r) => r.node.id)).toContain(b.id);
    });

    it("reproduces the A/B/C/D illustration: strong branch decays generously, weak branch decays strictly", () => {
      // A -> B strong (~0.8): B included in full, and B's own children (default decay) still clear the bar.
      // B -> C weak (~0.1): ignored entirely.
      // B -> D weak-ish (~0.3): D is included, but barely -- almost none of D's ordinary children survive
      // the next hop, unless a child has its own near-parent-strength edge overriding the default decay.
      const map = new DesignMap();
      const a = map.addNode("feature", "A");
      const b = map.addNode("feature", "B", null, { status: "built" });
      const bChild = map.addNode("feature", "B's child", b.id);
      const c = map.addNode("feature", "C", null, { status: "shell" });
      const d = map.addNode("feature", "D", null, { status: "shell" });
      const dOrdinaryChild = map.addNode("feature", "D's ordinary child", d.id);
      const dCriticalChild = map.addNode("feature", "D's critical child", d.id);

      map.addEdge(a.id, b.id, "integrates-with", { dependency: 0.9, importance: 0.6 }); // ~0.795
      map.addEdge(b.id, c.id, "loosely-related", { dependency: 0.1, importance: 0.1 }); // ~0.1
      map.addEdge(b.id, d.id, "data-hookup", { dependency: 0.35, importance: 0.2 }); // ~0.30
      map.addEdge(d.id, dCriticalChild.id, "critical-path", { dependency: 0.95, importance: 0.9 }); // ~0.93, overrides default decay

      const assembled = map.assembleContext(a.id);
      const included = new Set(assembled.references.map((r) => r.node.id));

      expect(included.has(b.id)).toBe(true);
      expect(included.has(bChild.id)).toBe(true); // B is strong enough that ordinary decay still clears the bar
      expect(included.has(c.id)).toBe(false); // ignored
      expect(included.has(d.id)).toBe(true); // pulled in, but weakly
      expect(included.has(dOrdinaryChild.id)).toBe(false); // most of D's sub-branches pruned
      expect(included.has(dCriticalChild.id)).toBe(true); // ...unless explicitly marked critical to D
    });
  });
});
