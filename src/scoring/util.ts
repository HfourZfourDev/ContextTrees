/**
 * Cosine similarity between two numeric vectors, clamped to [0, 1].
 * Embeddings from the same model rarely produce a strongly negative cosine
 * for related text, so negative values are treated as "no relevance"
 * rather than surfaced as a meaningful signal.
 */
export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  const len = Math.min(a.length, b.length);
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < len; i++) {
    const x = a[i]!;
    const y = b[i]!;
    dot += x * y;
    magA += x * x;
    magB += y * y;
  }
  if (magA === 0 || magB === 0) return 0;
  return Math.max(0, dot / (Math.sqrt(magA) * Math.sqrt(magB)));
}
