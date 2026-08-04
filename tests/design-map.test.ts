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

  describe("edges + context assembly", () => {
    it("assembleContext pulls a 'full' edge target's entire active subtree in as references", () => {
      const map = new DesignMap();
      const checkout = map.addNode("feature", "Checkout", null, { status: "built" });
      const payments = map.addNode("feature", "Payments", null, { status: "built" });
      const paymentsDetail = map.addNode("feature", "Payments retry logic", payments.id, { status: "built" });
      map.addEdge(checkout.id, payments.id, "integrates-with", "full");

      const assembled = map.assembleContext(checkout.id);
      const referenceIds = assembled.references.map((r) => r.node.id);
      expect(referenceIds).toContain(payments.id);
      expect(referenceIds).toContain(paymentsDetail.id);
      expect(assembled.references.every((r) => r.pruneLevel === "full")).toBe(true);
    });

    it("assembleContext pulls only the target node itself for 'interface' and 'reference' edges, not its descendants", () => {
      const map = new DesignMap();
      const featureA = map.addNode("feature", "A");
      const hookup = map.addNode("feature", "Data flow hookup point", null, { status: "shell" });
      const hookupDetail = map.addNode("feature", "hookup internals", hookup.id);
      map.addEdge(featureA.id, hookup.id, "data-hookup", "reference");

      const assembled = map.assembleContext(featureA.id);
      const referenceIds = assembled.references.map((r) => r.node.id);
      expect(referenceIds).toEqual([hookup.id]);
      expect(referenceIds).not.toContain(hookupDetail.id);
      expect(assembled.references[0]?.pruneLevel).toBe("reference");
    });

    it("assembleContext skips dormant edge targets entirely", () => {
      const map = new DesignMap();
      const a = map.addNode("feature", "A");
      const b = map.addNode("feature", "B");
      map.addEdge(a.id, b.id, "flows-into", "interface");
      map.deactivate(b.id);

      const assembled = map.assembleContext(a.id);
      expect(assembled.references).toHaveLength(0);
    });

    it("assembleContext does not chase edges transitively past one hop", () => {
      const map = new DesignMap();
      const a = map.addNode("feature", "A");
      const b = map.addNode("feature", "B");
      const c = map.addNode("feature", "C");
      map.addEdge(a.id, b.id, "flows-into", "interface");
      map.addEdge(b.id, c.id, "flows-into", "interface");

      const assembled = map.assembleContext(a.id);
      const referenceIds = assembled.references.map((r) => r.node.id);
      expect(referenceIds).toEqual([b.id]);
      expect(referenceIds).not.toContain(c.id);
    });

    it("contextText renders full/interface/reference nodes at different detail levels", () => {
      const map = new DesignMap();
      const a = map.addNode("feature", "Root", null, { status: "built", summary: "root summary", roadmap: ["roadmap item"] });
      const fullTarget = map.addNode("feature", "FullTarget", null, { status: "built", summary: "full summary", roadmap: ["hidden-if-pruned"] });
      const refTarget = map.addNode("feature", "RefTarget", null, { status: "shell", summary: "ref summary", roadmap: ["never-shown"] });
      map.addEdge(a.id, fullTarget.id, "integrates-with", "full");
      map.addEdge(a.id, refTarget.id, "data-hookup", "reference");

      const text = map.contextText(map.assembleContext(a.id));
      expect(text).toContain("hidden-if-pruned");
      expect(text).toContain("RefTarget");
      expect(text).not.toContain("never-shown");
    });
  });
});
