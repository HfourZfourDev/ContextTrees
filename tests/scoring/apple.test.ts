import { describe, expect, it, vi } from "vitest";
import { AppleIntelligenceScorer, type NativeEmbeddingBridge } from "../../src/scoring/apple.js";

describe("AppleIntelligenceScorer", () => {
  it("delegates embedding to the supplied bridge and scores cosine similarity", async () => {
    const embed = vi.fn(async (text: string) => (text === "content" ? [1, 0] : [1, 0]));
    const bridge: NativeEmbeddingBridge = { embed };

    const scorer = new AppleIntelligenceScorer({ bridge });
    const score = await scorer.scoreRelevance({ content: "content", branchContext: "branch" });

    expect(score).toBeCloseTo(1, 5);
    expect(embed).toHaveBeenCalledWith("content", { variant: undefined });
    expect(embed).toHaveBeenCalledWith("branch", { variant: undefined });
  });

  it("passes the configured variant through to the bridge", async () => {
    const embed = vi.fn(async () => [1, 0]);
    const scorer = new AppleIntelligenceScorer({ bridge: { embed }, variant: "sentence" });

    await scorer.scoreRelevance({ content: "a", branchContext: "b" });

    expect(embed).toHaveBeenCalledWith("a", { variant: "sentence" });
    expect(embed).toHaveBeenCalledWith("b", { variant: "sentence" });
  });
});
