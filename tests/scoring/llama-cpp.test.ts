import { describe, expect, it, vi } from "vitest";
import { LlamaCppScorer } from "../../src/scoring/llama-cpp.js";

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => body,
  } as unknown as Response;
}

describe("LlamaCppScorer", () => {
  it("embeds via the OpenAI-compatible /v1/embeddings endpoint by default", async () => {
    const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const body = JSON.parse(init!.body as string) as { input: string };
      const vector = body.input === "content" ? [1, 0, 0] : [1, 0, 0];
      expect(url.toString()).toBe("http://127.0.0.1:8080/v1/embeddings");
      return jsonResponse({ data: [{ embedding: vector }] });
    });

    const scorer = new LlamaCppScorer({ fetchImpl });
    const score = await scorer.scoreRelevance({ content: "content", branchContext: "branch" });
    expect(score).toBeCloseTo(1, 5);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("falls back to the legacy /embedding endpoint when configured", async () => {
    const fetchImpl = vi.fn(async (url: string | URL) => {
      expect(url.toString()).toBe("http://localhost:9000/embedding");
      return jsonResponse({ embedding: [0, 1, 0] });
    });

    const scorer = new LlamaCppScorer({ baseUrl: "http://localhost:9000", legacyEndpoint: true, fetchImpl });
    const score = await scorer.scoreRelevance({ content: "content", branchContext: "branch" });
    expect(score).toBeCloseTo(1, 5);
  });

  it("orthogonal embeddings score zero relevance", async () => {
    let call = 0;
    const fetchImpl = vi.fn(async () => {
      call += 1;
      return jsonResponse({ data: [{ embedding: call === 1 ? [1, 0] : [0, 1] }] });
    });

    const scorer = new LlamaCppScorer({ fetchImpl });
    const score = await scorer.scoreRelevance({ content: "content", branchContext: "branch" });
    expect(score).toBe(0);
  });

  it("throws a clear error on a non-ok response", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 500, statusText: "Internal Server Error" }) as Response);
    const scorer = new LlamaCppScorer({ fetchImpl });
    await expect(scorer.scoreRelevance({ content: "a", branchContext: "b" })).rejects.toThrow(/500/);
  });

  it("throws when no fetch implementation is available", () => {
    const originalFetch = globalThis.fetch;
    // @ts-expect-error deliberately simulating a runtime without fetch
    globalThis.fetch = undefined;
    try {
      expect(() => new LlamaCppScorer()).toThrow(/fetch/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
