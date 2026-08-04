import type { EdgeRelevance } from "./types.js";

export type RelevanceCombinator = (relevance: EdgeRelevance) => number;

/**
 * Combines an edge's authored relevance signals into a single 0-1
 * traversal weight. Dependency (structural coupling) dominates — it's the
 * strongest signal for "do you actually need this to understand
 * behavior." Importance pulls weight up for relationships that matter even
 * without tight coupling. Recency, if supplied, is a mild tiebreaker only:
 * it can shave up to 20% off the base weight, never more, and never
 * dominates dependency/importance.
 */
export const defaultRelevanceCombinator: RelevanceCombinator = ({ dependency, importance, recency }) => {
  const base = 0.65 * dependency + 0.35 * importance;
  return recency === undefined ? base : base * (0.8 + 0.2 * recency);
};

export type ContextDetailLevel = "full" | "interface" | "reference";

export interface ContextTraversalOptions {
  /**
   * Fallback multiplicative decay applied to a parent -> child hop when
   * that specific pair has no explicit edge overriding it. An explicit
   * edge directly between a parent and one of its own children (authored
   * like any other edge) takes precedence over this default for that hop
   * — the escape hatch for "this particular child stays almost as
   * relevant as its parent, don't decay it the normal amount."
   */
  hierarchyDecay: number;
  /**
   * Minimum accumulated weight (product of every hop's weight from the
   * primary branch) for a node to be included in the context at all.
   * Because a single fixed threshold is compared against an
   * ever-shrinking product, it behaves like an adaptive *relative* bar:
   * a strong first hop (e.g. 0.8) leaves room for several more decayed
   * hops before dropping out, while a weak first hop (e.g. 0.3) leaves
   * almost none — its descendants need to retain nearly all of that 0.3
   * to still clear the same absolute line. No per-branch threshold
   * tuning needed; it falls out of the multiplication.
   */
  inclusionThreshold: number;
  /** Minimum weight for "full" detail (entire node content). */
  fullDetailThreshold: number;
  /** Minimum weight for "interface" detail (the node's own content only); below this but >= inclusionThreshold is "reference". */
  interfaceDetailThreshold: number;
  /** Combines an edge's dependency/importance/recency into the weight used for decay math. */
  combinator: RelevanceCombinator;
}

export const DEFAULT_TRAVERSAL_OPTIONS: ContextTraversalOptions = {
  hierarchyDecay: 0.7,
  inclusionThreshold: 0.2,
  fullDetailThreshold: 0.75,
  interfaceDetailThreshold: 0.45,
  combinator: defaultRelevanceCombinator,
};

export function classifyDetail(weight: number, options: ContextTraversalOptions): ContextDetailLevel {
  if (weight >= options.fullDetailThreshold) return "full";
  if (weight >= options.interfaceDetailThreshold) return "interface";
  return "reference";
}
