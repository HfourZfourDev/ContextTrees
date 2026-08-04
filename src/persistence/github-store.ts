import { Director, type ProjectSnapshot, type RestoreDirectorOptions } from "../director.js";

/**
 * Talks to the GitHub Contents API (`/repos/{owner}/{repo}/contents/{path}`)
 * via plain `fetch` — no `@octokit`/SDK dependency, matching how
 * `src/scoring/llama-cpp.ts` talks to its HTTP API. The caller supplies
 * `owner`, `repo`, `path`, `branch`, and an auth token; this module never
 * bundles, stores, or assumes credentials.
 *
 * **Direct-commit only.** This adapter commits straight to `branch`. Opening
 * a pull request instead — which would make this a genuine review mechanism
 * matching `Director`'s manual-review mode — is a distinctly bigger feature
 * (PR create, base/head branch management, a way to surface the PR back to
 * the caller) and is deliberately out of scope here; treat it as a separate
 * follow-up, not an implicit part of this module.
 *
 * **Conflict handling.** Updating a file requires the blob `sha` of what
 * you're replacing. If a `sha` isn't supplied to `saveProjectToGitHub`, the
 * current one is auto-resolved via a GET immediately before the write. That
 * still leaves a race window (something else commits between the GET and
 * the PUT) — GitHub's own atomic sha check on the PUT is what actually
 * prevents a silent clobber: a mismatched sha comes back as an HTTP 409,
 * which this module surfaces as a `GitHubConflictError` rather than
 * swallowing or retrying automatically. Callers doing an explicit
 * read-modify-write should capture the sha via `getProjectFileSha` (or the
 * sha returned by a prior `saveProjectToGitHub`) and pass it back in, so a
 * real concurrent edit is detected instead of last-write-wins.
 */
export interface GitHubTarget {
  owner: string;
  repo: string;
  /** Path to the project file within the repo, e.g. `"contexttrees/project.json"`. */
  path: string;
  /** Branch to read from / commit to. No default — callers must be explicit about which branch they're targeting. */
  branch: string;
  /** Personal access token / installation token with `contents:write` (or classic `repo`) scope. Never bundled or defaulted by this module. */
  token: string;
  /** Commit message for writes. Default: `"Update ContextTrees project snapshot"`. */
  message?: string;
  /** API base URL, for GitHub Enterprise Server. Default: `"https://api.github.com"`. */
  apiBaseUrl?: string;
  /** Injectable for tests or runtimes without a global `fetch`. */
  fetchImpl?: typeof fetch;
}

export interface SaveGitHubOptions extends GitHubTarget {
  /**
   * Blob sha this save expects to be replacing (optimistic concurrency).
   * Omit to auto-resolve the current sha right before writing — see the
   * module-level doc for what that does and doesn't protect against.
   */
  sha?: string;
}

export interface LoadGitHubOptions extends GitHubTarget, RestoreDirectorOptions {}

/** Thrown when a write's sha no longer matches the file's current sha on GitHub (HTTP 409) — something else committed to it since the sha this save was based on. */
export class GitHubConflictError extends Error {
  constructor(path: string, branch: string) {
    super(
      `github-store: conflicting update to "${path}" on branch "${branch}" — it changed since the sha this save was based on; reload and retry`,
    );
    this.name = "GitHubConflictError";
  }
}

/** Thrown by `loadProjectFromGitHub` when `path` doesn't exist on `branch` yet. */
export class GitHubFileNotFoundError extends Error {
  constructor(path: string, branch: string) {
    super(`github-store: no file found at "${path}" on branch "${branch}"`);
    this.name = "GitHubFileNotFoundError";
  }
}

/** Thrown for any other non-2xx response from the GitHub API (auth failure, rate limit, etc.). */
export class GitHubApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "GitHubApiError";
  }
}

function resolveFetch(fetchImpl?: typeof fetch): typeof fetch {
  const resolved = fetchImpl ?? globalThis.fetch;
  if (!resolved) {
    throw new Error("github-store: no fetch implementation available in this runtime; pass options.fetchImpl");
  }
  return resolved;
}

function contentsUrl(target: GitHubTarget): string {
  const base = (target.apiBaseUrl ?? "https://api.github.com").replace(/\/+$/, "");
  const encodedPath = target.path
    .split("/")
    .filter(Boolean)
    .map(encodeURIComponent)
    .join("/");
  return `${base}/repos/${encodeURIComponent(target.owner)}/${encodeURIComponent(target.repo)}/contents/${encodedPath}`;
}

function authHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

function utf8ToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToUtf8(base64: string): string {
  const binary = atob(base64.replace(/\n/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

interface RemoteFile {
  sha: string;
  content: string;
}

async function fetchRemoteFile(target: GitHubTarget, fetchImpl: typeof fetch): Promise<RemoteFile | null> {
  const url = `${contentsUrl(target)}?ref=${encodeURIComponent(target.branch)}`;
  const res = await fetchImpl(url, { headers: authHeaders(target.token) });
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new GitHubApiError(res.status, `github-store: GET contents failed (${res.status} ${res.statusText})`);
  }
  const body = (await res.json()) as { sha: string; content: string } | unknown[];
  if (Array.isArray(body)) {
    throw new Error(`github-store: "${target.path}" is a directory, not a file`);
  }
  return { sha: body.sha, content: base64ToUtf8(body.content) };
}

/**
 * Commits the project snapshot as JSON to `path` on `branch`, creating the
 * file if it doesn't exist yet. Returns the blob sha of the new commit's
 * content, so a caller can chain it into a later `save`'s `sha` for
 * optimistic-concurrency checks.
 */
export async function saveProjectToGitHub(director: Director, options: SaveGitHubOptions): Promise<{ sha: string }> {
  const fetchImpl = resolveFetch(options.fetchImpl);
  let sha = options.sha;
  if (sha === undefined) {
    const existing = await fetchRemoteFile(options, fetchImpl);
    sha = existing?.sha;
  }

  const res = await fetchImpl(contentsUrl(options), {
    method: "PUT",
    headers: { ...authHeaders(options.token), "Content-Type": "application/json" },
    body: JSON.stringify({
      message: options.message ?? "Update ContextTrees project snapshot",
      content: utf8ToBase64(JSON.stringify(director.toSnapshot(), null, 2)),
      branch: options.branch,
      ...(sha ? { sha } : {}),
    }),
  });

  if (res.status === 409) {
    throw new GitHubConflictError(options.path, options.branch);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new GitHubApiError(res.status, `github-store: PUT contents failed (${res.status} ${res.statusText}): ${text}`);
  }
  const json = (await res.json()) as { content: { sha: string } };
  return { sha: json.content.sha };
}

/** Reads and reconstructs a Director from `path` on `branch`. Throws `GitHubFileNotFoundError` if it doesn't exist — see `loadOrCreateProjectFromGitHub` to handle first-run. */
export async function loadProjectFromGitHub(options: LoadGitHubOptions): Promise<Director> {
  const fetchImpl = resolveFetch(options.fetchImpl);
  const existing = await fetchRemoteFile(options, fetchImpl);
  if (!existing) {
    throw new GitHubFileNotFoundError(options.path, options.branch);
  }
  const snapshot = JSON.parse(existing.content) as ProjectSnapshot;
  return Director.fromSnapshot(snapshot, options);
}

/** Like `loadProjectFromGitHub`, but returns a fresh, empty Director instead of throwing when `path` doesn't exist on `branch` yet — the common first-run case for a new project. */
export async function loadOrCreateProjectFromGitHub(options: LoadGitHubOptions): Promise<Director> {
  try {
    return await loadProjectFromGitHub(options);
  } catch (err) {
    if (err instanceof GitHubFileNotFoundError) {
      return new Director(undefined, undefined, undefined, options.scorer);
    }
    throw err;
  }
}

/** The current blob sha of `path` on `branch`, or `null` if it doesn't exist — capture this before an edit and pass it back as `sha` to `saveProjectToGitHub` to detect a concurrent write instead of silently overwriting it. */
export async function getProjectFileSha(target: GitHubTarget): Promise<string | null> {
  const fetchImpl = resolveFetch(target.fetchImpl);
  const existing = await fetchRemoteFile(target, fetchImpl);
  return existing?.sha ?? null;
}
