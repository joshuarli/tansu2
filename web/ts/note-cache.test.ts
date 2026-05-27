import { afterEach, describe, expect, it } from "vitest";

import { cacheNoteBody, deleteCachedNoteBodies, getCachedNoteBody } from "./note-cache.ts";
import type { NoteDocument, NoteMeta } from "./types.generated.ts";

describe("note body cache", () => {
  const originalIndexedDb = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");

  afterEach(() => {
    if (originalIndexedDb === undefined) {
      Reflect.deleteProperty(globalThis, "indexedDB");
    } else {
      Object.defineProperty(globalThis, "indexedDB", originalIndexedDb);
    }
  });

  it("treats missing IndexedDB as a cache miss and ignores writes", async () => {
    Object.defineProperty(globalThis, "indexedDB", {
      configurable: true,
      value: undefined,
    });
    const meta = noteMeta("note-1");
    const document: NoteDocument = { meta, content: "# One\n" };

    await expect(getCachedNoteBody(0, meta)).resolves.toBeNull();
    await expect(cacheNoteBody(0, document)).resolves.toBeUndefined();
    await expect(deleteCachedNoteBodies(0, "note-1")).resolves.toBeUndefined();
  });
});

function noteMeta(noteId: string): NoteMeta {
  return {
    noteId,
    path: "one.md",
    title: "One",
    tags: [],
    seq: 1,
    contentHash: "hash",
    updatedAtMs: 1,
  };
}
