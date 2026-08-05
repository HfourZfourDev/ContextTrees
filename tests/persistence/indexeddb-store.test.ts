import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { Director } from "../../src/director.js";
import {
  loadOrCreateProjectFromIndexedDB,
  loadProjectFromIndexedDB,
  saveProjectToIndexedDB,
  ProjectNotFoundError,
} from "../../src/persistence/indexeddb-store.js";

let indexedDB: IDBFactory;

beforeEach(() => {
  indexedDB = new IDBFactory();
});

describe("indexeddb-store", () => {
  it("saves and reloads a project, preserving its state", async () => {
    const director = new Director();
    const feature = director.designMap.addNode("feature", "Search", null, { status: "built", summary: "full-text search" });

    await saveProjectToIndexedDB(director, { indexedDB });
    const restored = await loadProjectFromIndexedDB({ indexedDB });

    expect(restored.designMap.current(feature.id).summary).toBe("full-text search");
  });

  it("preserves version history and edge relevance signals exactly (round-trip fidelity)", async () => {
    const director = new Director();
    const auth = director.designMap.addNode("feature", "Auth", null, { status: "built" });
    const payments = director.designMap.addNode("feature", "Payments", null, { status: "shell" });
    director.designMap.update(auth.id, { summary: "Auth v2", status: "built", roadmap: ["add MFA"], bugs: [], futureReview: [] });
    director.designMap.addEdge(auth.id, payments.id, "integrates-with", { dependency: 0.9, importance: 0.6, recency: 0.5 });
    const before = director.designMap.history(auth.id);

    await saveProjectToIndexedDB(director, { indexedDB });
    const restored = await loadProjectFromIndexedDB({ indexedDB });

    expect(restored.designMap.history(auth.id)).toEqual(before);
    const edge = restored.designMap.edgesFrom(auth.id).find((e) => e.toNodeId === payments.id);
    expect(edge?.relevance).toEqual({ dependency: 0.9, importance: 0.6, recency: 0.5 });
  });

  it("overwriting an existing key reflects the latest state, not stale data", async () => {
    const director = new Director();
    const feature = director.designMap.addNode("feature", "Search", null, { status: "planned" });
    await saveProjectToIndexedDB(director, { indexedDB });

    director.designMap.update(feature.id, { summary: "shipped", status: "built", roadmap: [], bugs: [], futureReview: [] });
    await saveProjectToIndexedDB(director, { indexedDB });

    const restored = await loadProjectFromIndexedDB({ indexedDB });
    expect(restored.designMap.current(feature.id).status).toBe("built");
  });

  it("loadProjectFromIndexedDB throws ProjectNotFoundError when the key doesn't exist", async () => {
    await expect(loadProjectFromIndexedDB({ indexedDB })).rejects.toThrow(ProjectNotFoundError);
  });

  it("loadOrCreateProjectFromIndexedDB returns a fresh empty project on first run, without throwing", async () => {
    const director = await loadOrCreateProjectFromIndexedDB({ indexedDB });
    expect(director.designMap.allNodes()).toHaveLength(0);
  });

  it("loadOrCreateProjectFromIndexedDB loads the real project when one exists", async () => {
    const original = new Director();
    original.designMap.addNode("feature", "Search");
    await saveProjectToIndexedDB(original, { indexedDB });

    const restored = await loadOrCreateProjectFromIndexedDB({ indexedDB });
    expect(restored.designMap.allNodes()).toHaveLength(1);
  });

  it("keeps multiple projects independent under different projectIds in the same store", async () => {
    const a = new Director();
    a.designMap.addNode("feature", "Project A");
    const b = new Director();
    b.designMap.addNode("feature", "Project B");
    b.designMap.addNode("feature", "Project B second node");

    await saveProjectToIndexedDB(a, { indexedDB, projectId: "project-a" });
    await saveProjectToIndexedDB(b, { indexedDB, projectId: "project-b" });

    const restoredA = await loadProjectFromIndexedDB({ indexedDB, projectId: "project-a" });
    const restoredB = await loadProjectFromIndexedDB({ indexedDB, projectId: "project-b" });
    expect(restoredA.designMap.allNodes()).toHaveLength(1);
    expect(restoredB.designMap.allNodes()).toHaveLength(2);
  });

  it("throws a clear error when no IDBFactory is available and none is injected", async () => {
    const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");
    // @ts-expect-error -- simulating a runtime without a global indexedDB (e.g. plain Node)
    delete globalThis.indexedDB;
    try {
      await expect(loadProjectFromIndexedDB()).rejects.toThrow(/no IDBFactory available/);
    } finally {
      if (originalDescriptor) Object.defineProperty(globalThis, "indexedDB", originalDescriptor);
    }
  });
});
