import { vi, expect, describe, it } from "vitest";

import type { CommandItem, ViewEvent } from "./app/events.ts";
import {
  createState,
  tabFromDocument,
  tabFromMeta,
  toNoteId,
  toRevisionEventId,
  toVaultIndex,
  type State,
} from "./state.ts";
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
    state.activeNoteId = toNoteId("n1");
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
    state.activeNoteId = toNoteId("n1");
    state.pinned.add("n1");
    state.contextMenu = { noteId: toNoteId("n1"), x: 12, y: 24 };
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

    expectDispatched(actions, { type: "vault.switch", index: toVaultIndex(0) });
    expectDispatched(actions, { type: "search.input", query: "alpha" });
    expectDispatched(actions, { type: "search.open" });
    expectDispatched(actions, { type: "command.run", id: "create" });
    expectDispatched(actions, { type: "tab.close", noteId: toNoteId("n2") });
    expectDispatched(actions, { type: "tab.activate", noteId: toNoteId("n2") });
    expectDispatched(actions, { type: "context.open", noteId: toNoteId("n1"), x: 3, y: 4 });
    expectDispatched(actions, { type: "tags.update", tags: [] });
    expectDispatched(actions, { type: "note.pin", noteId: toNoteId("n1") });
    expectDispatched(actions, { type: "reading.toggle" });
    expectDispatched(actions, { type: "editor.toolbar", command: "bold" });
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
    expect(vaultControl.classList.contains("open")).toBeTruthy();
    expect(vaultControl.getAttribute("aria-expanded")).toBe("true");
    expect([...vaultOptions].map((option) => option.textContent)).toStrictEqual(["Work"]);

    vaultOptions[0]!.click();
    expectDispatched(actions, { type: "vault.switch", index: toVaultIndex(1) });
    expect(root.querySelector<HTMLElement>(".vault-label")!.textContent).toBe("Work");
    expect(vaultControl.classList.contains("open")).toBeFalsy();
  });

  it("renders reading mode with minimal editing chrome", () => {
    const state = baseState();
    state.tabs = [tabFromDocument({ meta: note("n1", "one.md", "One"), content: "# One\n" })];
    state.activeNoteId = toNoteId("n1");
    state.readingMode = true;
    const actions = actionSpies();
    const root = render(state, actions);

    expect(root.querySelector(".main")?.className).toContain("reading-mode");
    expect(root.querySelector(".topbar")).toBeNull();
    expect(root.querySelector(".toolbar")).toBeNull();
    expect(root.querySelector(".editor-meta")).not.toBeNull();
    expect(root.querySelector(".tag-row")).not.toBeNull();
    root.querySelector<HTMLButtonElement>('[title="Read"]')!.click();
    expectDispatched(actions, { type: "reading.toggle" });
  });

  it("shows tab close hint and captures x before editor key handlers", () => {
    const state = baseState();
    state.tabs = [tabFromDocument({ meta: note("n1", "one.md", "One"), content: "# One\n" })];
    state.activeNoteId = toNoteId("n1");
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
      expect(hint.classList.contains("visible")).toBeTruthy();
      expect(hint.parentElement).toBe(document.body);
      expect(hint.style.left).toBe("112px");
      expect(hint.style.top).toBe("18px");

      tab.dispatchEvent(new MouseEvent("mousemove", { clientX: 121, clientY: 34 }));
      expect(hint.style.left).toBe("121px");
      expect(hint.style.top).toBe("34px");

      root.querySelector<HTMLButtonElement>(".tab-close")!.click();
      expectDispatched(actions, { type: "tab.close", noteId: toNoteId("n1") });
      expect(hint.parentElement).toBeNull();
      expect(hint.classList.contains("visible")).toBeFalsy();
      actions.dispatch.mockClear();

      tab.dispatchEvent(new MouseEvent("mouseenter", { clientX: 112, clientY: 18 }));
      const closeEvent = new KeyboardEvent("keydown", {
        key: "x",
        bubbles: true,
        cancelable: true,
      });
      editor.dispatchEvent(closeEvent);
      expectDispatched(actions, { type: "tab.close", noteId: toNoteId("n1") });
      expect(closeEvent.defaultPrevented).toBeTruthy();
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
    state.activeNoteId = toNoteId("n1");
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
    state.noteDialog = { kind: "rename", noteId: toNoteId("n1"), title: "One" };
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
    expect(actions.commandItems).toHaveBeenCalledWith();
    expectDispatched(actions, { type: "search.overlayInput", query: "beta" });
    expectDispatched(actions, { type: "note.open", noteId: toNoteId("n1") });
    expectDispatched(actions, { type: "revisions.select", eventId: toRevisionEventId(7) });
    expectDispatched(actions, { type: "revisions.restore" });
    expectDispatched(actions, {
      type: "settings.submit",
      settings: {
        excludedFoldersText: "node_modules",
        autosaveDelayMs: 900,
        undoStackMax: 100,
        imageWebpQuality: 0.8,
      },
    });
    expectDispatched(actions, { type: "conflict.restore" });
    expectDispatched(actions, { type: "dialog.submit", value: "One" });
    expectDispatched(actions, { type: "overlay.close" });
  });

  it("renders empty search and delete/tag dialogs", () => {
    const state = baseState();
    state.notes.set("n1", note("n1", "one.md", "One"));
    state.searchOpen = true;
    state.searchOverlayQuery = "";
    state.noteDialog = { kind: "delete", noteId: toNoteId("n1") };
    let actions = actionSpies();
    let root = render(state, actions);
    expect(root.querySelector(".search-result-row")).toBeNull();
    root.querySelector<HTMLButtonElement>(".danger-button")!.click();
    expectDispatched(actions, { type: "dialog.submit" });

    state.noteDialog = { kind: "tag", value: "" };
    actions = actionSpies();
    root = render(state, actions);
    root
      .querySelector<HTMLFormElement>(".note-dialog-panel")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    expectDispatched(actions, { type: "dialog.submit", value: "" });
  });

  it("decodes escaped search snippet text while preserving highlights", () => {
    const state = baseState();
    state.searchOpen = true;
    state.searchOverlayQuery = "quote";
    state.searchOverlayHits = [
      {
        note: note("n1", "one.md", "One"),
        snippet: "&quot;<b>quote</b>&quot; &lt;tag&gt;",
        score: 1,
        fieldScores: { title: 0, headings: 0, tags: 0, content: 1 },
      },
    ];

    const root = render(state);
    const snippet = root.querySelector(".search-snippet")!;

    expect(snippet.textContent).toBe('"quote" <tag>');
    expect(snippet.querySelector("b")?.textContent).toBe("quote");
  });
});

function render(state: State, actions = actionSpies()): HTMLElement {
  const root = document.createElement("div");
  root.append(...renderApp(state, actions));
  return root;
}

type ViewActionSpies = ViewActions & {
  dispatch: ReturnType<typeof vi.fn>;
  commandItems: ReturnType<typeof vi.fn>;
};

function actionSpies(): ViewActionSpies {
  const commands: CommandItem[] = [{ id: "save", label: "Save note" }];
  const actions = {
    dispatch: vi.fn(),
    commandItems: vi.fn(() => commands),
  };
  return actions;
}

function expectDispatched(actions: ViewActionSpies, event: ViewEvent): void {
  expect(actions.dispatch).toHaveBeenCalledWith(event);
}

function baseState(): State {
  const state = createState(toVaultIndex(0));
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
