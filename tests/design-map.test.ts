import { describe, expect, it } from "vitest";
import { DesignMap } from "../src/design-map.js";

describe("DesignMap", () => {
  it("versions updates append-only instead of overwriting", () => {
    const map = new DesignMap();
    const system = map.addNode("system", "Core");
    map.update(system.id, { summary: "v2", roadmap: [], bugs: [], futureReview: [] });
    map.update(system.id, { summary: "v3", roadmap: [], bugs: [], futureReview: [] });

    expect(map.current(system.id).summary).toBe("v3");
    expect(map.history(system.id)).toHaveLength(3);
    expect(map.history(system.id).map((v) => v.version)).toEqual([1, 2, 3]);
  });

  it("assembles a branch as the node plus its descendants", () => {
    const map = new DesignMap();
    const system = map.addNode("system", "Core");
    const sub = map.addNode("subsystem", "Auth", system.id);
    const component = map.addNode("component", "Login form", sub.id);
    const unrelated = map.addNode("system", "Unrelated");

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
});
