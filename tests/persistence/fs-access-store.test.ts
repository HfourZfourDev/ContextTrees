import { describe, expect, it } from "vitest";
import { Director } from "../../src/director.js";
import {
  loadOrCreateProjectInDirectory,
  loadProjectFromDirectory,
  saveProjectToDirectory,
} from "../../src/persistence/fs-access-store.js";

/**
 * Minimal in-memory stand-in for `FileSystemDirectoryHandle` — there's no
 * real File System Access API in Node. It implements just the surface this
 * adapter uses (`getDirectoryHandle`/`getFileHandle`/`createWritable`/
 * `getFile`), including the same `NotFoundError` DOMException the real API
 * throws for `{ create: false }` misses, so the adapter's control flow is
 * exercised faithfully. The real API's swap-file atomicity (verified
 * separately against MDN/spec) is not itself under test here.
 */
class MockWritable {
  private pending = "";
  constructor(private readonly file: MockFileHandle) {}
  async write(data: string): Promise<void> {
    this.pending += data;
  }
  async close(): Promise<void> {
    this.file.content = this.pending;
  }
  async abort(): Promise<void> {
    // discard `pending`; the file's committed content is untouched
  }
}

class MockFileHandle {
  readonly kind = "file";
  content = "";
  async createWritable(): Promise<MockWritable> {
    return new MockWritable(this);
  }
  async getFile(): Promise<{ text: () => Promise<string> }> {
    return { text: async () => this.content };
  }
}

class MockDirectoryHandle {
  readonly kind = "directory";
  private readonly dirs = new Map<string, MockDirectoryHandle>();
  private readonly files = new Map<string, MockFileHandle>();

  async getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<MockDirectoryHandle> {
    let dir = this.dirs.get(name);
    if (!dir) {
      if (!options?.create) throw new DOMException(`directory "${name}" not found`, "NotFoundError");
      dir = new MockDirectoryHandle();
      this.dirs.set(name, dir);
    }
    return dir;
  }

  async getFileHandle(name: string, options?: { create?: boolean }): Promise<MockFileHandle> {
    let file = this.files.get(name);
    if (!file) {
      if (!options?.create) throw new DOMException(`file "${name}" not found`, "NotFoundError");
      file = new MockFileHandle();
      this.files.set(name, file);
    }
    return file;
  }
}

function mockDirectory(): FileSystemDirectoryHandle {
  return new MockDirectoryHandle() as unknown as FileSystemDirectoryHandle;
}

describe("fs-access-store", () => {
  it("saves and reloads a project, preserving its state", async () => {
    const director = new Director();
    const feature = director.designMap.addNode("feature", "Search", null, { status: "built", summary: "full-text search" });
    const dir = mockDirectory();

    await saveProjectToDirectory(director, dir);
    const restored = await loadProjectFromDirectory(dir);

    expect(restored.designMap.current(feature.id).summary).toBe("full-text search");
  });

  it("creates intermediate directories from the default nested path", async () => {
    const director = new Director();
    const dir = mockDirectory();

    await saveProjectToDirectory(director, dir);
    const inner = await dir.getDirectoryHandle(".contexttrees", { create: false });
    const fileHandle = await inner.getFileHandle("project.json", { create: false });
    const raw = await (await fileHandle.getFile()).text();
    expect(JSON.parse(raw).schemaVersion).toBe(1);
  });

  it("preserves version history and edge relevance signals exactly (round-trip fidelity)", async () => {
    const director = new Director();
    const auth = director.designMap.addNode("feature", "Auth", null, { status: "built" });
    const payments = director.designMap.addNode("feature", "Payments", null, { status: "shell" });
    director.designMap.update(auth.id, { summary: "Auth v2", status: "built", roadmap: ["add MFA"], bugs: [], futureReview: [] });
    director.designMap.addEdge(auth.id, payments.id, "integrates-with", { dependency: 0.9, importance: 0.6, recency: 0.5 });
    const before = director.designMap.history(auth.id);
    const dir = mockDirectory();

    await saveProjectToDirectory(director, dir);
    const restored = await loadProjectFromDirectory(dir);

    expect(restored.designMap.history(auth.id)).toEqual(before);
    const edge = restored.designMap.edgesFrom(auth.id).find((e) => e.toNodeId === payments.id);
    expect(edge?.relevance).toEqual({ dependency: 0.9, importance: 0.6, recency: 0.5 });
  });

  it("supports a custom relative path", async () => {
    const director = new Director();
    director.designMap.addNode("feature", "Search");
    const dir = mockDirectory();

    await saveProjectToDirectory(director, dir, "nested/deeper/project.json");
    const restored = await loadProjectFromDirectory(dir, "nested/deeper/project.json");

    expect(restored.designMap.allNodes()).toHaveLength(1);
  });

  it("overwriting an existing file reflects the latest state, not stale data", async () => {
    const director = new Director();
    const feature = director.designMap.addNode("feature", "Search", null, { status: "planned" });
    const dir = mockDirectory();
    await saveProjectToDirectory(director, dir);

    director.designMap.update(feature.id, { summary: "shipped", status: "built", roadmap: [], bugs: [], futureReview: [] });
    await saveProjectToDirectory(director, dir);

    const restored = await loadProjectFromDirectory(dir);
    expect(restored.designMap.current(feature.id).status).toBe("built");
  });

  it("loadProjectFromDirectory throws a NotFoundError DOMException when the file doesn't exist", async () => {
    const dir = mockDirectory();
    await expect(loadProjectFromDirectory(dir)).rejects.toMatchObject({ name: "NotFoundError" });
  });

  it("loadOrCreateProjectInDirectory returns a fresh empty project on first run, without throwing", async () => {
    const dir = mockDirectory();
    const director = await loadOrCreateProjectInDirectory(dir);
    expect(director.designMap.allNodes()).toHaveLength(0);
  });

  it("loadOrCreateProjectInDirectory loads the real project when one exists", async () => {
    const original = new Director();
    original.designMap.addNode("feature", "Search");
    const dir = mockDirectory();
    await saveProjectToDirectory(original, dir);

    const restored = await loadOrCreateProjectInDirectory(dir);
    expect(restored.designMap.allNodes()).toHaveLength(1);
  });
});
