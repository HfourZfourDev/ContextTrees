import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Director } from "../../src/director.js";
import { loadOrCreateProjectFile, loadProjectFromFile, saveProjectToFile } from "../../src/persistence/file-store.js";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "contexttrees-test-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("file-store", () => {
  it("saves and reloads a project, preserving its state", async () => {
    const director = new Director();
    const feature = director.designMap.addNode("feature", "Search", null, { status: "built", summary: "full-text search" });
    const filePath = join(dir, "project.json");

    await saveProjectToFile(director, filePath);
    const restored = await loadProjectFromFile(filePath);

    expect(restored.designMap.current(feature.id).summary).toBe("full-text search");
  });

  it("creates parent directories that don't exist yet", async () => {
    const director = new Director();
    const filePath = join(dir, "nested", "deeper", "project.json");

    await saveProjectToFile(director, filePath);
    const raw = await readFile(filePath, "utf8");
    expect(JSON.parse(raw).schemaVersion).toBe(1);
  });

  it("overwriting an existing file reflects the latest state, not stale data", async () => {
    const director = new Director();
    const feature = director.designMap.addNode("feature", "Search", null, { status: "planned" });
    const filePath = join(dir, "project.json");
    await saveProjectToFile(director, filePath);

    director.designMap.update(feature.id, { summary: "shipped", status: "built", roadmap: [], bugs: [], futureReview: [] });
    await saveProjectToFile(director, filePath);

    const restored = await loadProjectFromFile(filePath);
    expect(restored.designMap.current(feature.id).status).toBe("built");
  });

  it("loadProjectFromFile throws when the file doesn't exist", async () => {
    await expect(loadProjectFromFile(join(dir, "nope.json"))).rejects.toThrow();
  });

  it("loadOrCreateProjectFile returns a fresh empty project on first run, without throwing", async () => {
    const director = await loadOrCreateProjectFile(join(dir, "nope.json"));
    expect(director.designMap.allNodes()).toHaveLength(0);
  });

  it("loadOrCreateProjectFile loads the real file when one exists", async () => {
    const original = new Director();
    original.designMap.addNode("feature", "Search");
    const filePath = join(dir, "project.json");
    await saveProjectToFile(original, filePath);

    const restored = await loadOrCreateProjectFile(filePath);
    expect(restored.designMap.allNodes()).toHaveLength(1);
  });

  it("does not leave a temp file behind after a successful save", async () => {
    const director = new Director();
    const filePath = join(dir, "project.json");
    await saveProjectToFile(director, filePath);

    const { readdir } = await import("node:fs/promises");
    const entries = await readdir(dir);
    expect(entries).toEqual(["project.json"]);
  });
});
