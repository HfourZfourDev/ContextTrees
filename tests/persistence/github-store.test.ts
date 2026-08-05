import { describe, expect, it } from "vitest";
import { Director } from "../../src/director.js";
import {
  GitHubConflictError,
  GitHubFileNotFoundError,
  getProjectFileSha,
  loadOrCreateProjectFromGitHub,
  loadProjectFromGitHub,
  saveProjectToGitHub,
} from "../../src/persistence/github-store.js";

/**
 * In-memory stand-in for the GitHub Contents API surface this adapter uses:
 * GET returns the current sha/content or 404, PUT enforces GitHub's real
 * sha-conflict semantics (409 when a supplied sha doesn't match the file's
 * current one) so the adapter's conflict handling is exercised faithfully.
 */
function createMockGitHubApi() {
  const files = new Map<string, { sha: string; contentBase64: string }>();
  let shaCounter = 0;

  function jsonResponse(status: number, statusText: string, body: unknown): Response {
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText,
      json: async () => body,
      text: async () => JSON.stringify(body),
    } as unknown as Response;
  }

  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(input.toString());
    const match = url.pathname.match(/^\/repos\/[^/]+\/[^/]+\/contents\/(.+)$/);
    if (!match) throw new Error(`mock github api: unrecognized path ${url.pathname}`);
    const path = decodeURIComponent(match[1]!);
    const method = init?.method ?? "GET";

    if (method === "GET") {
      const file = files.get(path);
      if (!file) return jsonResponse(404, "Not Found", { message: "Not Found" });
      return jsonResponse(200, "OK", { sha: file.sha, content: file.contentBase64 });
    }

    if (method === "PUT") {
      const body = JSON.parse(init!.body as string) as { sha?: string; content: string };
      const existing = files.get(path);
      if (existing && body.sha !== existing.sha) {
        return jsonResponse(409, "Conflict", { message: `${path} does not match ${body.sha}` });
      }
      shaCounter += 1;
      const newSha = `sha-${shaCounter}`;
      files.set(path, { sha: newSha, contentBase64: body.content });
      return jsonResponse(200, "OK", { content: { sha: newSha } });
    }

    throw new Error(`mock github api: unexpected method ${method}`);
  }) as typeof fetch;

  return { fetchImpl, files };
}

function target(fetchImpl: typeof fetch) {
  return { owner: "acme", repo: "project", path: "contexttrees/project.json", branch: "main", token: "t0k3n", fetchImpl };
}

describe("github-store", () => {
  it("saves and reloads a project, preserving its state", async () => {
    const { fetchImpl } = createMockGitHubApi();
    const director = new Director();
    const feature = director.designMap.addNode("feature", "Search", null, { status: "built", summary: "full-text search" });

    await saveProjectToGitHub(director, target(fetchImpl));
    const restored = await loadProjectFromGitHub(target(fetchImpl));

    expect(restored.designMap.current(feature.id).summary).toBe("full-text search");
  });

  it("preserves version history and edge relevance signals exactly (round-trip fidelity)", async () => {
    const { fetchImpl } = createMockGitHubApi();
    const director = new Director();
    const auth = director.designMap.addNode("feature", "Auth", null, { status: "built" });
    const payments = director.designMap.addNode("feature", "Payments", null, { status: "shell" });
    director.designMap.update(auth.id, { summary: "Auth v2", status: "built", roadmap: ["add MFA"], bugs: [], futureReview: [] });
    director.designMap.addEdge(auth.id, payments.id, "integrates-with", { dependency: 0.9, importance: 0.6, recency: 0.5 });
    const before = director.designMap.history(auth.id);

    await saveProjectToGitHub(director, target(fetchImpl));
    const restored = await loadProjectFromGitHub(target(fetchImpl));

    expect(restored.designMap.history(auth.id)).toEqual(before);
    const edge = restored.designMap.edgesFrom(auth.id).find((e) => e.toNodeId === payments.id);
    expect(edge?.relevance).toEqual({ dependency: 0.9, importance: 0.6, recency: 0.5 });
  });

  it("auto-resolves the current sha across repeated saves when none is supplied", async () => {
    const { fetchImpl } = createMockGitHubApi();
    const director = new Director();
    const feature = director.designMap.addNode("feature", "Search", null, { status: "planned" });

    await saveProjectToGitHub(director, target(fetchImpl));
    director.designMap.update(feature.id, { summary: "shipped", status: "built", roadmap: [], bugs: [], futureReview: [] });
    await saveProjectToGitHub(director, target(fetchImpl));

    const restored = await loadProjectFromGitHub(target(fetchImpl));
    expect(restored.designMap.current(feature.id).status).toBe("built");
  });

  it("throws GitHubConflictError when the supplied sha no longer matches the remote file", async () => {
    const { fetchImpl } = createMockGitHubApi();
    const director = new Director();
    const { sha } = await saveProjectToGitHub(director, target(fetchImpl));

    // Someone else commits in between.
    await saveProjectToGitHub(new Director(), target(fetchImpl));

    director.designMap.addNode("feature", "Late edit");
    await expect(saveProjectToGitHub(director, { ...target(fetchImpl), sha })).rejects.toThrow(GitHubConflictError);
  });

  it("getProjectFileSha returns null when the file doesn't exist, and the real sha once it does", async () => {
    const { fetchImpl } = createMockGitHubApi();
    expect(await getProjectFileSha(target(fetchImpl))).toBeNull();

    const { sha } = await saveProjectToGitHub(new Director(), target(fetchImpl));
    expect(await getProjectFileSha(target(fetchImpl))).toBe(sha);
  });

  it("loadProjectFromGitHub throws GitHubFileNotFoundError when the file doesn't exist", async () => {
    const { fetchImpl } = createMockGitHubApi();
    await expect(loadProjectFromGitHub(target(fetchImpl))).rejects.toThrow(GitHubFileNotFoundError);
  });

  it("loadOrCreateProjectFromGitHub returns a fresh empty project on first run, without throwing", async () => {
    const { fetchImpl } = createMockGitHubApi();
    const director = await loadOrCreateProjectFromGitHub(target(fetchImpl));
    expect(director.designMap.allNodes()).toHaveLength(0);
  });

  it("loadOrCreateProjectFromGitHub loads the real project when one exists", async () => {
    const { fetchImpl } = createMockGitHubApi();
    const original = new Director();
    original.designMap.addNode("feature", "Search");
    await saveProjectToGitHub(original, target(fetchImpl));

    const restored = await loadOrCreateProjectFromGitHub(target(fetchImpl));
    expect(restored.designMap.allNodes()).toHaveLength(1);
  });

  it("throws when no fetch implementation is available", async () => {
    const originalFetch = globalThis.fetch;
    // @ts-expect-error deliberately simulating a runtime without fetch
    globalThis.fetch = undefined;
    try {
      await expect(
        loadProjectFromGitHub({ owner: "acme", repo: "project", path: "p.json", branch: "main", token: "t" }),
      ).rejects.toThrow(/fetch/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
