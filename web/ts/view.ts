import { button, el, span } from "./dom.ts";
import { frontmatterSupportsTags } from "./markdown-tags.ts";
import { activeTab, type Command, type State, type Tab } from "./state.ts";

export type ViewActions = {
  render: () => void;
  switchVault: (index: number) => void;
  updateSearch: () => void;
  updateSearchOverlay: () => void;
  commandCreate: () => void;
  commandAddTag: () => void;
  closeOverlays: () => void;
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
  const topbar = el("div", "topbar", tabs, toolbar);
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
  main.append(topbar, workspace, renderStatusBar(state));
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
    host.append(el("div", "overlay-backdrop"), el("div", "command-panel", input, list));
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
    const hits = state.searchOverlayHits?.map((hit) => hit.note.noteId) ?? [];
    const ids = state.searchOverlayQuery.trim() === "" ? [...state.notes.keys()] : hits;
    for (const noteId of ids) {
      const note = state.notes.get(noteId);
      if (note === undefined) {
        continue;
      }
      list.append(
        button(
          `${note.title}  ${note.path}`,
          note.path,
          () => {
            state.searchOpen = false;
            actions.openInTab(note.noteId);
          },
          "command-row",
        ),
      );
    }
    host.append(
      el("div", "overlay-backdrop"),
      el("div", "command-panel search-panel", input, list),
    );
    queueMicrotask(() => input.focus());
  }
  if (state.revisionsOpen) {
    host.append(el("div", "overlay-backdrop"), renderRevisionsPanel(state, actions));
  }
  if (state.settingsOpen && state.boot !== null) {
    host.append(el("div", "overlay-backdrop"), renderSettingsPanel(state, actions));
  }
  if (state.conflictDraft !== null) {
    host.append(el("div", "overlay-backdrop"), renderConflictPanel(state, actions));
  }
  if (state.notice !== null) {
    host.append(el("div", "toast", state.notice));
  }
  return host;
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
    list.append(
      button(
        note.title,
        note.path,
        () => actions.openInTab(note.noteId),
        state.activeNoteId === note.noteId ? "note-row active" : "note-row",
      ),
    );
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
