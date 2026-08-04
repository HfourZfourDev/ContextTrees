import type { RelevanceScorer } from "./types.js";
import { KeywordOverlapScorer } from "./keyword-overlap.js";
import { LlamaCppScorer, type LlamaCppScorerOptions } from "./llama-cpp.js";
import { AppleIntelligenceScorer, type AppleIntelligenceScorerOptions } from "./apple.js";

/**
 * The three context-manager scoring options a selection UI offers, in
 * priority order: no-model default, local model (llama.cpp), device AI
 * (Apple first). Selecting "none" needs no further input; selecting
 * "local-llama-cpp" or "device-apple" is where the user gets prompted for
 * the remaining fields on that variant (server URL/model; embedding
 * variant — the native bridge itself comes from the host app, not user
 * input).
 */
export type ScorerConfig =
  | { kind: "none" }
  | ({ kind: "local-llama-cpp" } & LlamaCppScorerOptions)
  | ({ kind: "device-apple" } & AppleIntelligenceScorerOptions);

export function createScorer(config: ScorerConfig): RelevanceScorer {
  switch (config.kind) {
    case "none":
      return new KeywordOverlapScorer();
    case "local-llama-cpp":
      return new LlamaCppScorer(config);
    case "device-apple":
      return new AppleIntelligenceScorer(config);
    default: {
      const exhaustive: never = config;
      throw new Error(`createScorer: unknown scorer kind ${JSON.stringify(exhaustive)}`);
    }
  }
}
