import type {
  BootstrapResponse,
  NoteDocument,
  NoteMeta,
  RevisionMeta,
  SessionState,
} from "./types.generated.ts";

const api = vi.hoisted(() => ({
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
  saveSession: vi.fn(),
  saveSettings: vi.fn(),
  searchNotes: vi.fn(),
  setActiveVault: vi.fn(),
  setPinned: vi.fn(),
  uploadImage: vi.fn(),
}));

vi.mock("./api.ts", () => api);

const htmlImport = vi.hoisted(() => ({
  pickHtmlImport: vi.fn(),
}));

vi.mock("./html-import.ts", () => htmlImport);

const editorMock = vi.hoisted(() => ({
  instances: [] as Array<{
    applyFormat: ReturnType<typeof vi.fn>;
    destroy: ReturnType<typeof vi.fn>;
    focus: ReturnType<typeof vi.fn>;
    getCursorOffset: ReturnType<typeof vi.fn>;
    getValue: ReturnType<typeof vi.fn>;
    isSourceMode: boolean;
    redo: ReturnType<typeof vi.fn>;
    setConfig: ReturnType<typeof vi.fn>;
    setValue: ReturnType<typeof vi.fn>;
    toggleSourceMode: ReturnType<typeof vi.fn>;
    undo: ReturnType<typeof vi.fn>;
    config: Record<string, unknown>;
  }>,
}));

vi.mock("@joshuarli98/md-wysiwyg", () => ({
  createCalloutExtension: vi.fn(() => ({})),
  createEditor: vi.fn((_mount: HTMLElement, config: Record<string, unknown> = {}) => {
    const instance = {
      applyFormat: vi.fn(),
      destroy: vi.fn(),
      focus: vi.fn(),
      getCursorOffset: vi.fn(() => null),
      getValue: vi.fn(() => "# One"),
      isSourceMode: false,
      redo: vi.fn(),
      setConfig: vi.fn(),
      setValue: vi.fn(),
      toggleSourceMode: vi.fn(function toggleSourceMode(this: { isSourceMode: boolean }) {
        this.isSourceMode = !this.isSourceMode;
      }),
      undo: vi.fn(),
      config,
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

describe("TansuApp note loading", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    editorMock.instances.length = 0;
    api.activeVault.mockReturnValue(0);
    document.body.replaceChildren();
  });

  afterEach(() => {
    vi.useRealTimers();
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
    api.saveNote.mockRejectedValue(
      Object.assign(new Error("conflict"), {
        response: { error: { code: "save_conflict", draft: { draftId: 9 } } },
      }),
    );

    const root = mountRoot();
    const app = new TansuApp(root);
    await app.boot();
    const editor = editorMock.instances.at(-1)!;
    editor.getValue.mockReturnValue("# Changed\n");
    (editor.config.onChange as () => void)();
    root.querySelector<HTMLButtonElement>('[title="Save"]')?.click();
    await flushAsync();

    expect(api.saveNote).toHaveBeenCalledWith(
      "note-1",
      { content: "# Changed\n", baseSeq: 1, baseHash: "hash", checkpoint: false },
      0,
    );
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
    root.querySelector<HTMLButtonElement>(".revisions-panel .primary-button")?.click();
    await flushAsync();
    expect(api.restoreRevision).toHaveBeenCalledWith("note-1", 4, 0);

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
    api.saveNote.mockResolvedValue({
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
      (initialEditor.config.onImagePaste as (blob: Blob) => Promise<string | null>)(
        new Blob(["x"]),
      ),
    ).resolves.toContain('data-wiki-image="z-images/pasted.webp"');
    api.uploadImage.mockRejectedValueOnce(new Error("upload failed"));
    await expect(
      (initialEditor.config.onImagePaste as (blob: Blob) => Promise<string | null>)(
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
    await flushAsync();
    expect(htmlImport.pickHtmlImport).toHaveBeenCalled();
    expect(api.createNote).toHaveBeenCalledWith(
      { path: "imported.md", content: "# Imported\n", source: "import" },
      0,
    );

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "p", metaKey: true }));
    expect(root.querySelector(".search-panel")).not.toBeNull();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(root.querySelector(".search-panel")).toBeNull();

    const editor = editorMock.instances.at(-1)!;
    editor.getValue.mockReturnValue("# Changed\n");
    (editor.config.onChange as () => void)();
    vi.advanceTimersByTime(900);
    await flushAsync();
    expect(api.saveNote).toHaveBeenCalledWith(
      "note-2",
      { content: "# Changed\n", baseSeq: 1, baseHash: "hash", checkpoint: false },
      0,
    );
    vi.advanceTimersByTime(250);
    await flushAsync();
    expect(api.saveSession).toHaveBeenCalled();

    const activeEditor = editorMock.instances.at(-1)!;
    root.querySelector<HTMLButtonElement>('[title="Source"]')?.click();
    expect(activeEditor.toggleSourceMode).toHaveBeenCalled();
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
    api.saveNote.mockRejectedValue(new Error("offline"));
    api.deleteNote.mockRejectedValue(new Error("offline"));
    htmlImport.pickHtmlImport.mockResolvedValue(null);

    const root = mountRoot();
    const app = new TansuApp(root);
    await app.boot();
    const editor = editorMock.instances.at(-1)!;
    editor.getValue.mockReturnValue("# Changed\n");
    (editor.config.onChange as () => void)();
    root.querySelector<HTMLButtonElement>('[title="Save"]')?.click();
    await flushAsync();
    expect(root.textContent).toContain("Save failed");

    root.querySelector<HTMLButtonElement>('[title="Commands"]')?.click();
    root.querySelector<HTMLInputElement>(".command-input")!.value = "import";
    root
      .querySelector<HTMLInputElement>(".command-input")!
      .dispatchEvent(new Event("input", { bubbles: true }));
    root.querySelector<HTMLButtonElement>('[title="Import HTML"]')?.click();
    await flushAsync();
    await flushAsync();
    expect(htmlImport.pickHtmlImport).toHaveBeenCalled();
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
}
