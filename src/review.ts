import type { ReviewMode, ReviewModeConfig } from "./types.js";

/**
 * Per-branch review mode, confirmed by the user at the start of each
 * session. Independent per branch: e.g. auto for the design map (low risk,
 * auditable in the map itself) but manual for agent memory (invisible
 * state, higher trust cost). Auto-trim/auto-merge always compute a
 * recommendation regardless of mode; "manual" only gates the commit.
 */
export function reviewModeConfig(designMap: ReviewMode, agentMemory: ReviewMode): ReviewModeConfig {
  return { designMap, agentMemory };
}

export const AUTO_REVIEW: ReviewModeConfig = reviewModeConfig("auto", "auto");
export const MANUAL_REVIEW: ReviewModeConfig = reviewModeConfig("manual", "manual");
