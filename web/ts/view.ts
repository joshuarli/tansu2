import { button, el, span } from "./dom.ts";
import { frontmatterSupportsTags } from "./markdown-tags.ts";
import { activeTab, type Command, type State, type Tab } from "./state.ts";
import type { SearchHit } from "./types.generated.ts";

export type ViewActions = {
  render: () => void;
  switchVault: (index: number) => void;
  updateSearch: () => void;
  updateSearchOverlay: () => void;
  commandCreate: () => void;
  commandRename: (noteId?: string) => void;
  commandDelete: (noteId?: string) => void;
  commandPin: (noteId?: string) => void;
  commandAddTag: () => void;
  closeOverlays: () => void;
  closeContextMenu: () => void;
  openNoteContextMenu: (noteId: string, x: number, y: number) => void;
  submitNoteDialog: (value?: string) => void;
  saveSettings: (settings: {
    excludedFoldersText: string;
    autosaveDelayMs: number;
    undoStackMax: number;
    imageWebpQuality: number;
  }) => void;
  openRevisions: () => void;
  selectRevision: (eventId: number) => void;
  restoreSelectedRevision: () => void;
  viewConflictDraft: () => void;
  restoreConflictDraft: () => void;
  filteredCommands: () => Command[];
  activateTab: (noteId: string) => void;
  closeTab: (noteId: string) => void;
  openInTab: (noteId: string) => void;
  updateActiveTags: (tags: string[]) => void;
  formatBold: () => void;
  formatItalic: () => void;
  formatHighlight: () => void;
  formatHeading: () => void;
  undo: () => void;
  redo: () => void;
  toggleSourceMode: () => void;
  manualSave: () => void;
};

export function renderApp(state: State, actions: ViewActions): Array<HTMLElement> {
  return [
    renderSidebar(state, actions),
    renderMain(state, actions),
    renderOverlays(state, actions),
  ];
}

export function renderLoading(): HTMLElement {
  return el("main", "loading", "Loading");
}

export function renderStatusBar(state: State): HTMLElement {
  const active = activeTab(state);
  const text =
    active === undefined ? "" : active.saving ? "Saving" : active.dirty ? "Unsaved" : "Saved";
  return el(
    "footer",
    "statusbar",
    span(text),
    span(state.boot?.searchStatus.degraded ? "Search degraded" : ""),
  );
}

function renderSidebar(state: State, actions: ViewActions): HTMLElement {
  const sidebar = el("aside", "sidebar");
  const vaultSelect = document.createElement("select");
  vaultSelect.className = "vault-select";
  for (const vault of state.boot?.vaults ?? []) {
    const option = document.createElement("option");
    option.value = String(vault.index);
    option.textContent = vault.name;
    option.selected = vault.index === state.vault;
    vaultSelect.append(option);
  }
  vaultSelect.addEventListener("change", () => {
    actions.switchVault(Number(vaultSelect.value));
  });

  const search = document.createElement("input");
  search.className = "search-input";
  search.type = "search";
  search.placeholder = "Search";
  search.value = state.searchQuery;
  search.addEventListener("input", () => {
    state.searchQuery = search.value;
    actions.updateSearch();
  });

  const searchButton = button(
    "⌕",
    "Search notes",
    () => {
      state.searchOpen = true;
      state.commandOpen = false;
      state.searchOverlayQuery = state.searchQuery;
      state.searchOverlayHits = state.searchHits;
      actions.render();
    },
    "icon-button",
  );
  const create = button("+", "New note", () => actions.commandCreate(), "icon-button");
  const palette = button(
    "⌘",
    "Commands",
    () => {
      state.commandOpen = true;
      state.searchOpen = false;
      actions.render();
    },
    "icon-button",
  );
  const controls = el("div", "sidebar-controls", vaultSelect, searchButton, create, palette);

  sidebar.append(controls, search);
  sidebar.append(section("Pinned", noteList(state, [...state.pinned], actions)));
  sidebar.append(section("Recent", noteList(state, state.recent, actions)));
  const pool = state.searchHits?.map((hit) => hit.note.noteId) ?? [...state.notes.keys()];
  sidebar.append(
    section(state.searchQuery.trim() === "" ? "Notes" : "Results", noteList(state, pool, actions)),
  );
  return sidebar;
}

function renderMain(state: State, actions: ViewActions): HTMLElement {
  const main = el("main", "main");
  const tabs = el("div", "tabs");
  for (const tab of state.tabs) {
    const active = tab.noteId === state.activeNoteId;
    const tabEl = button(
      "",
      tab.title,
      () => actions.activateTab(tab.noteId),
      active ? "tab active" : "tab",
    );
    tabEl.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      actions.openNoteContextMenu(tab.noteId, event.clientX, event.clientY);
    });
    tabEl.append(span(tab.title), span(tab.dirty ? "•" : ""), closeButton(tab.noteId, actions));
    tabs.append(tabEl);
  }
  const toolbar = el(
    "div",
    "toolbar",
    button("B", "Bold", () => actions.formatBold(), "tool-button"),
    button("I", "Italic", () => actions.formatItalic(), "tool-button"),
    button("H", "Highlight", () => actions.formatHighlight(), "tool-button"),
    button("H1", "Heading", () => actions.formatHeading(), "tool-button"),
    button("↶", "Undo", () => actions.undo(), "tool-button"),
    button("↷", "Redo", () => actions.redo(), "tool-button"),
    button("◇", "Source", () => actions.toggleSourceMode(), "tool-button"),
    button("✓", "Save", () => actions.manualSave(), "tool-button"),
  );
  const active = activeTab(state);
  const title = active === undefined ? "No note selected" : active.path;
  const topbar = el("div", "topbar", tabs);
  const workspace = el("section", "workspace");
  if (active === undefined) {
    workspace.append(emptyState(actions));
  } else if (active.doc === null) {
    workspace.append(el("div", "loading", "Loading"));
  } else {
    const meta = el(
      "div",
      "editor-meta",
      el("div", "path-label", title),
      renderTagRow(active, actions),
    );
    const mount = el("div", "editor-mount");
    mount.id = "editor-mount";
    workspace.append(meta, mount);
    if (active.conflict) {
      const banner = el(
        "div",
        "conflict-banner",
        span("Save conflict. Your rejected draft is recoverable on the server."),
      );
      banner.append(
        button(
          "View draft",
          "View conflict draft",
          () => actions.viewConflictDraft(),
          "text-button",
        ),
        button(
          "Restore draft",
          "Restore conflict draft",
          () => actions.restoreConflictDraft(),
          "text-button",
        ),
      );
      workspace.append(banner);
    }
  }
  main.append(topbar, toolbar, workspace, renderStatusBar(state));
  return main;
}

function renderOverlays(state: State, actions: ViewActions): HTMLElement {
  const host = el("div", "overlay-host");
  if (state.commandOpen) {
    const input = document.createElement("input");
    input.className = "command-input";
    input.value = state.commandFilter;
    input.placeholder = "Command";
    input.addEventListener("input", () => {
      state.commandFilter = input.value;
      actions.render();
    });
    const list = el("div", "command-list");
    for (const command of actions.filteredCommands()) {
      list.append(
        button(
          command.label,
          command.label,
          () => {
            state.commandOpen = false;
            void command.run();
          },
          "command-row",
        ),
      );
    }
    host.append(backdrop(actions), el("div", "command-panel", input, list));
    queueMicrotask(() => input.focus());
  }
  if (state.searchOpen) {
    const input = document.createElement("input");
    input.className = "command-input";
    input.value = state.searchOverlayQuery;
    input.placeholder = "Search notes";
    input.addEventListener("input", () => {
      state.searchOverlayQuery = input.value;
      actions.updateSearchOverlay();
    });
    const list = el("div", "command-list");
    if (state.searchOverlayQuery.trim() === "") {
      for (const noteId of state.notes.keys()) {
        const note = state.notes.get(noteId);
        if (note === undefined) {
          continue;
        }
        list.append(searchNoteRow(note.noteId, note.title, note.path, actions));
      }
    } else {
      for (const hit of state.searchOverlayHits ?? []) {
        list.append(searchHitRow(hit, actions));
      }
    }
    host.append(backdrop(actions), el("div", "command-panel search-panel", input, list));
    queueMicrotask(() => input.focus());
  }
  if (state.revisionsOpen) {
    host.append(backdrop(actions), renderRevisionsPanel(state, actions));
  }
  if (state.settingsOpen && state.boot !== null) {
    host.append(backdrop(actions), renderSettingsPanel(state, actions));
  }
  if (state.conflictDraft !== null) {
    host.append(backdrop(actions), renderConflictPanel(state, actions));
  }
  if (state.noteDialog !== null) {
    host.append(backdrop(actions), renderNoteDialog(state, actions));
  }
  if (state.contextMenu !== null) {
    host.append(renderContextMenu(state, actions));
  }
  if (state.notice !== null) {
    host.append(el("div", "toast", state.notice));
  }
  return host;
}

function backdrop(actions: ViewActions): HTMLElement {
  const element = el("div", "overlay-backdrop");
  element.addEventListener("click", () => actions.closeOverlays());
  return element;
}

function renderRevisionsPanel(state: State, actions: ViewActions): HTMLElement {
  const list = el("div", "revision-list");
  for (const revision of state.revisionList ?? []) {
    list.append(
      button(
        `${revision.kind}  seq ${revision.seq}`,
        `Revision ${revision.eventId}`,
        () => actions.selectRevision(revision.eventId),
        state.revisionDocument?.revision.eventId === revision.eventId
          ? "revision-row active"
          : "revision-row",
      ),
    );
  }
  const active = activeTab(state);
  const current = active?.draft ?? active?.doc?.content ?? "";
  const preview =
    state.revisionDocument === null
      ? el("div", "empty-panel", "Select a revision")
      : el("pre", "diff-preview", diffPreview(current, state.revisionDocument.content));
  return el(
    "div",
    "modal-panel revisions-panel",
    el(
      "div",
      "modal-header",
      span("Revisions"),
      button("×", "Close", () => actions.closeOverlays(), "tab-close"),
    ),
    el("div", "revision-body", list, preview),
    el(
      "div",
      "modal-actions",
      button(
        "Restore",
        "Restore selected revision",
        () => actions.restoreSelectedRevision(),
        "primary-button",
      ),
    ),
  );
}

function renderConflictPanel(state: State, actions: ViewActions): HTMLElement {
  const draft = state.conflictDraft;
  return el(
    "div",
    "modal-panel revisions-panel",
    el(
      "div",
      "modal-header",
      span("Conflict Draft"),
      button("×", "Close", () => actions.closeOverlays(), "tab-close"),
    ),
    el("pre", "diff-preview", draft?.content ?? ""),
    el(
      "div",
      "modal-actions",
      button(
        "Restore Draft",
        "Restore conflict draft",
        () => actions.restoreConflictDraft(),
        "primary-button",
      ),
    ),
  );
}

function renderSettingsPanel(state: State, actions: ViewActions): HTMLElement {
  const settings = state.boot!.settings;
  const excluded = input("Excluded folders", settings.excludedFolders.join(", "));
  const autosave = input("Autosave delay", String(settings.autosaveDelayMs), "number");
  const undo = input("Undo stack", String(settings.undoStackMax), "number");
  const quality = input(
    "Image quality",
    String(settings.imageWebpQuality),
    "number",
    "0.1",
    "1",
    "0.05",
  );
  return el(
    "div",
    "modal-panel settings-panel",
    el(
      "div",
      "modal-header",
      span("Settings"),
      button("×", "Close", () => actions.closeOverlays(), "tab-close"),
    ),
    el("label", "field-label", span("Excluded folders"), excluded),
    el("label", "field-label", span("Autosave delay ms"), autosave),
    el("label", "field-label", span("Undo stack max"), undo),
    el("label", "field-label", span("Image WebP quality"), quality),
    el(
      "div",
      "modal-actions",
      button(
        "Save",
        "Save settings",
        () => {
          actions.saveSettings({
            excludedFoldersText: excluded.value,
            autosaveDelayMs: Number(autosave.value),
            undoStackMax: Number(undo.value),
            imageWebpQuality: Number(quality.value),
          });
        },
        "primary-button",
      ),
    ),
  );
}

function renderNoteDialog(state: State, actions: ViewActions): HTMLElement {
  const dialog = state.noteDialog;
  const isDelete = dialog?.kind === "delete";
  const title =
    dialog?.kind === "create"
      ? "New Note"
      : dialog?.kind === "rename"
        ? "Rename Note"
        : dialog?.kind === "tag"
          ? "Add Tag"
          : "Delete Note";
  const inputEl =
    dialog !== null && dialog.kind !== "delete"
      ? input(title, dialog.kind === "tag" ? dialog.value : dialog.title)
      : null;
  const panel = el(
    "form",
    "modal-panel note-dialog-panel",
    el(
      "div",
      "modal-header",
      span(title),
      button("×", "Close", () => actions.closeOverlays(), "tab-close"),
    ),
  );
  if (isDelete) {
    const note = state.notes.get(dialog.noteId);
    panel.append(
      el("p", "dialog-copy", `Move ${note?.path ?? "this note"} to trash?`),
      el(
        "div",
        "modal-actions",
        button("Cancel", "Cancel", () => actions.closeOverlays(), "text-button"),
        button("Delete", "Delete note", () => actions.submitNoteDialog(), "danger-button"),
      ),
    );
  } else if (inputEl !== null) {
    panel.append(
      el("label", "field-label", span(dialog?.kind === "tag" ? "Tag" : "Title"), inputEl),
      el(
        "div",
        "modal-actions",
        button("Cancel", "Cancel", () => actions.closeOverlays(), "text-button"),
        button(
          dialog?.kind === "create" ? "Create" : dialog?.kind === "rename" ? "Rename" : "Add",
          title,
          () => actions.submitNoteDialog(inputEl.value),
          "primary-button",
        ),
      ),
    );
    panel.addEventListener("submit", (event) => {
      event.preventDefault();
      actions.submitNoteDialog(inputEl.value);
    });
    queueMicrotask(() => inputEl.focus());
  }
  return panel;
}

function renderContextMenu(state: State, actions: ViewActions): HTMLElement {
  const menu = el("div", "context-menu");
  const context = state.contextMenu;
  if (context === null) {
    return menu;
  }
  menu.style.left = `${context.x}px`;
  menu.style.top = `${context.y}px`;
  const pinned = state.pinned.has(context.noteId);
  menu.append(
    button(
      "Rename",
      "Rename note",
      () => {
        actions.commandRename(context.noteId);
        actions.closeContextMenu();
      },
      "context-menu-item",
    ),
    button(
      pinned ? "Unpin" : "Pin",
      pinned ? "Unpin note" : "Pin note",
      () => {
        actions.commandPin(context.noteId);
        actions.closeContextMenu();
      },
      "context-menu-item",
    ),
    button(
      "Delete",
      "Delete note",
      () => {
        actions.commandDelete(context.noteId);
        actions.closeContextMenu();
      },
      "context-menu-item danger",
    ),
  );
  return menu;
}

function searchNoteRow(
  noteId: string,
  title: string,
  path: string,
  actions: ViewActions,
): HTMLElement {
  const row = button(
    "",
    path,
    () => {
      actions.closeOverlays();
      actions.openInTab(noteId);
    },
    "command-row search-result-row",
  );
  row.append(span(title, "search-result-title"), span(path, "search-result-path"));
  return row;
}

function searchHitRow(hit: SearchHit, actions: ViewActions): HTMLElement {
  const row = searchNoteRow(hit.note.noteId, hit.note.title, hit.note.path, actions);
  row.append(renderScore(hit), renderSnippet(hit.snippet));
  return row;
}

function renderScore(hit: SearchHit): HTMLElement {
  const scores: Array<[string, number]> = [
    ["title", hit.fieldScores.title],
    ["headings", hit.fieldScores.headings],
    ["tags", hit.fieldScores.tags],
    ["content", hit.fieldScores.content],
  ];
  const parts = scores
    .filter(([, value]) => value > 0)
    .map(([name, value]) => `${name}:${value.toPrecision(3)}`);
  return el(
    "span",
    "search-score",
    `${hit.score.toPrecision(3)}${parts.length > 0 ? ` = ${parts.join(" + ")}` : ""}`,
  );
}

function renderSnippet(snippet: string): HTMLElement {
  const element = el("span", "search-snippet");
  for (const part of parseHighlightedSnippet(snippet)) {
    element.append(part.highlight ? el("b", "", part.text) : document.createTextNode(part.text));
  }
  return element;
}

function parseHighlightedSnippet(snippet: string): Array<{ text: string; highlight: boolean }> {
  const parts = snippet.split(/(<b>|<\/b>)/);
  const result: Array<{ text: string; highlight: boolean }> = [];
  let highlight = false;
  for (const part of parts) {
    if (part === "<b>") {
      highlight = true;
    } else if (part === "</b>") {
      highlight = false;
    } else if (part !== "") {
      result.push({ text: part, highlight });
    }
  }
  return result;
}

function input(
  title: string,
  value: string,
  type = "text",
  min?: string,
  max?: string,
  step?: string,
): HTMLInputElement {
  const element = document.createElement("input");
  element.className = "settings-input";
  element.title = title;
  element.type = type;
  element.value = value;
  if (min !== undefined) element.min = min;
  if (max !== undefined) element.max = max;
  if (step !== undefined) element.step = step;
  return element;
}

function diffPreview(current: string, revision: string): string {
  const currentLines = current.split("\n");
  const revisionLines = revision.split("\n");
  const out = ["Revision preview", ""];
  for (let i = 0; i < Math.max(currentLines.length, revisionLines.length); i += 1) {
    if (currentLines[i] === revisionLines[i]) {
      continue;
    }
    if (revisionLines[i] !== undefined) out.push(`+ ${revisionLines[i]}`);
    if (currentLines[i] !== undefined) out.push(`- ${currentLines[i]}`);
    if (out.length > 80) break;
  }
  return out.join("\n");
}

function emptyState(actions: ViewActions): HTMLElement {
  return el(
    "div",
    "empty-state",
    el("div", "empty-title", "No note selected"),
    button("New note", "New note", () => actions.commandCreate(), "primary-button"),
  );
}

function renderTagRow(tab: Tab, actions: ViewActions): HTMLElement {
  const row = el("div", "tag-row");
  if (tab.doc === null) {
    return row;
  }
  const supported = frontmatterSupportsTags(tab.draft ?? tab.doc.content);
  for (const tag of tab.doc.meta.tags) {
    const tagButton = button(
      `#${tag} x`,
      `Remove ${tag}`,
      () => {
        actions.updateActiveTags(tab.doc?.meta.tags.filter((item) => item !== tag) ?? []);
      },
      "tag",
    );
    tagButton.disabled = !supported;
    row.append(tagButton);
  }
  const add = button("+ tag", "Add tag", () => actions.commandAddTag(), "tag tag-add");
  add.disabled = !supported;
  row.append(add);
  if (!supported) {
    row.append(span("Tags locked", "tag-disabled"));
  }
  return row;
}

function noteList(state: State, ids: string[], actions: ViewActions): HTMLElement {
  const list = el("div", "note-list");
  const seen = new Set<string>();
  for (const noteId of ids) {
    if (seen.has(noteId)) {
      continue;
    }
    seen.add(noteId);
    const note = state.notes.get(noteId);
    if (note === undefined) {
      continue;
    }
    const row = button(
      note.title,
      note.path,
      () => actions.openInTab(note.noteId),
      state.activeNoteId === note.noteId ? "note-row active" : "note-row",
    );
    row.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      actions.openNoteContextMenu(note.noteId, event.clientX, event.clientY);
    });
    list.append(row);
  }
  return list;
}

function section(title: string, body: HTMLElement): HTMLElement {
  return el("section", "sidebar-section", el("h2", "section-title", title), body);
}

function closeButton(noteId: string, actions: ViewActions): HTMLElement {
  return button(
    "×",
    "Close",
    (event) => {
      event.stopPropagation();
      actions.closeTab(noteId);
    },
    "tab-close",
  );
}
