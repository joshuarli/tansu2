import type { BootstrapResponse, NoteDocument, NoteMeta } from "./types.generated.ts";

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

vi.mock("@joshuarli98/md-wysiwyg", () => ({
  createCalloutExtension: vi.fn(() => ({})),
  createEditor: vi.fn(() => ({
    applyFormat: vi.fn(),
    destroy: vi.fn(),
    focus: vi.fn(),
    getCursorOffset: vi.fn(() => null),
    getValue: vi.fn(() => "# One"),
    isSourceMode: false,
    setValue: vi.fn(),
    toggleSourceMode: vi.fn(),
  })),
  createWikiImageExtension: vi.fn(() => ({})),
  toggleBold: vi.fn(),
  toggleHeading: vi.fn(),
  toggleHighlight: vi.fn(),
  toggleItalic: vi.fn(),
  toggleStrikethrough: vi.fn(),
}));

const { TansuApp } = await import("./app.ts");

describe("TansuApp note loading", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
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
});

function noteMeta(noteId: string, path: string, title: string): NoteMeta {
  return {
    noteId,
    path,
    title,
    tags: [],
    seq: 1,
    contentHash: "hash",
    updatedAtMs: 1,
  };
}

function bootstrapResponse(notes: NoteMeta[]): BootstrapResponse {
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
    session: {
      openTabs: [],
      activeNoteId: null,
      closedTabs: [],
    },
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
