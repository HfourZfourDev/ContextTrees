import { describe, expect, it } from "vitest";
import { createScorer } from "../../src/scoring/factory.js";
import { KeywordOverlapScorer } from "../../src/scoring/keyword-overlap.js";
import { LlamaCppScorer } from "../../src/scoring/llama-cpp.js";
import { AppleIntelligenceScorer } from "../../src/scoring/apple.js";

describe("createScorer", () => {
  it("builds the no-model default", () => {
    expect(createScorer({ kind: "none" })).toBeInstanceOf(KeywordOverlapScorer);
  });

  it("builds a llama.cpp scorer from server options", () => {
    const scorer = createScorer({ kind: "local-llama-cpp", baseUrl: "http://localhost:9000" });
    expect(scorer).toBeInstanceOf(LlamaCppScorer);
    expect(scorer.kind).toBe("local-llama-cpp");
  });

  it("builds an Apple device scorer from a native bridge", () => {
    const scorer = createScorer({ kind: "device-apple", bridge: { embed: async () => [1, 0] } });
    expect(scorer).toBeInstanceOf(AppleIntelligenceScorer);
    expect(scorer.kind).toBe("device-apple");
  });
});
