export interface RelevanceScoreInput {
  /** The candidate content being scored (e.g. a proposed agent-memory retain). */
  content: string;
  /** Text assembled from the design-map branch the scoring is relative to. */
  branchContext: string;
}

/**
 * Pluggable relevance scoring for context-manager decisions (agent-memory
 * trim, parallel-agent recommendations). `kind` identifies which of the
 * three integration options produced a given score, so recommendations can
 * report why a score was computed the way it was.
 */
export interface RelevanceScorer {
  readonly kind: string;
  scoreRelevance(input: RelevanceScoreInput): Promise<number> | number;
}
