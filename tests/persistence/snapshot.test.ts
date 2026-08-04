import { describe, expect, it } from "vitest";
import { Director } from "../../src/director.js";
import { equipAgent } from "../../src/harness.js";
import { AUTO_REVIEW } from "../../src/review.js";

function buildProject() {
  const director = new Director();
  const system = director.designMap.addNode("system", "Core", null, { status: "built", summary: "the core system" });
  const auth = director.designMap.addNode("feature", "Auth", system.id, { status: "built" });
  director.designMap.update(auth.id, { summary: "Auth v2", status: "built", roadmap: ["add MFA"], bugs: [], futureReview: [] }, { sessionId: "s0" });
  director.designMap.deactivate(auth.id, { reason: "shelved for now" });
  director.designMap.activate(auth.id, { reason: "back on the roadmap" });

  const payments = director.designMap.addNode("feature", "Payments", null, { status: "shell" });
  director.designMap.addEdge(auth.id, payments.id, "integrates-with", { dependency: 0.9, importance: 0.6, recency: 0.5 });

  const harness = director.harnesses.register({
    id: "reader",
    name: "Read-only harness",
    tools: ["read", "grep"],
    systemPrompt: "You investigate and report.",
    constraints: ["no writes"],
  });
  const agent = equipAgent("micro", harness, { parentAgentId: "agent_parent", originatingSessionId: "session_x" });
  const memory = director.agentMemories.getOrCreate(agent.id, agent.lineage);
  memory.retain({ concept: "auth-flow", content: "session tokens live in httpOnly cookies", sessionId: "s0", relevanceScore: 0.8, reuseScore: 0.6 });
  memory.retain({ concept: "auth-flow", content: "updated: rotate tokens every 24h", sessionId: "s1", relevanceScore: 0.9, reuseScore: 0.7 });

  return { director, system, auth, payments, harness, agent };
}

describe("Director snapshot round-trip", () => {
  it("preserves design-map node content, version history timestamps, and activation history exactly", () => {
    const { director, auth } = buildProject();
    const before = director.designMap.history(auth.id);
    const beforeActivation = [...director.designMap.allNodes().find((n) => n.id === auth.id)!.activationHistory];

    const json = JSON.parse(JSON.stringify(director.toSnapshot()));
    const restored = Director.fromSnapshot(json);

    expect(restored.designMap.history(auth.id)).toEqual(before);
    expect(restored.designMap.current(auth.id).summary).toBe("Auth v2");
    expect(restored.designMap.isActive(auth.id)).toBe(true);
    const restoredNode = restored.designMap.allNodes().find((n) => n.id === auth.id)!;
    expect(restoredNode.activationHistory).toEqual(beforeActivation);
  });

  it("preserves edges with their full relevance signals", () => {
    const { director, auth, payments } = buildProject();
    const json = JSON.parse(JSON.stringify(director.toSnapshot()));
    const restored = Director.fromSnapshot(json);

    const edge = restored.designMap.edgesFrom(auth.id).find((e) => e.toNodeId === payments.id);
    expect(edge?.relevance).toEqual({ dependency: 0.9, importance: 0.6, recency: 0.5 });
  });

  it("preserves agent memory groups, versions, and lineage", () => {
    const { director, agent } = buildProject();
    const json = JSON.parse(JSON.stringify(director.toSnapshot()));
    const restored = Director.fromSnapshot(json);

    const memory = restored.agentMemories.get(agent.id)!;
    expect(memory.lineage).toEqual({ parentAgentId: "agent_parent", originatingSessionId: "session_x" });
    expect(memory.current("auth-flow")?.content).toBe("updated: rotate tokens every 24h");
    expect(memory.history("auth-flow")).toHaveLength(2);
    expect(memory.history("auth-flow").map((g) => g.version)).toEqual([1, 2]);
  });

  it("preserves harnesses", () => {
    const { director, harness } = buildProject();
    const json = JSON.parse(JSON.stringify(director.toSnapshot()));
    const restored = Director.fromSnapshot(json);

    expect(restored.harnesses.get(harness.id)).toEqual(harness);
  });

  it("produces functionally identical context assembly after round-tripping (default combinator on both sides)", () => {
    const { director, auth } = buildProject();
    const before = director.designMap.contextText(director.designMap.assembleContext(auth.id));

    const json = JSON.parse(JSON.stringify(director.toSnapshot()));
    const restored = Director.fromSnapshot(json);
    const after = restored.designMap.contextText(restored.designMap.assembleContext(auth.id));

    expect(after).toBe(before);
  });

  it("still lets a restored director start and end a session normally", async () => {
    const { director, auth, harness } = buildProject();
    const json = JSON.parse(JSON.stringify(director.toSnapshot()));
    const restored = Director.fromSnapshot(json);
    const agent = equipAgent("micro", harness);

    const session = restored.startSession({
      description: "continue work on auth",
      branchNodeId: auth.id,
      agents: [agent],
      reviewMode: AUTO_REVIEW,
    });
    const outcome = await restored.endSession(session, { designMapUpdates: [], agentMemoryUpdates: [] });
    expect(outcome.designMap.committed).toBe(true);
  });

  it("rejects a snapshot with an unsupported schema version", () => {
    const { director } = buildProject();
    const snapshot = { ...director.toSnapshot(), schemaVersion: 999 as 1 };
    expect(() => Director.fromSnapshot(snapshot)).toThrow(/schema version/);
  });
});
