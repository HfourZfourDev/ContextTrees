import { describe, expect, it } from "vitest";
import { AgentMemory, AgentMemoryStore } from "../src/agent-memory.js";

describe("AgentMemory", () => {
  it("versions conflicting retains on the same concept instead of overwriting", () => {
    const memory = new AgentMemory("agent_1");
    memory.retain({ concept: "auth-flow", content: "v1", sessionId: "s1", relevanceScore: 0.8, reuseScore: 0.8 });
    memory.retain({ concept: "auth-flow", content: "v2", sessionId: "s2", relevanceScore: 0.9, reuseScore: 0.9 });

    expect(memory.current("auth-flow")?.content).toBe("v2");
    expect(memory.history("auth-flow")).toHaveLength(2);
    expect(memory.history("auth-flow").map((g) => g.version)).toEqual([1, 2]);
  });

  it("recommends retain/drop from relevance + reuse against a threshold", () => {
    const memory = new AgentMemory("agent_1");
    memory.retain({ concept: "keep-me", content: "x", sessionId: "s1", relevanceScore: 0.9, reuseScore: 0.9 });
    memory.retain({ concept: "drop-me", content: "y", sessionId: "s1", relevanceScore: 0.1, reuseScore: 0.1 });

    const rec = memory.trimRecommendation(0.4);
    const byGroup = Object.fromEntries(rec.map((r) => [r.group.concept, r.action]));
    expect(byGroup["keep-me"]).toBe("retain");
    expect(byGroup["drop-me"]).toBe("drop");
  });

  it("evaluates candidates without committing them to the store", () => {
    const memory = new AgentMemory("agent_1");
    const rec = memory.evaluateCandidates(
      [{ concept: "new-thing", content: "x", sessionId: "s1", relevanceScore: 0.9, reuseScore: 0.9 }],
      "s1",
    );
    expect(rec[0]?.action).toBe("retain");
    expect(memory.current("new-thing")).toBeUndefined();
  });

  it("flags high-reuse, low-relevance groups as parallel-agent candidates", () => {
    const memory = new AgentMemory("agent_1");
    memory.retain({ concept: "billing-logic", content: "x", sessionId: "s1", relevanceScore: 0.1, reuseScore: 0.9 });
    memory.retain({ concept: "core-flow", content: "y", sessionId: "s1", relevanceScore: 0.9, reuseScore: 0.9 });

    const recs = memory.recommendParallelAgents();
    expect(recs.map((r) => r.concept)).toEqual(["billing-logic"]);
  });

  it("tracks lineage back to a parent agent and originating session", () => {
    const store = new AgentMemoryStore();
    const child = store.getOrCreate("agent_child", { parentAgentId: "agent_parent", originatingSessionId: "s1" });
    expect(child.lineage).toEqual({ parentAgentId: "agent_parent", originatingSessionId: "s1" });
  });
});
