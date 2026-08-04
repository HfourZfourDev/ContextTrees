import { describe, expect, it } from "vitest";
import { KeywordOverlapScorer } from "../../src/scoring/keyword-overlap.js";

describe("KeywordOverlapScorer", () => {
  const scorer = new KeywordOverlapScorer();

  it("scores identical text as fully relevant", () => {
    const score = scorer.scoreRelevance({ content: "login form validation", branchContext: "login form validation" });
    expect(score).toBeCloseTo(1, 5);
  });

  it("scores disjoint vocabulary as zero", () => {
    const score = scorer.scoreRelevance({ content: "login form validation", branchContext: "pastry recipe notes" });
    expect(score).toBe(0);
  });

  it("scores partial overlap between zero and one", () => {
    const score = scorer.scoreRelevance({
      content: "login form validation rules",
      branchContext: "login session token handling",
    });
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(1);
  });

  it("is case- and punctuation-insensitive", () => {
    const score = scorer.scoreRelevance({ content: "Login-Form!", branchContext: "login form" });
    expect(score).toBeCloseTo(1, 5);
  });
});
