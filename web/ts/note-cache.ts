import type { NoteDocument, NoteMeta } from "./types.generated.ts";

export type CachedNoteBody = {
  vault: number;
  noteId: string;
  contentHash: string;
  seq: number;
  content: string;
  cachedAtMs: number;
};

const DB_NAME = "tansu2-note-body-cache";
const DB_VERSION = 1;
const STORE_NAME = "noteBodies";
const NOTE_INDEX = "by-note";
const CACHED_AT_INDEX = "by-cached-at";
const MAX_CACHE_ENTRIES = 300;

export async function getCachedNoteBody(
  vault: number,
  meta: Pick<NoteMeta, "noteId" | "contentHash">,
): Promise<CachedNoteBody | null> {
  try {
    const db = await openDatabase();
    try {
      const tx = db.transaction(STORE_NAME, "readonly");
      const done = transactionDone(tx);
      const request = tx
        .objectStore(STORE_NAME)
        .get([vault, meta.noteId, meta.contentHash]) as IDBRequest<CachedNoteBody | undefined>;
      const cached = await requestResult(request);
      await done;
      if (cached?.contentHash !== meta.contentHash) {
        return null;
      }
      return cached;
    } finally {
      db.close();
    }
  } catch {
    return null;
  }
}

export async function cacheNoteBody(vault: number, document: NoteDocument): Promise<void> {
  try {
    const db = await openDatabase();
    try {
      await putAndDeleteStaleHashes(db, {
        vault,
        noteId: document.meta.noteId,
        contentHash: document.meta.contentHash,
        seq: document.meta.seq,
        content: document.content,
        cachedAtMs: Date.now(),
      });
      await pruneCache(db);
    } finally {
      db.close();
    }
  } catch {
    return;
  }
}

export async function deleteCachedNoteBodies(vault: number, noteId: string): Promise<void> {
  try {
    const db = await openDatabase();
    try {
      const tx = db.transaction(STORE_NAME, "readwrite");
      deleteNoteEntries(tx.objectStore(STORE_NAME), vault, noteId);
      await transactionDone(tx);
    } finally {
      db.close();
    }
  } catch {
    return;
  }
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const idb = globalThis.indexedDB;
    if (idb === undefined) {
      reject(new Error("IndexedDB unavailable"));
      return;
    }
    const request = idb.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      const store = db.objectStoreNames.contains(STORE_NAME)
        ? request.transaction?.objectStore(STORE_NAME)
        : db.createObjectStore(STORE_NAME, {
            keyPath: ["vault", "noteId", "contentHash"],
          });
      if (store === undefined) {
        return;
      }
      if (!store.indexNames.contains(NOTE_INDEX)) {
        store.createIndex(NOTE_INDEX, ["vault", "noteId"]);
      }
      if (!store.indexNames.contains(CACHED_AT_INDEX)) {
        store.createIndex(CACHED_AT_INDEX, "cachedAtMs");
      }
    };
    request.onblocked = () => reject(request.error ?? new Error("IndexedDB open blocked"));
    request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed"));
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
  });
}

function putAndDeleteStaleHashes(db: IDBDatabase, entry: CachedNoteBody): Promise<void> {
  const tx = db.transaction(STORE_NAME, "readwrite");
  const store = tx.objectStore(STORE_NAME);
  store.put(entry);
  deleteNoteEntries(store, entry.vault, entry.noteId, entry.contentHash);
  return transactionDone(tx);
}

function deleteNoteEntries(
  store: IDBObjectStore,
  vault: number,
  noteId: string,
  keepContentHash?: string,
): void {
  const request = store.index(NOTE_INDEX).openCursor(IDBKeyRange.only([vault, noteId]));
  request.onsuccess = () => {
    const cursor = request.result;
    if (cursor === null) {
      return;
    }
    const cached = cursor.value as CachedNoteBody;
    if (cached.contentHash !== keepContentHash) {
      cursor.delete();
    }
    cursor.continue();
  };
}

function pruneCache(db: IDBDatabase): Promise<void> {
  const tx = db.transaction(STORE_NAME, "readwrite");
  const store = tx.objectStore(STORE_NAME);
  const countRequest = store.count();
  countRequest.onsuccess = () => {
    let remaining = countRequest.result - MAX_CACHE_ENTRIES;
    if (remaining <= 0) {
      return;
    }
    const cursorRequest = store.index(CACHED_AT_INDEX).openCursor();
    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result;
      if (cursor === null || remaining <= 0) {
        return;
      }
      cursor.delete();
      remaining -= 1;
      cursor.continue();
    };
  };
  return transactionDone(tx);
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
    request.onsuccess = () => resolve(request.result);
  });
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction failed"));
  });
}
