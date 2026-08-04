import { describe, expect, it } from "vitest";
import { Director } from "../src/director.js";
import { equipAgent } from "../src/harness.js";
import { AUTO_REVIEW, MANUAL_REVIEW } from "../src/review.js";

function setup() {
  const director = new Director();
  const system = director.designMap.addNode("system", "Core");
  const sub = director.designMap.addNode("subsystem", "Auth", system.id);
  const harness = director.harnesses.register({
    id: "reader",
    name: "Read-only harness",
    tools: ["read"],
    systemPrompt: "You read code.",
  });
  return { director, system, sub, harness };
}

describe("Director + MicroSession", () => {
  it("auto review mode commits both branches immediately on session end", () => {
    const { director, sub, harness } = setup();
    const agent = equipAgent("micro", harness);
    const session = director.startSession({
      description: "Add login form",
      branchNodeId: sub.id,
      agents: [agent],
      reviewMode: AUTO_REVIEW,
    });

    const outcome = director.endSession(session, {
      designMapUpdates: [{ nodeId: sub.id, content: { summary: "Auth + login form", roadmap: [], bugs: [], futureReview: [] } }],
      agentMemoryUpdates: [
        {
          agentId: agent.id,
          retain: [{ concept: "login-form-pattern", content: "...", sessionId: session.id, relevanceScore: 0.9, reuseScore: 0.8 }],
        },
      ],
    });

    expect(outcome.designMap.committed).toBe(true);
    expect(director.designMap.current(sub.id).summary).toBe("Auth + login form");
    expect(outcome.agentMemory.committed).toBe(true);
    expect(director.agentMemories.get(agent.id)?.current("login-form-pattern")?.content).toBe("...");
  });

  it("manual review mode withholds commit until apply() is called", () => {
    const { director, sub, harness } = setup();
    const agent = equipAgent("micro", harness);
    const session = director.startSession({
      description: "Add login form",
      branchNodeId: sub.id,
      agents: [agent],
      reviewMode: MANUAL_REVIEW,
    });

    const outcome = director.endSession(session, {
      designMapUpdates: [{ nodeId: sub.id, content: { summary: "Auth + login form", roadmap: [], bugs: [], futureReview: [] } }],
      agentMemoryUpdates: [
        {
          agentId: agent.id,
          retain: [{ concept: "login-form-pattern", content: "...", sessionId: session.id, relevanceScore: 0.9, reuseScore: 0.8 }],
        },
      ],
    });

    expect(outcome.designMap.committed).toBe(false);
    expect(director.designMap.history(sub.id)).toHaveLength(1);
    expect(outcome.agentMemory.committed).toBe(false);
    expect(director.agentMemories.get(agent.id)?.current("login-form-pattern")).toBeUndefined();

    outcome.designMap.apply();
    outcome.agentMemory.apply();

    expect(director.designMap.current(sub.id).summary).toBe("Auth + login form");
    expect(director.agentMemories.get(agent.id)?.current("login-form-pattern")?.content).toBe("...");
  });

  it("manual apply() honors a partial selection, dropping the rest", () => {
    const { director, sub, harness } = setup();
    const agent = equipAgent("micro", harness);
    const session = director.startSession({
      description: "Add login + billing",
      branchNodeId: sub.id,
      agents: [agent],
      reviewMode: MANUAL_REVIEW,
    });

    const outcome = director.endSession(session, {
      designMapUpdates: [],
      agentMemoryUpdates: [
        {
          agentId: agent.id,
          retain: [
            { concept: "login-form-pattern", content: "a", sessionId: session.id, relevanceScore: 0.9, reuseScore: 0.8 },
            { concept: "billing-quirk", content: "b", sessionId: session.id, relevanceScore: 0.9, reuseScore: 0.8 },
          ],
        },
      ],
    });

    outcome.agentMemory.apply({ [agent.id]: ["login-form-pattern"] });

    const memory = director.agentMemories.get(agent.id)!;
    expect(memory.current("login-form-pattern")).toBeDefined();
    expect(memory.current("billing-quirk")).toBeUndefined();
  });

  it("ending a session marks it ended and blocks further context passes", () => {
    const { director, sub, harness } = setup();
    const agent = equipAgent("micro", harness);
    const session = director.startSession({
      description: "Add login form",
      branchNodeId: sub.id,
      agents: [agent],
      reviewMode: AUTO_REVIEW,
    });
    session.recordContextPass("initial scoping");
    director.endSession(session, { designMapUpdates: [], agentMemoryUpdates: [] });

    expect(session.status).toBe("ended");
    expect(() => session.recordContextPass("too late")).toThrow();
  });

  it("rejects starting a session against an unknown branch or unregistered harness", () => {
    const { director, sub, harness } = setup();
    const agent = equipAgent("micro", harness);
    expect(() =>
      director.startSession({ description: "x", branchNodeId: "nope", agents: [agent], reviewMode: AUTO_REVIEW }),
    ).toThrow();

    const badAgent = equipAgent("micro", { ...harness, id: "unregistered" });
    expect(() =>
      director.startSession({ description: "x", branchNodeId: sub.id, agents: [badAgent], reviewMode: AUTO_REVIEW }),
    ).toThrow();
  });
});
