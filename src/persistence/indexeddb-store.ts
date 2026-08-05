import { Director, type ProjectSnapshot, type RestoreDirectorOptions } from "../director.js";

/** Default IndexedDB database name. Override via `IndexedDBTarget.dbName`. */
export const DEFAULT_DB_NAME = "contexttrees";
/** Default object store name within the database. Override via `IndexedDBTarget.storeName`. */
export const DEFAULT_STORE_NAME = "projects";
/** Default key a project is stored under. Override via `IndexedDBTarget.projectId` to keep multiple projects in one store. */
export const DEFAULT_PROJECT_ID = "default";

export interface IndexedDBTarget {
  /** IndexedDB database name. Default: `"contexttrees"`. */
  dbName?: string;
  /** Object store name within the database. Default: `"projects"`. */
  storeName?: string;
  /**
   * Key this project is stored under, so a single database/store can hold
   * more than one project (e.g. one per workspace a host app manages).
   * Default: `"default"`.
   */
  projectId?: string;
  /**
   * Injectable `IDBFactory` — pass one from `fake-indexeddb` under Node
   * (there's no global `indexedDB` there), or any other implementation.
   * Defaults to `globalThis.indexedDB`.
   */
  indexedDB?: IDBFactory;
}

export interface LoadIndexedDBOptions extends IndexedDBTarget, RestoreDirectorOptions {}

/** Thrown by `loadProjectFromIndexedDB` when no project is stored under the given key yet. */
export class ProjectNotFoundError extends Error {
  constructor(projectId: string) {
    super(`indexeddb-store: no project found for id "${projectId}"`);
    this.name = "ProjectNotFoundError";
  }
}

function resolveFactory(factory?: IDBFactory): IDBFactory {
  const resolved = factory ?? globalThis.indexedDB;
  if (!resolved) {
    throw new Error(
      "indexeddb-store: no IDBFactory available in this runtime; pass options.indexedDB (e.g. from the `fake-indexeddb` package under Node)",
    );
  }
  return resolved;
}

function openDatabase(dbName: string, storeName: string, factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(dbName, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(storeName)) {
        db.createObjectStore(storeName);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("indexeddb-store: failed to open database"));
  });
}

function runRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("indexeddb-store: request failed"));
  });
}

function awaitTransaction(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("indexeddb-store: transaction failed"));
    tx.onabort = () => reject(tx.error ?? new Error("indexeddb-store: transaction aborted"));
  });
}

/**
 * Writes the project into an IndexedDB object store, keyed by `projectId`.
 * Unlike the Node file-store adapter, no temp-key/rename dance is needed:
 * an IndexedDB transaction already commits atomically (either the whole
 * `put` lands or none of it does).
 */
export async function saveProjectToIndexedDB(director: Director, target: IndexedDBTarget = {}): Promise<void> {
  const dbName = target.dbName ?? DEFAULT_DB_NAME;
  const storeName = target.storeName ?? DEFAULT_STORE_NAME;
  const projectId = target.projectId ?? DEFAULT_PROJECT_ID;
  const factory = resolveFactory(target.indexedDB);

  const db = await openDatabase(dbName, storeName, factory);
  try {
    const tx = db.transaction(storeName, "readwrite");
    tx.objectStore(storeName).put(director.toSnapshot(), projectId);
    await awaitTransaction(tx);
  } finally {
    db.close();
  }
}

/** Loads and reconstructs a Director from IndexedDB. Throws `ProjectNotFoundError` if `projectId` isn't stored yet — see `loadOrCreateProjectFromIndexedDB` to handle first-run. */
export async function loadProjectFromIndexedDB(options: LoadIndexedDBOptions = {}): Promise<Director> {
  const dbName = options.dbName ?? DEFAULT_DB_NAME;
  const storeName = options.storeName ?? DEFAULT_STORE_NAME;
  const projectId = options.projectId ?? DEFAULT_PROJECT_ID;
  const factory = resolveFactory(options.indexedDB);

  const db = await openDatabase(dbName, storeName, factory);
  try {
    const tx = db.transaction(storeName, "readonly");
    const snapshot = await runRequest<ProjectSnapshot | undefined>(tx.objectStore(storeName).get(projectId));
    if (snapshot === undefined) {
      throw new ProjectNotFoundError(projectId);
    }
    return Director.fromSnapshot(snapshot, options);
  } finally {
    db.close();
  }
}

/** Like `loadProjectFromIndexedDB`, but returns a fresh, empty Director instead of throwing when `projectId` doesn't exist yet — the common first-run case for a browser host. */
export async function loadOrCreateProjectFromIndexedDB(options: LoadIndexedDBOptions = {}): Promise<Director> {
  try {
    return await loadProjectFromIndexedDB(options);
  } catch (err) {
    if (err instanceof ProjectNotFoundError) {
      return new Director(undefined, undefined, undefined, options.scorer);
    }
    throw err;
  }
}
