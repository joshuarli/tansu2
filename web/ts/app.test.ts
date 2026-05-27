import { it, vi, afterEach, expect, describe, beforeEach } from "vitest";

import type { CachedNoteBody } from "./note-cache.ts";
import type {
  BootstrapResponse,
  NoteDocument,
  NoteMeta,
  RevisionMeta,
  SearchHit,
  SessionState,
} from "./types.generated.ts";

const api = vi.hoisted(() => ({
  get apiClient() {
    return this;
  },
  activeVault: vi.fn(() => 0),
  assetUrl: vi.fn((name: string) => `/api/assets?name=${encodeURIComponent(name)}`),
  bootstrap: vi.fn(),
  connectEvents: vi.fn(
    () =>
      ({
        addEventListener: vi.fn(),
        close: vi.fn(),
      }) as unknown as EventSource,
  ),
  createNote: vi.fn(),
  deleteNote: vi.fn(),
  listRevisions: vi.fn(),
  openConflictDraft: vi.fn(),
  openNote: vi.fn(),
  openRevision: vi.fn(),
  parseServerEvent: vi.fn(),
  renameNote: vi.fn(),
  restoreConflictDraft: vi.fn(),
  restoreRevision: vi.fn(),
  saveNote: vi.fn(),
  saveConflictError: vi.fn((error: unknown) => {
    const response =
      error instanceof Error && "response" in error
        ? (error.response as { error?: { code?: string } } | null)
        : null;
    return response?.error?.code === "save_conflict" ? response.error : null;
  }),
  saveNoteDelta: vi.fn(),
  saveSession: vi.fn(),
  saveSettings: vi.fn(),
  searchNotes: vi.fn(),
  setActiveVault: vi.fn(),
  setPinned: vi.fn(),
  uploadImage: vi.fn(),
}));

vi.mock(import("./api.ts"), () => api);

const htmlImport = vi.hoisted(() => ({
  pickHtmlImport: vi.fn(),
}));

vi.mock(import("./html-import.ts"), () => htmlImport);

const noteCache = vi.hoisted(() => ({
  cacheNoteBody: vi.fn(async () => {}),
  deleteCachedNoteBodies: vi.fn(async () => {}),
  getCachedNoteBody: vi.fn(async (): Promise<CachedNoteBody | null> => null),
}));

vi.mock(import("./note-cache.ts"), () => noteCache);

const editorMock = vi.hoisted(() => ({
  instances: [] as {
    applyFormat: ReturnType<typeof vi.fn>;
    containsEditableTarget: ReturnType<typeof vi.fn>;
    destroy: ReturnType<typeof vi.fn>;
    focus: ReturnType<typeof vi.fn>;
    getCursorOffset: ReturnType<typeof vi.fn>;
    getSnapshot: ReturnType<typeof vi.fn>;
    getValue: ReturnType<typeof vi.fn>;
    isReadOnly: boolean;
    isSourceMode: boolean;
    redo: ReturnType<typeof vi.fn>;
    setConfig: ReturnType<typeof vi.fn>;
    setReadOnly: ReturnType<typeof vi.fn>;
    setValue: ReturnType<typeof vi.fn>;
    toggleSourceMode: ReturnType<typeof vi.fn>;
    undo: ReturnType<typeof vi.fn>;
    config: Record<string, unknown>;
    contentEl: HTMLElement;
    sourceEl: HTMLTextAreaElement;
  }[],
}));

vi.mock(import("./editor/index.js"), () => ({
  createCalloutExtension: vi.fn(() => ({})),
  createEditor: vi.fn((_mount: HTMLElement, config: Record<string, unknown> = {}) => {
    const instance = {
      applyFormat: vi.fn(),
      containsEditableTarget: vi.fn(() => false),
      destroy: vi.fn(),
      focus: vi.fn(),
      getCursorOffset: vi.fn(() => null),
      getSnapshot: vi.fn(() => ({
        markdown: "# One",
        cursorOffset: -1,
        selection: null,
        revision: 0,
        sourceMode: false,
      })),
      getValue: vi.fn(() => "# One"),
      isReadOnly: false,
      isSourceMode: false,
      redo: vi.fn(),
      setConfig: vi.fn(),
      setReadOnly: vi.fn(function setReadOnly(this: { isReadOnly: boolean }, readonly: boolean) {
        this.isReadOnly = readonly;
      }),
      setValue: vi.fn(),
      toggleSourceMode: vi.fn(function toggleSourceMode(this: { isSourceMode: boolean }) {
        this.isSourceMode = !this.isSourceMode;
      }),
      undo: vi.fn(),
      config,
      contentEl: document.createElement("div"),
      sourceEl: document.createElement("textarea"),
    };
    editorMock.instances.push(instance);
    return instance;
  }),
  createWikiImageExtension: vi.fn(() => ({})),
  toggleBold: vi.fn(),
  toggleHeading: vi.fn(),
  toggleHighlight: vi.fn(),
  toggleItalic: vi.fn(),
  toggleStrikethrough: vi.fn(),
}));

const { TansuApp, startApp } = await import("./app.ts");

describe("tansuApp note loading", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    editorMock.instances.length = 0;
    api.activeVault.mockReturnValue(0);
    noteCache.getCachedNoteBody.mockResolvedValue(null);
    noteCache.cacheNoteBody.mockResolvedValue(undefined);
    noteCache.deleteCachedNoteBodies.mockResolvedValue(undefined);
    vi.stubGlobal("crypto", {
      subtle: {
        digest: vi.fn(async () => new Uint8Array(32).buffer),
      },
    });
    document.body.replaceChildren();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("deduplicates the render-triggered load when opening a note", async () => {
    const note = noteMeta("note-1", "one.md", "One");
    api.bootstrap.mockResolvedValue(bootstrapResponse([note]));
    const load = deferred<NoteDocument>();
    api.openNote.mockReturnValue(load.promise);

    const root = document.createElement("div");
    document.body.append(root);
    const app = new TansuApp(root);
    await app.boot();

    root.querySelector<HTMLButtonElement>(".note-row")?.click();

    expect(api.openNote).toHaveBeenCalledTimes(1);
    expect(api.openNote).toHaveBeenCalledWith("note-1", 0);

    load.resolve({ meta: note, content: "# One" });
    await load.promise;
    await Promise.resolve();
  });

  it("renders a restored active tab from a valid cached body before openNote resolves", async () => {
    const note = noteMeta("note-1", "one.md", "One");
    api.bootstrap.mockResolvedValue(
      bootstrapResponse([note], {
        openTabs: [
          { noteId: "note-1", title: "One", path: "one.md", cursorOffset: null, sourceMode: false },
        ],
        activeNoteId: "note-1",
        closedTabs: [],
      }),
    );
    noteCache.getCachedNoteBody.mockResolvedValue(cachedBody(note, "# Cached\n"));
    const load = deferred<NoteDocument>();
    api.openNote.mockReturnValue(load.promise);

    const root = mountRoot();
    const app = new TansuApp(root);
    const boot = app.boot();
    await flushAsync();

    expect(api.openNote).toHaveBeenCalledWith("note-1", 0);
    expect(noteCache.getCachedNoteBody).toHaveBeenCalledWith(0, note);
    expect(editorMock.instances.at(-1)?.setValue).toHaveBeenCalledWith("# Cached\n", undefined);

    load.resolve({ meta: note, content: "# Cached\n" });
    await boot;
    expect(noteCache.cacheNoteBody).toHaveBeenCalledWith(0, {
      meta: note,
      content: "# Cached\n",
    });
  });

  it("ignores stale cached bodies and keeps the loading state until openNote resolves", async () => {
    const note = noteMeta("note-1", "one.md", "One");
    api.bootstrap.mockResolvedValue(
      bootstrapResponse([note], {
        openTabs: [
          { noteId: "note-1", title: "One", path: "one.md", cursorOffset: null, sourceMode: false },
        ],
        activeNoteId: "note-1",
        closedTabs: [],
      }),
    );
    noteCache.getCachedNoteBody.mockResolvedValue({
      ...cachedBody(note, "# Stale\n"),
      contentHash: "stale",
    });
    const load = deferred<NoteDocument>();
    api.openNote.mockReturnValue(load.promise);

    const root = mountRoot();
    const app = new TansuApp(root);
    const boot = app.boot();
    await flushAsync();

    expect(editorMock.instances).toHaveLength(0);
    expect(root.textContent).toContain("Loading");

    load.resolve({ meta: note, content: "# Server\n" });
    await boot;
    expect(editorMock.instances.at(-1)?.setValue).toHaveBeenCalledWith("# Server\n", undefined);
  });

  it("does not let a late openNote response replace edits made after a cache hit", async () => {
    const note = noteMeta("note-1", "one.md", "One");
    api.bootstrap.mockResolvedValue(
      bootstrapResponse([note], {
        openTabs: [
          { noteId: "note-1", title: "One", path: "one.md", cursorOffset: null, sourceMode: false },
        ],
        activeNoteId: "note-1",
        closedTabs: [],
      }),
    );
    noteCache.getCachedNoteBody.mockResolvedValue(cachedBody(note, "# Cached\n"));
    const load = deferred<NoteDocument>();
    api.openNote.mockReturnValue(load.promise);
    api.saveNoteDelta.mockResolvedValue({
      document: { meta: { ...note, seq: 2, contentHash: "next" }, content: "# Draft\n" },
      meta: { ...note, seq: 2, contentHash: "next" },
      syncVersion: 2,
    });

    const root = mountRoot();
    const app = new TansuApp(root);
    const boot = app.boot();
    await flushAsync();
    const editor = editorMock.instances.at(-1)!;
    editor.getSnapshot.mockReturnValue({
      markdown: "# Draft\n",
      cursorOffset: -1,
      selection: null,
      revision: 1,
      sourceMode: false,
    });
    (editor.config["onChange"] as () => void)();

    load.resolve({ meta: { ...note, seq: 2, contentHash: "server" }, content: "# Server\n" });
    await boot;

    expect(editor.setValue).not.toHaveBeenCalledWith("# Server\n", undefined);
    root.querySelector<HTMLButtonElement>('[title="Save"]')?.click();
    await vi.waitFor(() => {
      expect(api.saveNoteDelta).toHaveBeenCalledWith(
        "note-1",
        expect.objectContaining({ baseSeq: 1, baseHash: "hash", checkpoint: false }),
        0,
      );
    });
  });

  it("ignores a pending cache read after switching vaults", async () => {
    const oldNote = noteMeta("note-1", "one.md", "One");
    const newNote = noteMeta("note-1", "other.md", "Other");
    api.bootstrap.mockResolvedValue(
      bootstrapResponse([oldNote], {
        openTabs: [
          { noteId: "note-1", title: "One", path: "one.md", cursorOffset: null, sourceMode: false },
        ],
        activeNoteId: "note-1",
        closedTabs: [],
      }),
    );
    const cache = deferred<CachedNoteBody | null>();
    const load = deferred<NoteDocument>();
    noteCache.getCachedNoteBody.mockReturnValue(cache.promise);
    api.openNote.mockReturnValue(load.promise);

    const root = mountRoot();
    const app = new TansuApp(root);
    const oldBoot = app.boot();
    await flushAsync();

    api.activeVault.mockReturnValue(1);
    api.bootstrap.mockResolvedValueOnce(bootstrapResponse([newNote]));
    await app.boot();

    cache.resolve(cachedBody(oldNote, "# Old cached\n"));
    load.resolve({ meta: oldNote, content: "# Old server\n" });
    await oldBoot;
    await flushAsync();

    expect(editorMock.instances).toHaveLength(0);
    expect(root.textContent).toContain("No note selected");
  });

  it("renders notes opened from recent rows from cache before openNote resolves", async () => {
    const note = noteMeta("note-1", "one.md", "One");
    api.bootstrap.mockResolvedValue(bootstrapResponse([note]));
    noteCache.getCachedNoteBody.mockResolvedValue(cachedBody(note, "# Cached\n"));
    const load = deferred<NoteDocument>();
    api.openNote.mockReturnValue(load.promise);

    const root = mountRoot();
    const app = new TansuApp(root);
    await app.boot();
    root.querySelector<HTMLButtonElement>(".note-row")?.click();
    await flushAsync();

    expect(editorMock.instances.at(-1)?.setValue).toHaveBeenCalledWith("# Cached\n", undefined);

    load.resolve({ meta: note, content: "# Cached\n" });
    await load.promise;
  });

  it("preserves loading behavior on cache miss when opening a note", async () => {
    const note = noteMeta("note-1", "one.md", "One");
    api.bootstrap.mockResolvedValue(bootstrapResponse([note]));
    const load = deferred<NoteDocument>();
    api.openNote.mockReturnValue(load.promise);

    const root = mountRoot();
    const app = new TansuApp(root);
    await app.boot();
    root.querySelector<HTMLButtonElement>(".note-row")?.click();
    await flushAsync();

    expect(editorMock.instances).toHaveLength(0);
    expect(root.textContent).toContain("Loading");

    load.resolve({ meta: note, content: "# Server\n" });
    await load.promise;
    await flushAsync();
    expect(editorMock.instances.at(-1)?.setValue).toHaveBeenCalledWith("# Server\n", undefined);
  });

  it("renders reopened closed tabs from cache before openNote resolves", async () => {
    const note = noteMeta("note-1", "one.md", "One");
    api.bootstrap.mockResolvedValue(
      bootstrapResponse([note], {
        openTabs: [],
        activeNoteId: null,
        closedTabs: [
          { noteId: "note-1", title: "One", path: "one.md", cursorOffset: 3, sourceMode: false },
        ],
      }),
    );
    noteCache.getCachedNoteBody.mockResolvedValue(cachedBody(note, "# Cached\n"));
    const load = deferred<NoteDocument>();
    api.openNote.mockReturnValue(load.promise);

    const root = mountRoot();
    const app = new TansuApp(root);
    await app.boot();
    root.querySelector<HTMLButtonElement>('[title="Commands"]')?.click();
    root.querySelector<HTMLInputElement>(".command-input")!.value = "reopen";
    root
      .querySelector<HTMLInputElement>(".command-input")!
      .dispatchEvent(new Event("input", { bubbles: true }));
    root.querySelector<HTMLButtonElement>(".command-row")?.click();
    await flushAsync();

    expect(editorMock.instances.at(-1)?.setValue).toHaveBeenCalledWith("# Cached\n", 3);

    load.resolve({ meta: note, content: "# Cached\n" });
    await load.promise;
  });

  it("keeps already-loaded tab state ahead of the cache", async () => {
    const note = noteMeta("note-1", "one.md", "One");
    api.bootstrap.mockResolvedValue(
      bootstrapResponse([note], {
        openTabs: [
          { noteId: "note-1", title: "One", path: "one.md", cursorOffset: null, sourceMode: false },
        ],
        activeNoteId: "note-1",
        closedTabs: [],
      }),
    );
    api.openNote.mockResolvedValue({ meta: note, content: "# Server\n" });
    noteCache.getCachedNoteBody.mockResolvedValue(cachedBody(note, "# Cached\n"));

    const root = mountRoot();
    const app = new TansuApp(root);
    await app.boot();
    noteCache.getCachedNoteBody.mockClear();
    root.querySelector<HTMLButtonElement>(".note-row")?.click();
    await flushAsync();

    expect(noteCache.getCachedNoteBody).not.toHaveBeenCalled();
    expect(api.openNote).toHaveBeenCalledTimes(1);
  });

  it("uses noteId metadata when opening a cached search result", async () => {
    const note = noteMeta("note-1", "folder/one.md", "One");
    api.bootstrap.mockResolvedValue(bootstrapResponse([note]));
    api.searchNotes.mockResolvedValue([
      {
        note,
        score: 3,
        snippet: "<b>one</b>",
        fieldScores: { title: 3, headings: 0, tags: 0, content: 0 },
      },
    ]);
    noteCache.getCachedNoteBody.mockResolvedValue(cachedBody(note, "# Cached\n"));
    const load = deferred<NoteDocument>();
    api.openNote.mockReturnValue(load.promise);

    const root = mountRoot();
    const app = new TansuApp(root);
    await app.boot();
    root.querySelector<HTMLButtonElement>('[title="Search notes"]')?.click();
    root.querySelector<HTMLInputElement>(".command-input")!.value = "one";
    root
      .querySelector<HTMLInputElement>(".command-input")!
      .dispatchEvent(new Event("input", { bubbles: true }));
    await flushAsync();
    root.querySelector<HTMLButtonElement>(".search-result-row")?.click();
    await flushAsync();

    expect(noteCache.getCachedNoteBody).toHaveBeenCalledWith(0, note);
    expect(editorMock.instances.at(-1)?.setValue).toHaveBeenCalledWith("# Cached\n", undefined);

    load.resolve({ meta: note, content: "# Cached\n" });
    await load.promise;
  });

  it("ignores stale search overlay responses", async () => {
    const alpha = noteMeta("note-a", "alpha.md", "Alpha");
    const beta = noteMeta("note-b", "beta.md", "Beta");
    api.bootstrap.mockResolvedValue(bootstrapResponse([alpha, beta]));
    const alphaSearch = deferred<SearchHit[]>();
    const betaSearch = deferred<SearchHit[]>();
    api.searchNotes
      .mockReturnValueOnce(alphaSearch.promise)
      .mockReturnValueOnce(betaSearch.promise);

    const root = mountRoot();
    const app = new TansuApp(root);
    await app.boot();
    root.querySelector<HTMLButtonElement>('[title="Search notes"]')?.click();
    const input = root.querySelector<HTMLInputElement>(".command-input")!;
    input.value = "alpha";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.value = "beta";
    input.dispatchEvent(new Event("input", { bubbles: true }));

    betaSearch.resolve([searchHit(beta)]);
    await flushAsync();
    expect(root.textContent).toContain("beta.md");

    alphaSearch.resolve([searchHit(alpha)]);
    await flushAsync();
    expect(root.textContent).toContain("beta.md");
    expect(root.textContent).not.toContain("alpha.md");
  });

  it("waits for three search characters before querying", async () => {
    const alpha = noteMeta("note-a", "alpha.md", "Alpha");
    api.bootstrap.mockResolvedValue(bootstrapResponse([alpha]));
    api.searchNotes.mockResolvedValue([searchHit(alpha)]);

    const root = mountRoot();
    const app = new TansuApp(root);
    await app.boot();

    const sidebarSearch = root.querySelector<HTMLInputElement>(".search-input")!;
    sidebarSearch.value = "al";
    sidebarSearch.dispatchEvent(new Event("input", { bubbles: true }));
    await flushAsync();
    expect(api.searchNotes).not.toHaveBeenCalled();

    sidebarSearch.value = "alp";
    sidebarSearch.dispatchEvent(new Event("input", { bubbles: true }));
    await flushAsync();
    expect(api.searchNotes).toHaveBeenCalledWith("alp", 0);

    api.searchNotes.mockClear();
    root.querySelector<HTMLButtonElement>('[title="Search notes"]')?.click();
    const overlaySearch = root.querySelector<HTMLInputElement>(".command-input")!;
    overlaySearch.value = "al";
    overlaySearch.dispatchEvent(new Event("input", { bubbles: true }));
    await flushAsync();
    expect(api.searchNotes).not.toHaveBeenCalled();

    overlaySearch.value = "alp";
    overlaySearch.dispatchEvent(new Event("input", { bubbles: true }));
    await flushAsync();
    expect(api.searchNotes).toHaveBeenCalledWith("alp", 0);
  });

  it("creates, renames, pins, deletes, searches, and switches vaults through the DOM", async () => {
    const one = noteMeta("note-1", "one.md", "One");
    api.bootstrap.mockResolvedValue(bootstrapResponse([one]));
    api.openNote.mockResolvedValue({ meta: one, content: "# One\n" });
    const created = noteMeta("note-2", "meeting-notes.md", "Meeting Notes");
    api.createNote.mockResolvedValue({
      document: { meta: created, content: "# Meeting Notes\n" },
      meta: created,
      syncVersion: 1,
    });
    const renamed = noteMeta("note-2", "renamed-note.md", "Renamed Note");
    api.renameNote.mockResolvedValue({ document: null, meta: renamed, syncVersion: 2 });
    api.deleteNote.mockResolvedValue({ document: null, meta: renamed, syncVersion: 3 });
    api.setPinned.mockResolvedValue({ ok: true });
    api.searchNotes.mockResolvedValue([
      {
        note: one,
        score: 3,
        snippet: "<b>alpha</b>",
        fieldScores: { title: 0, headings: 0, tags: 0, content: 3 },
      },
    ]);

    const root = mountRoot();
    const app = new TansuApp(root);
    await app.boot();

    root.querySelector<HTMLButtonElement>('[title="New note"]')?.click();
    root.querySelector<HTMLInputElement>(".note-dialog-panel input")!.value = "Meeting Notes";
    root
      .querySelector<HTMLInputElement>(".note-dialog-panel input")!
      .dispatchEvent(new Event("input", { bubbles: true }));
    root.querySelector<HTMLButtonElement>(".note-dialog-panel .primary-button")?.click();
    await flushAsync();

    expect(api.createNote).toHaveBeenCalledWith(
      { path: "meeting-notes.md", content: "# Meeting Notes\n", source: null },
      0,
    );
    expect(editorMock.instances.at(-1)?.setValue).toHaveBeenLastCalledWith(
      "# Meeting Notes\n",
      "# Meeting Notes\n".length,
    );

    root
      .querySelector<HTMLButtonElement>(".tab.active")
      ?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 10, clientY: 20 }));
    root.querySelectorAll<HTMLButtonElement>(".context-menu button")[1]?.click();
    await flushAsync();
    expect(api.setPinned).toHaveBeenCalledWith("note-2", true, 0);

    root
      .querySelector<HTMLButtonElement>(".tab.active")
      ?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 10, clientY: 20 }));
    root.querySelector<HTMLButtonElement>(".context-menu button")?.click();
    root.querySelector<HTMLInputElement>(".note-dialog-panel input")!.value = "Renamed Note";
    root
      .querySelector<HTMLInputElement>(".note-dialog-panel input")!
      .dispatchEvent(new Event("input", { bubbles: true }));
    root.querySelector<HTMLButtonElement>(".note-dialog-panel .primary-button")?.click();
    await flushAsync();
    expect(api.renameNote).toHaveBeenCalledWith("note-2", { path: "renamed-note.md" }, 0);

    root.querySelector<HTMLInputElement>(".search-input")!.value = "alpha";
    root
      .querySelector<HTMLInputElement>(".search-input")!
      .dispatchEvent(new Event("input", { bubbles: true }));
    await flushAsync();
    expect(api.searchNotes).toHaveBeenCalledWith("alpha", 0);

    root
      .querySelector<HTMLButtonElement>(".tab.active")
      ?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 10, clientY: 20 }));
    root.querySelectorAll<HTMLButtonElement>(".context-menu button")[2]?.click();
    root.querySelector<HTMLButtonElement>(".note-dialog-panel .danger-button")?.click();
    await flushAsync();
    expect(api.deleteNote).toHaveBeenCalledWith("note-2", 0);
    expect(noteCache.deleteCachedNoteBodies).toHaveBeenCalledWith(0, "note-2");

    root.querySelector<HTMLSelectElement>(".vault-select")!.value = "0";
    root
      .querySelector<HTMLSelectElement>(".vault-select")!
      .dispatchEvent(new Event("change", { bubbles: true }));
    await flushAsync();
    expect(api.setActiveVault).toHaveBeenCalledWith(0);
  });

  it("saves dirty editor content and narrows conflict errors", async () => {
    const note = noteMeta("note-1", "one.md", "One");
    api.bootstrap.mockResolvedValue(
      bootstrapResponse([note], {
        openTabs: [
          { noteId: "note-1", title: "One", path: "one.md", cursorOffset: null, sourceMode: false },
        ],
        activeNoteId: "note-1",
        closedTabs: [],
      }),
    );
    api.openNote.mockResolvedValue({ meta: note, content: "# One\n" });
    api.saveNoteDelta.mockRejectedValue(
      Object.assign(new Error("conflict"), {
        response: { error: { code: "save_conflict", draft: { draftId: 9 } } },
      }),
    );

    const root = mountRoot();
    const app = new TansuApp(root);
    await app.boot();
    const editor = editorMock.instances.at(-1)!;
    editor.getSnapshot.mockReturnValue({
      markdown: "# Changed\n",
      cursorOffset: -1,
      selection: null,
      revision: 1,
      sourceMode: false,
    });
    (editor.config["onChange"] as () => void)();
    root.querySelector<HTMLButtonElement>('[title="Save"]')?.click();
    await vi.waitFor(() => {
      expect(api.saveNoteDelta).toHaveBeenCalledWith(
        "note-1",
        expect.objectContaining({ baseSeq: 1, baseHash: "hash", checkpoint: false }),
        0,
      );
    });
    expect(root.textContent).toContain("Save conflict");
    expect(root.textContent).toContain("View draft");

    api.openConflictDraft.mockResolvedValue({
      draft: {
        draftId: 9,
        noteId: "note-1",
        baseSeq: 1,
        baseHash: "hash",
        contentHash: "draft",
        createdAtMs: 1,
      },
      content: "# Draft\n",
    });
    api.restoreConflictDraft.mockResolvedValue({
      document: { meta: { ...note, seq: 2 }, content: "# Draft\n" },
      meta: { ...note, seq: 2 },
      syncVersion: 2,
    });
    root.querySelector<HTMLButtonElement>('[title="View conflict draft"]')?.click();
    await flushAsync();
    expect(api.openConflictDraft).toHaveBeenCalledWith("note-1", 9, 0);
    root.querySelector<HTMLButtonElement>('[title="Restore conflict draft"]')?.click();
    await flushAsync();
    expect(api.restoreConflictDraft).toHaveBeenCalledWith("note-1", 9, 0);
    expect(noteCache.cacheNoteBody).toHaveBeenCalledWith(0, {
      meta: { ...note, seq: 2 },
      content: "# Draft\n",
    });
  });

  it("caches the clean document returned by a successful save", async () => {
    const note = noteMeta("note-1", "one.md", "One");
    const saved = { ...note, seq: 2, contentHash: "next" };
    api.bootstrap.mockResolvedValue(
      bootstrapResponse([note], {
        openTabs: [
          { noteId: "note-1", title: "One", path: "one.md", cursorOffset: null, sourceMode: false },
        ],
        activeNoteId: "note-1",
        closedTabs: [],
      }),
    );
    api.openNote.mockResolvedValue({ meta: note, content: "# One\n" });
    api.saveNoteDelta.mockResolvedValue({
      document: null,
      meta: saved,
      syncVersion: 2,
    });

    const root = mountRoot();
    const app = new TansuApp(root);
    await app.boot();
    noteCache.cacheNoteBody.mockClear();
    const editor = editorMock.instances.at(-1)!;
    editor.getSnapshot.mockReturnValue({
      markdown: "# Saved\n",
      cursorOffset: -1,
      selection: null,
      revision: 1,
      sourceMode: false,
    });
    (editor.config["onChange"] as () => void)();
    root.querySelector<HTMLButtonElement>('[title="Save"]')?.click();
    await vi.waitFor(() => {
      expect(noteCache.cacheNoteBody).toHaveBeenCalledWith(0, {
        meta: saved,
        content: "# Saved\n",
      });
    });
  });

  it("runs a follow-up autosave for edits made during an in-flight save", async () => {
    const note = noteMeta("note-1", "one.md", "One");
    const firstSaved = { ...note, seq: 2, contentHash: "first" };
    const secondSaved = { ...note, seq: 3, contentHash: "second" };
    api.bootstrap.mockResolvedValue(
      bootstrapResponse([note], {
        openTabs: [
          { noteId: "note-1", title: "One", path: "one.md", cursorOffset: null, sourceMode: false },
        ],
        activeNoteId: "note-1",
        closedTabs: [],
      }),
    );
    api.openNote.mockResolvedValue({ meta: note, content: "# One\n" });
    const firstSave = deferred<{
      document: NoteDocument;
      meta: NoteMeta;
      syncVersion: number;
    }>();
    api.saveNoteDelta.mockReturnValueOnce(firstSave.promise).mockResolvedValueOnce({
      document: { meta: secondSaved, content: "# Second\n" },
      meta: secondSaved,
      syncVersion: 3,
    });

    const root = mountRoot();
    const app = new TansuApp(root);
    await app.boot();
    const editor = editorMock.instances.at(-1)!;
    editor.getSnapshot.mockReturnValue({
      markdown: "# First\n",
      cursorOffset: -1,
      selection: null,
      revision: 1,
      sourceMode: false,
    });
    (editor.config["onChange"] as () => void)();
    vi.advanceTimersByTime(900);
    await flushUntil(() => api.saveNoteDelta.mock.calls.length > 0);
    expect(api.saveNoteDelta).toHaveBeenCalledTimes(1);

    editor.getSnapshot.mockReturnValue({
      markdown: "# Second\n",
      cursorOffset: -1,
      selection: null,
      revision: 2,
      sourceMode: false,
    });
    (editor.config["onChange"] as () => void)();
    vi.advanceTimersByTime(900);
    await flushAsync();
    expect(api.saveNoteDelta).toHaveBeenCalledTimes(1);

    firstSave.resolve({
      document: { meta: firstSaved, content: "# First\n" },
      meta: firstSaved,
      syncVersion: 2,
    });
    await flushAsync();

    await flushUntil(() => api.saveNoteDelta.mock.calls.length >= 2);
    expect(api.saveNoteDelta).toHaveBeenCalledTimes(2);
    expect(api.saveNoteDelta).toHaveBeenLastCalledWith(
      "note-1",
      expect.objectContaining({ baseSeq: 2, baseHash: "first", checkpoint: false }),
      0,
    );
  });

  it("does not serialize editor content synchronously on every change", async () => {
    const note = noteMeta("note-1", "one.md", "One");
    api.bootstrap.mockResolvedValue(
      bootstrapResponse([note], {
        openTabs: [
          { noteId: "note-1", title: "One", path: "one.md", cursorOffset: null, sourceMode: false },
        ],
        activeNoteId: "note-1",
        closedTabs: [],
      }),
    );
    api.openNote.mockResolvedValue({ meta: note, content: "# One\n" });

    const root = mountRoot();
    const app = new TansuApp(root);
    await app.boot();
    const editor = editorMock.instances.at(-1)!;
    editor.getValue.mockClear();
    editor.getCursorOffset.mockClear();
    editor.getSnapshot.mockClear();

    (editor.config["onChange"] as () => void)();

    expect(editor.getValue).not.toHaveBeenCalled();
    expect(editor.getCursorOffset).not.toHaveBeenCalled();
    expect(editor.getSnapshot).not.toHaveBeenCalled();
    vi.advanceTimersByTime(150);
    expect(editor.getValue).not.toHaveBeenCalled();
    expect(editor.getCursorOffset).not.toHaveBeenCalled();
    expect(editor.getSnapshot).toHaveBeenCalledTimes(1);
  });

  it("does not save session on every editor change while typing", async () => {
    const note = noteMeta("note-1", "one.md", "One");
    api.bootstrap.mockResolvedValue(
      bootstrapResponse([note], {
        openTabs: [
          { noteId: "note-1", title: "One", path: "one.md", cursorOffset: null, sourceMode: false },
        ],
        activeNoteId: "note-1",
        closedTabs: [],
      }),
    );
    api.openNote.mockResolvedValue({ meta: note, content: "# One\n" });
    api.saveSession.mockResolvedValue({ ok: true });

    const root = mountRoot();
    const app = new TansuApp(root);
    await app.boot();
    const editor = editorMock.instances.at(-1)!;
    editor.getSnapshot.mockReturnValue({
      markdown: "# Changed\n",
      cursorOffset: 10,
      selection: { start: 10, end: 10 },
      revision: 1,
      sourceMode: false,
    });

    for (let i = 0; i < 5; i++) {
      (editor.config["onChange"] as () => void)();
      vi.advanceTimersByTime(500);
      await flushAsync();
    }
    expect(api.saveSession).not.toHaveBeenCalled();

    vi.advanceTimersByTime(3000);
    await flushAsync();
    expect(api.saveSession).toHaveBeenCalledTimes(1);
  });

  it("opens revisions, restores conflict drafts, saves settings, and updates tags", async () => {
    const note = noteMeta("note-1", "one.md", "One", ["alpha"]);
    api.bootstrap.mockResolvedValue(
      bootstrapResponse([note], {
        openTabs: [
          { noteId: "note-1", title: "One", path: "one.md", cursorOffset: null, sourceMode: false },
        ],
        activeNoteId: "note-1",
        closedTabs: [],
      }),
    );
    api.openNote.mockResolvedValue({
      meta: note,
      content: "---\ntags:\n  - alpha\n---\n\n# One\n",
    });
    const revision = revisionMeta(4, "note-1", 1);
    api.listRevisions.mockResolvedValue([revision]);
    api.openRevision.mockResolvedValue({ revision, content: "# Old\n" });
    api.restoreRevision.mockResolvedValue({
      document: { meta: { ...note, seq: 2 }, content: "# Old\n" },
      meta: { ...note, seq: 2 },
      syncVersion: 2,
    });
    api.openConflictDraft.mockResolvedValue({
      draft: {
        draftId: 5,
        noteId: "note-1",
        baseSeq: 1,
        baseHash: "hash",
        contentHash: "draft-hash",
        createdAtMs: 1,
      },
      content: "# Draft\n",
    });
    api.restoreConflictDraft.mockResolvedValue({
      document: { meta: { ...note, seq: 3 }, content: "# Draft\n" },
      meta: { ...note, seq: 3 },
      syncVersion: 3,
    });
    api.saveSettings.mockImplementation(async (settings) => settings);

    const root = mountRoot();
    const app = new TansuApp(root);
    await app.boot();

    root.querySelector<HTMLButtonElement>('[title="Commands"]')?.click();
    root.querySelector<HTMLInputElement>(".command-input")!.value = "revisions";
    root
      .querySelector<HTMLInputElement>(".command-input")!
      .dispatchEvent(new Event("input", { bubbles: true }));
    root.querySelector<HTMLButtonElement>(".command-row")?.click();
    await flushAsync();
    root.querySelector<HTMLButtonElement>(".revision-row")?.click();
    await flushAsync();
    noteCache.cacheNoteBody.mockClear();
    root.querySelector<HTMLButtonElement>(".revisions-panel .primary-button")?.click();
    await flushAsync();
    expect(api.restoreRevision).toHaveBeenCalledWith("note-1", 4, 0);
    expect(noteCache.cacheNoteBody).toHaveBeenCalledWith(0, {
      meta: { ...note, seq: 2 },
      content: "# Old\n",
    });

    root.querySelector<HTMLButtonElement>('[title="Commands"]')?.click();
    root.querySelector<HTMLInputElement>(".command-input")!.value = "settings";
    root
      .querySelector<HTMLInputElement>(".command-input")!
      .dispatchEvent(new Event("input", { bubbles: true }));
    root.querySelector<HTMLButtonElement>(".command-row")?.click();
    root.querySelector<HTMLInputElement>('input[title="Autosave delay"]')!.value = "10";
    root.querySelector<HTMLInputElement>('input[title="Undo stack"]')!.value = "1";
    root.querySelector<HTMLInputElement>('input[title="Image quality"]')!.value = "2";
    root.querySelector<HTMLButtonElement>(".settings-panel .primary-button")?.click();
    await flushAsync();
    expect(api.saveSettings).toHaveBeenCalledWith(
      expect.objectContaining({ autosaveDelayMs: 150, undoStackMax: 20, imageWebpQuality: 1 }),
      0,
    );

    root.querySelector<HTMLButtonElement>('[title="Add tag"]')?.click();
    root.querySelector<HTMLInputElement>(".note-dialog-panel input")!.value = "beta";
    root
      .querySelector<HTMLInputElement>(".note-dialog-panel input")!
      .dispatchEvent(new Event("input", { bubbles: true }));
    root.querySelector<HTMLButtonElement>(".note-dialog-panel .primary-button")?.click();
    await flushAsync();
    expect(editorMock.instances.at(-1)?.setValue).toHaveBeenCalledWith("# One", undefined);
  });

  it("handles import, reopen, source, formatting, autosave, and global shortcuts", async () => {
    const note = noteMeta("note-1", "one.md", "One");
    const imported = noteMeta("note-2", "imported.md", "Imported");
    api.bootstrap.mockResolvedValue(
      bootstrapResponse([note], {
        openTabs: [
          { noteId: "note-1", title: "One", path: "one.md", cursorOffset: null, sourceMode: false },
        ],
        activeNoteId: "note-1",
        closedTabs: [
          { noteId: "note-1", title: "One", path: "one.md", cursorOffset: 2, sourceMode: true },
        ],
      }),
    );
    api.openNote.mockResolvedValue({ meta: note, content: "# One\n" });
    api.saveNoteDelta.mockResolvedValue({
      document: { meta: { ...note, seq: 2, contentHash: "next" }, content: "# Changed\n" },
      meta: { ...note, seq: 2, contentHash: "next" },
      syncVersion: 2,
    });
    api.saveSession.mockResolvedValue({ ok: true });
    htmlImport.pickHtmlImport.mockResolvedValue({ path: "imported.md", content: "# Imported\n" });
    api.createNote.mockResolvedValue({
      document: { meta: imported, content: "# Imported\n" },
      meta: imported,
      syncVersion: 3,
    });

    const root = mountRoot();
    const app = new TansuApp(root);
    app.bindGlobalEvents();
    await app.boot();
    const initialEditor = editorMock.instances.at(-1)!;
    api.uploadImage.mockResolvedValue({ name: "z-images/pasted.webp", markdown: "![[pasted]]" });
    await expect(
      (initialEditor.config["onImagePaste"] as (blob: Blob) => Promise<string | null>)(
        new Blob(["x"]),
      ),
    ).resolves.toContain('data-wiki-image="z-images/pasted.webp"');
    api.uploadImage.mockRejectedValueOnce(new Error("upload failed"));
    await expect(
      (initialEditor.config["onImagePaste"] as (blob: Blob) => Promise<string | null>)(
        new Blob(["x"]),
      ),
    ).resolves.toBeNull();

    root.querySelector<HTMLButtonElement>('[title="Commands"]')?.click();
    root.querySelector<HTMLInputElement>(".command-input")!.value = "open";
    root
      .querySelector<HTMLInputElement>(".command-input")!
      .dispatchEvent(new Event("input", { bubbles: true }));
    root.querySelector<HTMLButtonElement>(".command-row")?.click();
    expect(root.querySelector(".search-panel")).not.toBeNull();

    root.querySelector<HTMLButtonElement>('[title="Commands"]')?.click();
    root.querySelector<HTMLInputElement>(".command-input")!.value = "reopen";
    root
      .querySelector<HTMLInputElement>(".command-input")!
      .dispatchEvent(new Event("input", { bubbles: true }));
    root.querySelector<HTMLButtonElement>(".command-row")?.click();
    await flushAsync();

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true }));
    expect(root.textContent).toContain("Import HTML");
    root.querySelector<HTMLInputElement>(".command-input")!.value = "import";
    root
      .querySelector<HTMLInputElement>(".command-input")!
      .dispatchEvent(new Event("input", { bubbles: true }));
    root.querySelector<HTMLButtonElement>(".command-row")?.click();
    await vi.waitFor(() => expect(htmlImport.pickHtmlImport).toHaveBeenCalled());
    expect(api.createNote).toHaveBeenCalledWith(
      { path: "imported.md", content: "# Imported\n", source: "import" },
      0,
    );
    await vi.waitFor(() =>
      expect(root.querySelector(".tab.active")?.textContent).toContain("Imported"),
    );

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "p", metaKey: true }));
    expect(root.querySelector(".search-panel")).not.toBeNull();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(root.querySelector(".search-panel")).toBeNull();

    const editor = editorMock.instances.at(-1)!;
    editor.getSnapshot.mockReturnValue({
      markdown: "# Changed\n",
      cursorOffset: -1,
      selection: null,
      revision: 1,
      sourceMode: false,
    });
    (editor.config["onChange"] as () => void)();
    vi.advanceTimersByTime(900);
    await vi.waitFor(() => {
      expect(api.saveNoteDelta).toHaveBeenCalledWith(
        "note-2",
        expect.objectContaining({ baseSeq: 1, baseHash: "hash", checkpoint: false }),
        0,
      );
    });
    vi.advanceTimersByTime(3000);
    await flushAsync();
    expect(api.saveSession).toHaveBeenCalled();

    const activeEditor = editorMock.instances.at(-1)!;
    root.querySelector<HTMLButtonElement>('[title="Source"]')?.click();
    expect(activeEditor.toggleSourceMode).toHaveBeenCalledWith();
    for (const title of [
      "Bold",
      "Italic",
      "Highlight",
      "Strikethrough",
      "Heading",
      "Undo",
      "Redo",
    ]) {
      root.querySelector<HTMLButtonElement>(`[title="${title}"]`)?.click();
    }
    expect(activeEditor.applyFormat).toHaveBeenCalled();
    expect(activeEditor.undo).toHaveBeenCalled();
    expect(activeEditor.redo).toHaveBeenCalled();

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "n", metaKey: true }));
    expect(root.querySelector(".note-dialog-panel")).not.toBeNull();
  });

  it("starts and boots the app from the public entry point", async () => {
    api.bootstrap.mockResolvedValue(bootstrapResponse([]));
    const root = mountRoot();

    startApp(root);
    await flushAsync();

    expect(api.bootstrap).toHaveBeenCalledWith(0);
    expect(root.textContent).toContain("No note selected");
  });

  it("reports non-conflict save, delete, and import failures", async () => {
    const note = noteMeta("note-1", "one.md", "One");
    api.bootstrap.mockResolvedValue(
      bootstrapResponse([note], {
        openTabs: [
          { noteId: "note-1", title: "One", path: "one.md", cursorOffset: null, sourceMode: false },
        ],
        activeNoteId: "note-1",
        closedTabs: [],
      }),
    );
    api.openNote.mockResolvedValue({ meta: note, content: "# One\n" });
    api.saveNoteDelta.mockRejectedValue(new Error("offline"));
    api.deleteNote.mockRejectedValue(new Error("offline"));
    htmlImport.pickHtmlImport.mockResolvedValue(null);

    const root = mountRoot();
    const app = new TansuApp(root);
    await app.boot();
    const editor = editorMock.instances.at(-1)!;
    editor.getSnapshot.mockReturnValue({
      markdown: "# Changed\n",
      cursorOffset: -1,
      selection: null,
      revision: 1,
      sourceMode: false,
    });
    (editor.config["onChange"] as () => void)();
    root.querySelector<HTMLButtonElement>('[title="Save"]')?.click();
    await vi.waitFor(() => expect(root.textContent).toContain("Save failed"));

    root.querySelector<HTMLButtonElement>('[title="Commands"]')?.click();
    root.querySelector<HTMLInputElement>(".command-input")!.value = "import";
    root
      .querySelector<HTMLInputElement>(".command-input")!
      .dispatchEvent(new Event("input", { bubbles: true }));
    root.querySelector<HTMLButtonElement>('[title="Import HTML"]')?.click();
    await vi.waitFor(() => expect(htmlImport.pickHtmlImport).toHaveBeenCalled());
    root.querySelector<HTMLButtonElement>(".overlay-backdrop")?.click();
  });
});

function mountRoot(): HTMLElement {
  const root = document.createElement("div");
  document.body.append(root);
  return root;
}

function noteMeta(noteId: string, path: string, title: string, tags: string[] = []): NoteMeta {
  return {
    noteId,
    path,
    title,
    tags,
    seq: 1,
    contentHash: "hash",
    updatedAtMs: 1,
  };
}

function cachedBody(
  note: NoteMeta,
  content: string,
): {
  vault: number;
  noteId: string;
  contentHash: string;
  seq: number;
  content: string;
  cachedAtMs: number;
} {
  return {
    vault: 0,
    noteId: note.noteId,
    contentHash: note.contentHash,
    seq: note.seq,
    content,
    cachedAtMs: 1,
  };
}

function searchHit(note: NoteMeta): SearchHit {
  return {
    note,
    score: 1,
    snippet: note.title,
    fieldScores: { title: 1, headings: 0, tags: 0, content: 0 },
  };
}

function revisionMeta(eventId: number, noteId: string, seq: number): RevisionMeta {
  return {
    eventId,
    noteId,
    seq,
    kind: "save",
    source: "user",
    contentHash: "hash",
    createdAtMs: 1,
  };
}

function bootstrapResponse(
  notes: NoteMeta[],
  session: SessionState = {
    openTabs: [],
    activeNoteId: null,
    closedTabs: [],
  },
): BootstrapResponse {
  return {
    apiVersion: 1,
    vaults: [{ index: 0, name: "Test" }],
    activeVault: 0,
    notes,
    pinnedNoteIds: [],
    recentNoteIds: notes.map((note) => note.noteId),
    settings: {
      excludedFolders: [],
      searchTitleWeight: 3,
      searchHeadingWeight: 2,
      searchTagWeight: 2,
      searchContentWeight: 1,
      recencyBoost: 0,
      autosaveDelayMs: 900,
      undoStackMax: 100,
      imageWebpQuality: 0.8,
    },
    session,
    searchStatus: { dirty: false, degraded: false },
  };
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

async function flushAsync(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

async function flushUntil(done: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20 && !done(); attempt++) {
    await flushAsync();
  }
}
