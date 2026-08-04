import { Director, type ProjectSnapshot, type RestoreDirectorOptions } from "../director.js";

/** Default relative path (within the caller-supplied directory) a project is read from/written to. */
export const DEFAULT_RELATIVE_PATH = ".contexttrees/project.json";

/**
 * Browser-only adapter (File System Access API — `FileSystemDirectoryHandle`,
 * `createWritable()`). **Chromium only**: Chrome/Edge/Opera implement the
 * local-disk picker methods this relies on (`showDirectoryPicker` and the
 * handle returned by it); Firefox and Safari expose only the sandboxed
 * Origin Private File System, not access to a real user-chosen folder, so
 * this module does nothing useful there. Feature-detect
 * (`"showDirectoryPicker" in window`) before offering this option in a host
 * UI, and offer `persistence-indexeddb` as the universal fallback.
 *
 * This module never asks for permission itself — the host app owns getting
 * a `FileSystemDirectoryHandle` (via `showDirectoryPicker()` or a
 * previously-persisted handle) and any `requestPermission()` dance; these
 * functions assume a handle they're given is already usable.
 *
 * Atomicity: per the spec and MDN, `createWritable()` writes to a temporary
 * swap file and only replaces the real file when the stream is `close()`d,
 * so a crash mid-write can't leave a truncated/corrupt project file — the
 * same guarantee the Node file-store adapter gets from write-temp-then-
 * rename. One caveat the Node adapter doesn't have: the default `"siloed"`
 * locking mode lets multiple independent writers open concurrently, each
 * with its own swap file, and the *last one closed* wins — two overlapping
 * saves silently last-write-wins rather than erroring, since this module
 * doesn't request `"exclusive"` mode.
 */
export interface LoadFsAccessOptions extends RestoreDirectorOptions {}

function isNotFoundError(err: unknown): boolean {
  return err instanceof DOMException && err.name === "NotFoundError";
}

async function getFileHandleForPath(
  directory: FileSystemDirectoryHandle,
  path: string,
  create: boolean,
): Promise<FileSystemFileHandle> {
  const segments = path.split("/").filter(Boolean);
  if (segments.length === 0) {
    throw new Error(`fs-access-store: path "${path}" is empty`);
  }
  let dir = directory;
  for (const segment of segments.slice(0, -1)) {
    dir = await dir.getDirectoryHandle(segment, { create });
  }
  return dir.getFileHandle(segments[segments.length - 1]!, { create });
}

/**
 * Writes the project as JSON to `path` (default `.contexttrees/project.json`)
 * within `directory`. Creates intermediate directories and the file if they
 * don't exist yet.
 */
export async function saveProjectToDirectory(
  director: Director,
  directory: FileSystemDirectoryHandle,
  path: string = DEFAULT_RELATIVE_PATH,
): Promise<void> {
  const fileHandle = await getFileHandleForPath(directory, path, true);
  const writable = await fileHandle.createWritable();
  try {
    await writable.write(JSON.stringify(director.toSnapshot(), null, 2));
    await writable.close();
  } catch (err) {
    await writable.abort().catch(() => {});
    throw err;
  }
}

/** Loads and reconstructs a Director from `path` within `directory`. Throws (`DOMException` named `"NotFoundError"`) if the file doesn't exist — see `loadOrCreateProjectInDirectory` to handle first-run. */
export async function loadProjectFromDirectory(
  directory: FileSystemDirectoryHandle,
  path: string = DEFAULT_RELATIVE_PATH,
  options: LoadFsAccessOptions = {},
): Promise<Director> {
  const fileHandle = await getFileHandleForPath(directory, path, false);
  const file = await fileHandle.getFile();
  const text = await file.text();
  const snapshot = JSON.parse(text) as ProjectSnapshot;
  return Director.fromSnapshot(snapshot, options);
}

/** Like `loadProjectFromDirectory`, but returns a fresh, empty Director instead of throwing when `path` doesn't exist yet — the common first-run case for a browser host. */
export async function loadOrCreateProjectInDirectory(
  directory: FileSystemDirectoryHandle,
  path: string = DEFAULT_RELATIVE_PATH,
  options: LoadFsAccessOptions = {},
): Promise<Director> {
  try {
    return await loadProjectFromDirectory(directory, path, options);
  } catch (err) {
    if (isNotFoundError(err)) {
      return new Director(undefined, undefined, undefined, options.scorer);
    }
    throw err;
  }
}
