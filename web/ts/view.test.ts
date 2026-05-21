import { createState, tabFromDocument, tabFromMeta, type Command, type State } from "./state.ts";
import type { BootstrapResponse, NoteMeta, RevisionMeta } from "./types.generated.ts";
import { renderApp, renderLoading, renderStatusBar, type ViewActions } from "./view.ts";

describe("view rendering", () => {
  it("renders loading, empty, loading-note, dirty, saving, and degraded states", () => {
    expect(renderLoading().textContent).toBe("Loading");

    const state = baseState();
    let root = render(state);
    expect(root.textContent).toContain("No note selected");

    const tab = tabFromMeta(note("n1", "one.md", "One"));
    state.tabs = [tab];
    state.activeNoteId = "n1";
    root = render(state);
    expect(root.textContent).toContain("Loading");

    tab.doc = { meta: note("n1", "one.md", "One", ["alpha"]), content: "# One\n" };
    tab.draft = "# Changed\n";
    tab.dirty = true;
    state.boot!.searchStatus.degraded = true;
    expect(renderStatusBar(state).textContent).toContain("Unsaved");
    expect(renderStatusBar(state).textContent).toContain("Search degraded");

    tab.saving = true;
    expect(renderStatusBar(state).textContent).toContain("Saving");
  });

  it("wires sidebar, tabs, toolbar, tags, and context menu actions", () => {
    const state = baseState();
    const active = tabFromDocument({
      meta: note("n1", "one.md", "One", ["alpha"]),
      content: "---\ntags:\n  - alpha\n---\n\n# One\n",
    });
    const other = tabFromDocument({ meta: note("n2", "two.md", "Two"), content: "# Two\n" });
    active.dirty = true;
    active.conflict = true;
    state.tabs = [active, other];
    state.activeNoteId = "n1";
    state.pinned.add("n1");
    state.contextMenu = { noteId: "n1", x: 12, y: 24 };
    const actions = actionSpies();
    const root = render(state, actions);

    root.querySelector<HTMLSelectElement>(".vault-select")!.value = "0";
    root.querySelector<HTMLSelectElement>(".vault-select")!.dispatchEvent(new Event("change"));
    root.querySelector<HTMLInputElement>(".search-input")!.value = "alpha";
    root.querySelector<HTMLInputElement>(".search-input")!.dispatchEvent(new Event("input"));
    root.querySelector<HTMLButtonElement>('[title="Search notes"]')!.click();
    root.querySelector<HTMLButtonElement>('[title="Commands"]')!.click();
    root.querySelector<HTMLButtonElement>('[title="New note"]')!.click();
    root.querySelectorAll<HTMLButtonElement>(".tab-close")[1]!.click();
    root.querySelector<HTMLButtonElement>('[title="Two"]')!.click();
    root
      .querySelector<HTMLButtonElement>('[title="One"]')!
      .dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 3, clientY: 4 }));
    root.querySelector<HTMLButtonElement>('[title="Remove alpha"]')!.click();
    root.querySelector<HTMLButtonElement>('[title="Add tag"]')!.click();
    root.querySelector<HTMLButtonElement>('[title="View conflict draft"]')!.click();
    root.querySelector<HTMLButtonElement>('[title="Restore conflict draft"]')!.click();
    root.querySelector<HTMLButtonElement>('[title="Read"]')!.click();
    for (const title of [
      "Bold",
      "Italic",
      "Strikethrough",
      "Highlight",
      "Heading",
      "Undo",
      "Redo",
      "Source",
      "Save",
    ]) {
      root.querySelector<HTMLButtonElement>(`[title="${title}"]`)!.click();
    }
    root.querySelector<HTMLButtonElement>('[title="Unpin note"]')!.click();
    root.querySelector<HTMLButtonElement>('[title="Rename note"]')!.click();
    root.querySelector<HTMLButtonElement>('[title="Delete note"]')!.click();

    expect(actions.switchVault).toHaveBeenCalledWith(0);
    expect(actions.updateSearch).toHaveBeenCalled();
    expect(actions.render).toHaveBeenCalled();
    expect(actions.commandCreate).toHaveBeenCalled();
    expect(actions.closeTab).toHaveBeenCalledWith("n2");
    expect(actions.activateTab).toHaveBeenCalledWith("n2");
    expect(actions.openNoteContextMenu).toHaveBeenCalledWith("n1", 3, 4);
    expect(actions.updateActiveTags).toHaveBeenCalledWith([]);
    expect(actions.commandPin).toHaveBeenCalledWith("n1");
    expect(actions.toggleReadingMode).toHaveBeenCalled();
    expect(actions.formatBold).toHaveBeenCalled();
    expect(root.textContent).toContain("Save conflict");
  });

  it("opens a custom animated vault menu", () => {
    const state = baseState();
    state.boot!.vaults = [
      { index: 0, name: "Main" },
      { index: 1, name: "Work" },
    ];
    const actions = actionSpies();
    const root = render(state, actions);
    const vaultControl = root.querySelector<HTMLElement>(".vault-control")!;
    const vaultOptions = root.querySelectorAll<HTMLButtonElement>(".vault-option");

    vaultControl.click();
    expect(vaultControl.classList.contains("open")).toBe(true);
    expect(vaultControl.getAttribute("aria-expanded")).toBe("true");
    expect([...vaultOptions].map((option) => option.textContent)).toEqual(["Work"]);

    vaultOptions[0]!.click();
    expect(actions.switchVault).toHaveBeenCalledWith(1);
    expect(root.querySelector<HTMLElement>(".vault-label")!.textContent).toBe("Work");
    expect(vaultControl.classList.contains("open")).toBe(false);
  });

  it("renders reading mode with minimal editing chrome", () => {
    const state = baseState();
    state.tabs = [tabFromDocument({ meta: note("n1", "one.md", "One"), content: "# One\n" })];
    state.activeNoteId = "n1";
    state.readingMode = true;
    const actions = actionSpies();
    const root = render(state, actions);

    expect(root.querySelector(".main")?.className).toContain("reading-mode");
    expect(root.querySelector(".topbar")).toBeNull();
    expect(root.querySelector(".toolbar")).toBeNull();
    expect(root.querySelector(".editor-meta")).not.toBeNull();
    expect(root.querySelector(".tag-row")).not.toBeNull();
    root.querySelector<HTMLButtonElement>('[title="Read"]')!.click();
    expect(actions.toggleReadingMode).toHaveBeenCalled();
  });

  it("shows tab close hint and captures x before editor key handlers", () => {
    const state = baseState();
    state.tabs = [tabFromDocument({ meta: note("n1", "one.md", "One"), content: "# One\n" })];
    state.activeNoteId = "n1";
    const actions = actionSpies();
    const root = render(state, actions);
    document.body.append(root);
    const editorKeydown = vi.fn();
    const editor = document.createElement("div");
    editor.className = "md-editor-content";
    editor.contentEditable = "true";
    editor.addEventListener("keydown", editorKeydown);
    document.body.append(editor);

    try {
      const tab = root.querySelector<HTMLButtonElement>(".tab")!;
      const hint = root.querySelector<HTMLElement>(".tab-close-tooltip")!;
      tab.dispatchEvent(new MouseEvent("mouseenter", { clientX: 112, clientY: 18 }));
      expect(hint.classList.contains("visible")).toBe(true);
      expect(hint.parentElement).toBe(document.body);
      expect(hint.style.left).toBe("112px");
      expect(hint.style.top).toBe("18px");

      tab.dispatchEvent(new MouseEvent("mousemove", { clientX: 121, clientY: 34 }));
      expect(hint.style.left).toBe("121px");
      expect(hint.style.top).toBe("34px");

      root.querySelector<HTMLButtonElement>(".tab-close")!.click();
      expect(actions.closeTab).toHaveBeenCalledWith("n1");
      expect(hint.parentElement).toBeNull();
      expect(hint.classList.contains("visible")).toBe(false);
      actions.closeTab.mockClear();

      tab.dispatchEvent(new MouseEvent("mouseenter", { clientX: 112, clientY: 18 }));
      const closeEvent = new KeyboardEvent("keydown", {
        key: "x",
        bubbles: true,
        cancelable: true,
      });
      editor.dispatchEvent(closeEvent);
      expect(actions.closeTab).toHaveBeenCalledWith("n1");
      expect(closeEvent.defaultPrevented).toBe(true);
      expect(editorKeydown).not.toHaveBeenCalled();
    } finally {
      root.remove();
      editor.remove();
    }
  });

  it("renders command, search, revision, settings, conflict, dialog, and notice overlays", () => {
    const state = baseState();
    const revision = revisionMeta(7);
    state.notes.set("n1", note("n1", "one.md", "One"));
    state.tabs = [tabFromDocument({ meta: note("n1", "one.md", "One"), content: "# One\n" })];
    state.activeNoteId = "n1";
    state.commandOpen = true;
    state.commandFilter = "open";
    state.searchOpen = true;
    state.searchOverlayQuery = "alpha";
    state.searchOverlayHits = [
      {
        note: note("n1", "one.md", "One"),
        snippet: "hit <b>alpha</b>",
        score: 4,
        fieldScores: { title: 1, headings: 0, tags: 0, content: 3 },
      },
    ];
    state.revisionsOpen = true;
    state.revisionList = [revision];
    state.revisionDocument = { revision, content: "# Old\n" };
    state.settingsOpen = true;
    state.conflictDraft = {
      draft: {
        draftId: 1,
        noteId: "n1",
        baseSeq: 1,
        baseHash: "hash",
        contentHash: "draft",
        createdAtMs: 1,
      },
      content: "# Draft\n",
    };
    state.noteDialog = { kind: "rename", noteId: "n1", title: "One" };
    state.notice = "Saved";
    const actions = actionSpies();
    const root = render(state, actions);

    root.querySelector<HTMLInputElement>(".command-input")!.value = "save";
    root.querySelector<HTMLInputElement>(".command-input")!.dispatchEvent(new Event("input"));
    root.querySelector<HTMLButtonElement>(".command-row")!.click();
    root.querySelectorAll<HTMLInputElement>(".command-input")[1]!.value = "beta";
    root.querySelectorAll<HTMLInputElement>(".command-input")[1]!.dispatchEvent(new Event("input"));
    root.querySelector<HTMLButtonElement>(".search-result-row")!.click();
    root.querySelector<HTMLButtonElement>(".revision-row")!.click();
    root.querySelector<HTMLButtonElement>('[title="Restore selected revision"]')!.click();
    root.querySelector<HTMLButtonElement>('[title="Save settings"]')!.click();
    root.querySelector<HTMLButtonElement>('[title="Restore conflict draft"]')!.click();
    root.querySelector<HTMLButtonElement>(".note-dialog-panel .primary-button")!.click();
    root.querySelector<HTMLButtonElement>(".overlay-backdrop")!.click();

    expect(root.textContent).toContain("Revision preview");
    expect(root.textContent).toContain("Settings");
    expect(root.textContent).toContain("Conflict Draft");
    expect(root.textContent).toContain("Saved");
    expect(actions.filteredCommands).toHaveBeenCalled();
    expect(actions.updateSearchOverlay).toHaveBeenCalled();
    expect(actions.openInTab).toHaveBeenCalledWith("n1");
    expect(actions.selectRevision).toHaveBeenCalledWith(7);
    expect(actions.restoreSelectedRevision).toHaveBeenCalled();
    expect(actions.saveSettings).toHaveBeenCalled();
    expect(actions.restoreConflictDraft).toHaveBeenCalled();
    expect(actions.submitNoteDialog).toHaveBeenCalledWith("One");
    expect(actions.closeOverlays).toHaveBeenCalled();
  });

  it("renders empty search and delete/tag dialogs", () => {
    const state = baseState();
    state.notes.set("n1", note("n1", "one.md", "One"));
    state.searchOpen = true;
    state.searchOverlayQuery = "";
    state.noteDialog = { kind: "delete", noteId: "n1" };
    let actions = actionSpies();
    let root = render(state, actions);
    root.querySelector<HTMLButtonElement>(".search-result-row")!.click();
    root.querySelector<HTMLButtonElement>(".danger-button")!.click();
    expect(actions.openInTab).toHaveBeenCalledWith("n1");
    expect(actions.submitNoteDialog).toHaveBeenCalledWith();

    state.noteDialog = { kind: "tag", value: "" };
    actions = actionSpies();
    root = render(state, actions);
    root
      .querySelector<HTMLFormElement>(".note-dialog-panel")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    expect(actions.submitNoteDialog).toHaveBeenCalledWith("");
  });
});

function render(state: State, actions = actionSpies()): HTMLElement {
  const root = document.createElement("div");
  root.append(...renderApp(state, actions));
  return root;
}

function actionSpies(): ViewActions & { [K in keyof ViewActions]: ReturnType<typeof vi.fn> } {
  const commands: Command[] = [{ id: "save", label: "Save note", run: vi.fn() }];
  const actions = {
    render: vi.fn(),
    switchVault: vi.fn(),
    updateSearch: vi.fn(),
    updateSearchOverlay: vi.fn(),
    commandCreate: vi.fn(),
    commandRename: vi.fn(),
    commandDelete: vi.fn(),
    commandPin: vi.fn(),
    commandAddTag: vi.fn(),
    closeOverlays: vi.fn(),
    closeContextMenu: vi.fn(),
    openNoteContextMenu: vi.fn(),
    submitNoteDialog: vi.fn(),
    saveSettings: vi.fn(),
    openRevisions: vi.fn(),
    selectRevision: vi.fn(),
    restoreSelectedRevision: vi.fn(),
    viewConflictDraft: vi.fn(),
    restoreConflictDraft: vi.fn(),
    filteredCommands: vi.fn(() => commands),
    activateTab: vi.fn(),
    closeTab: vi.fn(),
    openInTab: vi.fn(),
    updateActiveTags: vi.fn(),
    toggleReadingMode: vi.fn(),
    formatBold: vi.fn(),
    formatItalic: vi.fn(),
    formatHighlight: vi.fn(),
    formatStrikethrough: vi.fn(),
    formatHeading: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    toggleSourceMode: vi.fn(),
    manualSave: vi.fn(),
  };
  return actions as unknown as ViewActions & { [K in keyof ViewActions]: ReturnType<typeof vi.fn> };
}

function baseState(): State {
  const state = createState(0);
  const boot = bootstrapResponse([]);
  state.boot = boot;
  state.notes = new Map(boot.notes.map((item) => [item.noteId, item]));
  state.recent = boot.recentNoteIds;
  return state;
}

function bootstrapResponse(notes: NoteMeta[]): BootstrapResponse {
  return {
    apiVersion: 1,
    vaults: [{ index: 0, name: "Main" }],
    activeVault: 0,
    notes,
    pinnedNoteIds: [],
    recentNoteIds: notes.map((item) => item.noteId),
    settings: {
      excludedFolders: ["node_modules"],
      searchTitleWeight: 3,
      searchHeadingWeight: 2,
      searchTagWeight: 2,
      searchContentWeight: 1,
      recencyBoost: 0,
      autosaveDelayMs: 900,
      undoStackMax: 100,
      imageWebpQuality: 0.8,
    },
    session: { openTabs: [], activeNoteId: null, closedTabs: [] },
    searchStatus: { dirty: false, degraded: false },
  };
}

function note(noteId: string, path: string, title: string, tags: string[] = []): NoteMeta {
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

function revisionMeta(eventId: number): RevisionMeta {
  return {
    eventId,
    noteId: "n1",
    seq: 1,
    kind: "save",
    source: "user",
    contentHash: "hash",
    createdAtMs: 1,
  };
}
