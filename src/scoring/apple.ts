import type { RelevanceScoreInput, RelevanceScorer } from "./types.js";
import { cosineSimilarity } from "./util.js";

/**
 * Bridge a host app supplies to reach Apple's on-device embeddings —
 * typically the NaturalLanguage framework's `NLEmbedding` (`wordEmbedding`
 * / `sentenceEmbedding`), invoked from a native Swift/Obj-C module and
 * exposed to JS however the host wires it (React Native native module,
 * Capacitor plugin, a local WKWebView message handler, etc).
 *
 * ContextTrees runs as plain JS in Node or a browser and has no way to
 * call into NLEmbedding directly — this interface is the seam a host
 * implements. It is NOT implemented here: there is no macOS/iOS runtime
 * in this environment to build or test a real bridge against, so shipping
 * a fake one would silently produce meaningless scores. Implementing and
 * validating the native side is future work for whichever app embeds
 * ContextTrees on Apple platforms.
 */
export interface NativeEmbeddingBridge {
  embed(text: string, opts?: { variant?: "word" | "sentence" }): Promise<number[]>;
}

export interface AppleIntelligenceScorerOptions {
  bridge: NativeEmbeddingBridge;
  /** NLEmbedding exposes separate word- and sentence-level embedding spaces; sentence is the more relevant default here. */
  variant?: "word" | "sentence";
}

/**
 * Device-AI scorer for Apple platforms — first device-AI target per
 * priority (Android/Gemini Nano etc. would follow the same
 * `NativeEmbeddingBridge` shape as a later, separate scorer). A thin
 * adapter: the real on-device call happens in `bridge`.
 */
export class AppleIntelligenceScorer implements RelevanceScorer {
  readonly kind = "device-apple" as const;
  private bridge: NativeEmbeddingBridge;
  private variant: "word" | "sentence" | undefined;

  constructor(options: AppleIntelligenceScorerOptions) {
    this.bridge = options.bridge;
    this.variant = options.variant;
  }

  async scoreRelevance({ content, branchContext }: RelevanceScoreInput): Promise<number> {
    const [a, b] = await Promise.all([
      this.bridge.embed(content, { variant: this.variant }),
      this.bridge.embed(branchContext, { variant: this.variant }),
    ]);
    return cosineSimilarity(a, b);
  }
}
