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
  it("auto review mode commits both branches immediately on session end", async () => {
    const { director, sub, harness } = setup();
    const agent = equipAgent("micro", harness);
    const session = director.startSession({
      description: "Add login form",
      branchNodeId: sub.id,
      agents: [agent],
      reviewMode: AUTO_REVIEW,
    });

    const outcome = await director.endSession(session, {
      designMapUpdates: [
        { nodeId: sub.id, content: { summary: "Auth + login form", status: "built", roadmap: [], bugs: [], futureReview: [] } },
      ],
      agentMemoryUpdates: [
        {
          agentId: agent.id,
          retain: [{ concept: "login-form-pattern", content: "...", relevanceScore: 0.9, reuseScore: 0.8 }],
        },
      ],
    });

    expect(outcome.designMap.committed).toBe(true);
    expect(director.designMap.current(sub.id).summary).toBe("Auth + login form");
    expect(outcome.agentMemory.committed).toBe(true);
    expect(director.agentMemories.get(agent.id)?.current("login-form-pattern")?.content).toBe("...");
  });

  it("manual review mode withholds commit until apply() is called", async () => {
    const { director, sub, harness } = setup();
    const agent = equipAgent("micro", harness);
    const session = director.startSession({
      description: "Add login form",
      branchNodeId: sub.id,
      agents: [agent],
      reviewMode: MANUAL_REVIEW,
    });

    const outcome = await director.endSession(session, {
      designMapUpdates: [
        { nodeId: sub.id, content: { summary: "Auth + login form", status: "built", roadmap: [], bugs: [], futureReview: [] } },
      ],
      agentMemoryUpdates: [
        {
          agentId: agent.id,
          retain: [{ concept: "login-form-pattern", content: "...", relevanceScore: 0.9, reuseScore: 0.8 }],
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

  it("manual apply() honors a partial selection, dropping the rest", async () => {
    const { director, sub, harness } = setup();
    const agent = equipAgent("micro", harness);
    const session = director.startSession({
      description: "Add login + billing",
      branchNodeId: sub.id,
      agents: [agent],
      reviewMode: MANUAL_REVIEW,
    });

    const outcome = await director.endSession(session, {
      designMapUpdates: [],
      agentMemoryUpdates: [
        {
          agentId: agent.id,
          retain: [
            { concept: "login-form-pattern", content: "a", relevanceScore: 0.9, reuseScore: 0.8 },
            { concept: "billing-quirk", content: "b", relevanceScore: 0.9, reuseScore: 0.8 },
          ],
        },
      ],
    });

    outcome.agentMemory.apply({ [agent.id]: ["login-form-pattern"] });

    const memory = director.agentMemories.get(agent.id)!;
    expect(memory.current("login-form-pattern")).toBeDefined();
    expect(memory.current("billing-quirk")).toBeUndefined();
  });

  it("ending a session marks it ended and blocks further context passes", async () => {
    const { director, sub, harness } = setup();
    const agent = equipAgent("micro", harness);
    const session = director.startSession({
      description: "Add login form",
      branchNodeId: sub.id,
      agents: [agent],
      reviewMode: AUTO_REVIEW,
    });
    session.recordContextPass("initial scoping");
    await director.endSession(session, { designMapUpdates: [], agentMemoryUpdates: [] });

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

  it("resolves relevanceScore via the configured scorer when a retain candidate omits it", async () => {
    const { director, sub, harness } = setup();
    director.designMap.update(sub.id, {
      summary: "Handles login sessions and password resets",
      status: "built",
      roadmap: [],
      bugs: [],
      futureReview: [],
    });
    const agent = equipAgent("micro", harness);
    const session = director.startSession({
      description: "Add login form",
      branchNodeId: sub.id,
      agents: [agent],
      reviewMode: AUTO_REVIEW,
    });

    const outcome = await director.endSession(session, {
      designMapUpdates: [],
      agentMemoryUpdates: [
        {
          agentId: agent.id,
          retain: [
            { concept: "on-topic", content: "login sessions and password resets", reuseScore: 0.5 },
            { concept: "off-topic", content: "completely unrelated pastry recipe notes", reuseScore: 0.5 },
          ],
        },
      ],
    });

    const items = outcome.agentMemory.recommendation[agent.id]!;
    const onTopic = items.find((i) => i.group.concept === "on-topic")!;
    const offTopic = items.find((i) => i.group.concept === "off-topic")!;
    expect(onTopic.group.relevanceScore).toBeGreaterThan(offTopic.group.relevanceScore);
  });

  it("scopes a session's context to the branch plus edge references, not the whole map", () => {
    const { director, sub, harness } = setup();
    const unrelated = director.designMap.addNode("subsystem", "Billing", null, {
      summary: "totally separate subsystem",
      status: "built",
    });
    const agent = equipAgent("micro", harness);

    const session = director.startSession({
      description: "Add login form",
      branchNodeId: sub.id,
      agents: [agent],
      reviewMode: AUTO_REVIEW,
    });

    expect(session.context.primary.map((n) => n.id)).toEqual([sub.id]);
    expect(session.contextText).not.toContain("Billing");
    expect(session.context.primary.map((n) => n.id)).not.toContain(unrelated.id);
  });

  it("rejects starting a session scoped to a dormant node until it's reactivated", () => {
    const { director, sub, harness } = setup();
    director.designMap.deactivate(sub.id, { reason: "shelved" });
    const agent = equipAgent("micro", harness);

    expect(() =>
      director.startSession({ description: "x", branchNodeId: sub.id, agents: [agent], reviewMode: AUTO_REVIEW }),
    ).toThrow(/dormant/);

    director.designMap.activate(sub.id, { reason: "relevant again" });
    expect(() =>
      director.startSession({ description: "x", branchNodeId: sub.id, agents: [agent], reviewMode: AUTO_REVIEW }),
    ).not.toThrow();
  });

  it("applies activationUpdates under the same design-map review gate as content updates, and exposes an audit list", async () => {
    const { director, sub, harness } = setup();
    const staleChild = director.designMap.addNode("component", "Old experiment", sub.id, { status: "shell" });
    const agent = equipAgent("micro", harness);
    const session = director.startSession({
      description: "Clean up stale branches",
      branchNodeId: sub.id,
      agents: [agent],
      reviewMode: MANUAL_REVIEW,
    });

    const outcome = await director.endSession(session, {
      designMapUpdates: [],
      agentMemoryUpdates: [],
      activationUpdates: [{ nodeId: staleChild.id, active: false, reason: "not relevant, revisit later" }],
    });

    expect(director.designMap.isActive(staleChild.id)).toBe(true);
    outcome.designMap.apply();
    expect(director.designMap.isActive(staleChild.id)).toBe(false);

    const audit = director.auditDormantBranches(sub.id);
    expect(audit.map((n) => n.id)).toEqual([staleChild.id]);

    director.designMap.activate(staleChild.id, { reason: "turns out it's relevant again" });
    expect(director.auditDormantBranches(sub.id)).toHaveLength(0);
  });
});
