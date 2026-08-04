import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { Director, type ProjectSnapshot, type RestoreDirectorOptions } from "../director.js";

export interface LoadProjectOptions extends RestoreDirectorOptions {}

/**
 * Writes the project to `filePath` as JSON. Atomic: written to a sibling
 * temp file first, then renamed into place, so a crash or power loss
 * mid-write can never leave a truncated/corrupt project file — the rename
 * either lands the new file whole or doesn't happen at all. Creates parent
 * directories if they don't exist.
 */
export async function saveProjectToFile(director: Director, filePath: string): Promise<void> {
  const json = JSON.stringify(director.toSnapshot(), null, 2);
  await mkdir(dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tmpPath, json, "utf8");
  await rename(tmpPath, filePath);
}

/** Loads and reconstructs a Director from a project file. Throws (ENOENT) if the file doesn't exist — see `loadOrCreateProjectFile` to handle first-run. */
export async function loadProjectFromFile(filePath: string, options: LoadProjectOptions = {}): Promise<Director> {
  const json = await readFile(filePath, "utf8");
  const snapshot = JSON.parse(json) as ProjectSnapshot;
  return Director.fromSnapshot(snapshot, options);
}

/** Like `loadProjectFromFile`, but returns a fresh, empty Director instead of throwing when `filePath` doesn't exist yet — the common first-run case for a CLI or long-lived host. */
export async function loadOrCreateProjectFile(filePath: string, options: LoadProjectOptions = {}): Promise<Director> {
  try {
    return await loadProjectFromFile(filePath, options);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return new Director(undefined, undefined, undefined, options.scorer);
    }
    throw err;
  }
}
