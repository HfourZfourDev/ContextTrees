import type { RelevanceScoreInput, RelevanceScorer } from "./types.js";
import { cosineSimilarity } from "./util.js";

export interface LlamaCppScorerOptions {
  /** Base URL of a running llama.cpp server (`llama-server`). Default: http://127.0.0.1:8080 */
  baseUrl?: string;
  /** Model identifier, only needed if the server multiplexes several models. */
  model?: string;
  /** Use the older `/embedding` endpoint instead of the OpenAI-compatible `/v1/embeddings` one. */
  legacyEndpoint?: boolean;
  /** Injectable for tests or runtimes without a global `fetch`. */
  fetchImpl?: typeof fetch;
}

interface OpenAiEmbeddingsResponse {
  data: { embedding: number[] }[];
}

interface LegacyEmbeddingResponse {
  embedding: number[];
}

/**
 * Scores relevance using embeddings from a locally running llama.cpp
 * server. This is the "offline model" option: the user runs `llama-server`
 * themselves (any embedding-capable GGUF model, e.g. a Gemma embedding
 * build) and points ContextTrees at it — the library never bundles,
 * downloads, or launches a model.
 */
export class LlamaCppScorer implements RelevanceScorer {
  readonly kind = "local-llama-cpp" as const;
  private baseUrl: string;
  private model: string | undefined;
  private legacyEndpoint: boolean;
  private fetchImpl: typeof fetch;

  constructor(options: LlamaCppScorerOptions = {}) {
    this.baseUrl = (options.baseUrl ?? "http://127.0.0.1:8080").replace(/\/+$/, "");
    this.model = options.model;
    this.legacyEndpoint = options.legacyEndpoint ?? false;
    const fetchImpl = options.fetchImpl ?? globalThis.fetch;
    if (!fetchImpl) {
      throw new Error("LlamaCppScorer: no fetch implementation available in this runtime; pass options.fetchImpl");
    }
    this.fetchImpl = fetchImpl;
  }

  async scoreRelevance({ content, branchContext }: RelevanceScoreInput): Promise<number> {
    const [a, b] = await Promise.all([this.embed(content), this.embed(branchContext)]);
    return cosineSimilarity(a, b);
  }

  private async embed(text: string): Promise<number[]> {
    if (this.legacyEndpoint) {
      const res = await this.fetchImpl(`${this.baseUrl}/embedding`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: text }),
      });
      if (!res.ok) {
        throw new Error(`LlamaCppScorer: POST /embedding failed (${res.status} ${res.statusText})`);
      }
      const body = (await res.json()) as LegacyEmbeddingResponse;
      return body.embedding;
    }

    const res = await this.fetchImpl(`${this.baseUrl}/v1/embeddings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: text, ...(this.model ? { model: this.model } : {}) }),
    });
    if (!res.ok) {
      throw new Error(`LlamaCppScorer: POST /v1/embeddings failed (${res.status} ${res.statusText})`);
    }
    const body = (await res.json()) as OpenAiEmbeddingsResponse;
    const embedding = body.data[0]?.embedding;
    if (!embedding) {
      throw new Error("LlamaCppScorer: /v1/embeddings response had no embedding data");
    }
    return embedding;
  }
}
