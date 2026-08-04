import type { RelevanceScoreInput, RelevanceScorer } from "./types.js";

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 0);
}

function termFrequencies(tokens: string[]): Map<string, number> {
  const freq = new Map<string, number>();
  for (const token of tokens) {
    freq.set(token, (freq.get(token) ?? 0) + 1);
  }
  return freq;
}

function cosineSimilarity(a: Map<string, number>, b: Map<string, number>): number {
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (const count of a.values()) magA += count * count;
  for (const count of b.values()) magB += count * count;
  for (const [token, countA] of a) {
    const countB = b.get(token);
    if (countB) dot += countA * countB;
  }
  if (magA === 0 || magB === 0) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

/**
 * The "no offline model" default: term-frequency cosine similarity between
 * candidate content and the design-map branch text. No embeddings, no
 * corpus/IDF statistics, no network calls — dependency-free and legible,
 * per the spec's bar that a user should be able to tell why something
 * scored the way it did. Weaker than an embedding model across paraphrases
 * (different wording for the same idea scores low), which is the tradeoff
 * for having zero setup.
 */
export class KeywordOverlapScorer implements RelevanceScorer {
  readonly kind = "none" as const;

  scoreRelevance({ content, branchContext }: RelevanceScoreInput): number {
    const a = termFrequencies(tokenize(content));
    const b = termFrequencies(tokenize(branchContext));
    return cosineSimilarity(a, b);
  }
}
