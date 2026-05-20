import {
  createCalloutExtension,
  createEditor,
  createWikiImageExtension,
  toggleBold,
  toggleHeading,
  toggleHighlight,
  toggleItalic,
  type EditorHandle,
} from "@joshuarli98/md-wysiwyg";
import Defuddle from "defuddle/full";

import {
  activeVault,
  bootstrap,
  connectEvents,
  createNote,
  deleteNote,
  openNote,
  parseServerEvent,
  renameNote,
  saveNote,
  saveSettings,
  saveSession,
  searchNotes,
  setActiveVault,
  setPinned,
} from "./api.ts";
import type {
  ApiErrorResponse,
  BootstrapResponse,
  NoteDocument,
  NoteMeta,
  SearchHit,
  SessionState,
  SessionTab,
} from "./types.generated.ts";

type Tab = {
  noteId: string;
  title: string;
  path: string;
  doc: NoteDocument | null;
  draft: string | null;
  dirty: boolean;
  saving: boolean;
  conflict: boolean;
  cursorOffset: number | null;
  sourceMode: boolean;
};

type Command = {
  id: string;
  label: string;
  run: () => void | Promise<void>;
};

type State = {
  boot: BootstrapResponse | null;
  vault: number;
  notes: Map<string, NoteMeta>;
  pinned: Set<string>;
  recent: string[];
  tabs: Tab[];
  closedTabs: SessionTab[];
  activeNoteId: string | null;
  searchQuery: string;
  searchHits: SearchHit[] | null;
  searchOpen: boolean;
  searchOverlayQuery: string;
  searchOverlayHits: SearchHit[] | null;
  commandOpen: boolean;
  commandFilter: string;
  notice: string | null;
};

const root = document.querySelector<HTMLElement>("#app");
if (root === null) {
  throw new Error("missing app root");
}
const appRoot: HTMLElement = root;

const state: State = {
  boot: null,
  vault: activeVault(),
  notes: new Map(),
  pinned: new Set(),
  recent: [],
  tabs: [],
  closedTabs: [],
  activeNoteId: null,
  searchQuery: "",
  searchHits: null,
  searchOpen: false,
  searchOverlayQuery: "",
  searchOverlayHits: null,
  commandOpen: false,
  commandFilter: "",
  notice: null,
};

let editor: EditorHandle | null = null;
let autosaveTimer: number | undefined;
let sessionTimer: number | undefined;
let events: EventSource | null = null;
const extensions = [
  createWikiImageExtension({ resolveUrl: (name) => `/${name}` }),
  createCalloutExtension(),
];

void boot();

window.addEventListener("beforeunload", (event) => {
  syncActiveDraft();
  if (state.tabs.some((tab) => tab.dirty)) {
    event.preventDefault();
  }
});

window.addEventListener("keydown", (event) => {
  const target = event.target;
  const inEditor =
    target instanceof HTMLElement &&
    (target.closest(".md-editor-content") !== null || target.closest(".md-editor-source") !== null);
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    state.commandOpen = true;
    state.searchOpen = false;
    state.commandFilter = "";
    render();
    return;
  }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "p") {
    event.preventDefault();
    state.searchOpen = true;
    state.commandOpen = false;
    state.searchOverlayQuery = state.searchQuery;
    state.searchOverlayHits = state.searchHits;
    render();
    return;
  }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
    event.preventDefault();
    void manualSave();
    return;
  }
  if (event.key === "Escape" && (state.commandOpen || state.searchOpen)) {
    event.preventDefault();
    state.commandOpen = false;
    state.searchOpen = false;
    render();
    return;
  }
  if (!inEditor && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "n") {
    event.preventDefault();
    void commandCreate();
  }
});

async function boot(): Promise<void> {
  destroyEditor();
  events?.close();
  state.vault = activeVault();
  state.boot = await bootstrap(state.vault);
  state.notes = new Map(state.boot.notes.map((note) => [note.noteId, note]));
  state.pinned = new Set(state.boot.pinnedNoteIds);
  state.recent = state.boot.recentNoteIds;
  state.tabs = state.boot.session.openTabs
    .filter((tab) => state.notes.has(tab.noteId))
    .map((tab) => ({
      noteId: tab.noteId,
      title: tab.title,
      path: tab.path,
      doc: null,
      draft: null,
      dirty: false,
      saving: false,
      conflict: false,
      cursorOffset: tab.cursorOffset ?? null,
      sourceMode: tab.sourceMode,
    }));
  state.closedTabs = state.boot.session.closedTabs.filter((tab) => state.notes.has(tab.noteId));
  state.activeNoteId =
    state.boot.session.activeNoteId && state.notes.has(state.boot.session.activeNoteId)
      ? state.boot.session.activeNoteId
      : (state.tabs[0]?.noteId ?? null);
  connectSse();
  render();
  if (state.activeNoteId !== null) {
    await ensureActiveLoaded();
  }
}

function connectSse(): void {
  events?.close();
  events = connectEvents(state.vault);
  events.addEventListener("message", (event) => {
    const payload = parseServerEvent(event as MessageEvent<string>);
    if (payload.vault !== state.vault) {
      return;
    }
    for (const note of payload.notes) {
      state.notes.set(note.noteId, note);
      const tab = tabById(note.noteId);
      if (tab !== undefined) {
        tab.title = note.title;
        tab.path = note.path;
        if (tab.doc !== null) {
          tab.doc.meta = note;
        }
      }
    }
    for (const noteId of payload.deletedNoteIds) {
      state.notes.delete(noteId);
      closeTab(noteId, false);
    }
    render();
  });
}

function render(): void {
  syncActiveDraft();
  destroyEditor();
  if (state.boot === null) {
    appRoot.replaceChildren(el("main", "loading", "Loading"));
    return;
  }
  appRoot.replaceChildren(renderSidebar(), renderMain(), renderOverlays());
  mountActiveEditor();
  scheduleSessionSave();
}

function renderSidebar(): HTMLElement {
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
    setActiveVault(Number(vaultSelect.value));
    void boot();
  });

  const search = document.createElement("input");
  search.className = "search-input";
  search.type = "search";
  search.placeholder = "Search";
  search.value = state.searchQuery;
  search.addEventListener("input", () => {
    state.searchQuery = search.value;
    void updateSearch();
  });

  const create = button("+", "New note", () => void commandCreate(), "icon-button");
  const palette = button(
    "⌘",
    "Commands",
    () => {
      state.commandOpen = true;
      state.searchOpen = false;
      render();
    },
    "icon-button",
  );
  const searchButton = button(
    "⌕",
    "Search notes",
    () => {
      state.searchOpen = true;
      state.commandOpen = false;
      state.searchOverlayQuery = state.searchQuery;
      state.searchOverlayHits = state.searchHits;
      render();
    },
    "icon-button",
  );
  const controls = el("div", "sidebar-controls", vaultSelect, searchButton, create, palette);

  sidebar.append(controls, search);
  sidebar.append(section("Pinned", noteList([...state.pinned])));
  sidebar.append(section("Recent", noteList(state.recent)));
  const pool = state.searchHits?.map((hit) => hit.note.noteId) ?? [...state.notes.keys()];
  sidebar.append(section(state.searchQuery.trim() === "" ? "Notes" : "Results", noteList(pool)));
  return sidebar;
}

function renderMain(): HTMLElement {
  const main = el("main", "main");
  const tabs = el("div", "tabs");
  for (const tab of state.tabs) {
    const active = tab.noteId === state.activeNoteId;
    const tabEl = button(
      "",
      tab.title,
      () => void activateTab(tab.noteId),
      active ? "tab active" : "tab",
    );
    tabEl.append(span(tab.title), span(tab.dirty ? "•" : ""), closeButton(tab.noteId));
    tabs.append(tabEl);
  }
  const toolbar = el(
    "div",
    "toolbar",
    button("B", "Bold", () => editor?.applyFormat(toggleBold), "tool-button"),
    button("I", "Italic", () => editor?.applyFormat(toggleItalic), "tool-button"),
    button("H", "Highlight", () => editor?.applyFormat(toggleHighlight), "tool-button"),
    button(
      "H1",
      "Heading",
      () => editor?.applyFormat((md, start) => toggleHeading(md, start, 1)),
      "tool-button",
    ),
    button("↶", "Undo", () => editor?.undo(), "tool-button"),
    button("↷", "Redo", () => editor?.redo(), "tool-button"),
    button("◇", "Source", () => toggleSourceMode(), "tool-button"),
    button("✓", "Save", () => void manualSave(), "tool-button"),
  );
  const active = activeTab();
  const title = active === undefined ? "No note selected" : active.path;
  const topbar = el("div", "topbar", tabs, toolbar);
  const workspace = el("section", "workspace");
  if (active === undefined) {
    workspace.append(emptyState());
  } else if (active.doc === null) {
    workspace.append(el("div", "loading", "Loading"));
  } else {
    const meta = el("div", "editor-meta", el("div", "path-label", title), renderTagRow(active));
    const mount = el("div", "editor-mount");
    mount.id = "editor-mount";
    workspace.append(meta, mount);
    if (active.conflict) {
      workspace.append(
        el(
          "div",
          "conflict-banner",
          "Save conflict. Your rejected draft is recoverable on the server.",
        ),
      );
    }
  }
  main.append(topbar, workspace, statusBar());
  return main;
}

function renderOverlays(): HTMLElement {
  const host = el("div", "overlay-host");
  if (state.commandOpen) {
    const input = document.createElement("input");
    input.className = "command-input";
    input.value = state.commandFilter;
    input.placeholder = "Command";
    input.addEventListener("input", () => {
      state.commandFilter = input.value;
      render();
    });
    const list = el("div", "command-list");
    for (const command of filteredCommands()) {
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
      void updateSearchOverlay();
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
            void openInTab(note.noteId);
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
  if (state.notice !== null) {
    host.append(el("div", "toast", state.notice));
  }
  return host;
}

function statusBar(): HTMLElement {
  const active = activeTab();
  const text =
    active === undefined ? "" : active.saving ? "Saving" : active.dirty ? "Unsaved" : "Saved";
  return el(
    "footer",
    "statusbar",
    span(text),
    span(state.boot?.searchStatus.degraded ? "Search degraded" : ""),
  );
}

function emptyState(): HTMLElement {
  return el(
    "div",
    "empty-state",
    el("div", "empty-title", "No note selected"),
    button("New note", "New note", () => void commandCreate(), "primary-button"),
  );
}

function mountActiveEditor(): void {
  const tab = activeTab();
  const mount = document.querySelector<HTMLElement>("#editor-mount");
  if (tab?.doc === null && tab !== undefined) {
    void ensureActiveLoaded();
    return;
  }
  if (tab === undefined || tab.doc === null || mount === null) {
    return;
  }
  editor = createEditor(mount, {
    extensions,
    contentClassName: "md-editor-content app-editor",
    sourceClassName: "md-editor-source app-editor-source",
    onChange: () => {
      const active = activeTab();
      if (active === undefined || editor === null) {
        return;
      }
      const current = active.draft ?? active.doc?.content ?? "";
      const editorValue = editor.getValue();
      active.draft =
        active.doc !== null && frontmatterSupportsTags(current)
          ? setMarkdownTags(editorValue, active.doc.meta.tags)
          : editorValue;
      active.dirty = active.draft !== active.doc?.content;
      active.cursorOffset = editor.getCursorOffset();
      active.sourceMode = editor.isSourceMode;
      scheduleAutosave();
      scheduleSessionSave();
      renderStatusOnly();
    },
    onSave: () => void manualSave(),
  });
  editor.setValue(editableMarkdown(tab), tab.cursorOffset ?? undefined);
  if (tab.sourceMode && !editor.isSourceMode) {
    editor.toggleSourceMode();
  }
  editor.focus();
}

function destroyEditor(): void {
  if (editor !== null) {
    editor.destroy();
    editor = null;
  }
}

async function ensureActiveLoaded(): Promise<void> {
  const tab = activeTab();
  if (tab === undefined || tab.doc !== null) {
    return;
  }
  tab.doc = await openNote(tab.noteId, state.vault);
  tab.title = tab.doc.meta.title;
  tab.path = tab.doc.meta.path;
  state.notes.set(tab.doc.meta.noteId, tab.doc.meta);
  render();
}

async function activateTab(noteId: string): Promise<void> {
  syncActiveDraft();
  state.activeNoteId = noteId;
  render();
  await ensureActiveLoaded();
}

async function openInTab(noteId: string): Promise<void> {
  let tab = tabById(noteId);
  const note = state.notes.get(noteId);
  if (tab === undefined && note !== undefined) {
    tab = {
      noteId,
      title: note.title,
      path: note.path,
      doc: null,
      draft: null,
      dirty: false,
      saving: false,
      conflict: false,
      cursorOffset: null,
      sourceMode: false,
    };
    state.tabs.push(tab);
  }
  if (tab !== undefined) {
    await activateTab(noteId);
  }
}

function closeTab(noteId: string, remember = true): void {
  const index = state.tabs.findIndex((tab) => tab.noteId === noteId);
  if (index === -1) {
    return;
  }
  const [closed] = state.tabs.splice(index, 1);
  if (remember && closed !== undefined) {
    state.closedTabs = [
      {
        noteId: closed.noteId,
        title: closed.title,
        path: closed.path,
        cursorOffset: closed.cursorOffset,
        sourceMode: closed.sourceMode,
      },
      ...state.closedTabs.filter((tab) => tab.noteId !== closed.noteId),
    ].slice(0, 20);
  }
  if (state.activeNoteId === noteId) {
    state.activeNoteId =
      state.tabs[Math.max(0, index - 1)]?.noteId ?? state.tabs[0]?.noteId ?? null;
  }
  render();
}

async function manualSave(): Promise<void> {
  syncActiveDraft();
  const tab = activeTab();
  if (tab === undefined || tab.doc === null || !tab.dirty || tab.saving) {
    return;
  }
  await persistTab(tab);
}

function scheduleAutosave(): void {
  window.clearTimeout(autosaveTimer);
  autosaveTimer = window.setTimeout(() => {
    const tab = activeTab();
    if (tab !== undefined && tab.dirty && !tab.saving) {
      void persistTab(tab);
    }
  }, 900);
}

async function persistTab(tab: Tab): Promise<void> {
  if (tab.doc === null || tab.draft === null) {
    return;
  }
  tab.saving = true;
  renderStatusOnly();
  try {
    const response = await saveNote(
      tab.noteId,
      {
        content: tab.draft,
        baseSeq: tab.doc.meta.seq,
        baseHash: tab.doc.meta.contentHash,
        checkpoint: false,
      },
      state.vault,
    );
    if (response.document !== null) {
      tab.doc = response.document;
      tab.draft = response.document.content;
      tab.title = response.document.meta.title;
      tab.path = response.document.meta.path;
      state.notes.set(response.document.meta.noteId, response.document.meta);
    }
    tab.dirty = false;
    tab.conflict = false;
  } catch (error) {
    tab.conflict = isSaveConflict(error);
    notify(tab.conflict ? "Save conflict" : "Save failed");
  } finally {
    tab.saving = false;
    render();
  }
}

function syncActiveDraft(): void {
  const tab = activeTab();
  if (tab === undefined || editor === null) {
    return;
  }
  const current = tab.draft ?? tab.doc?.content ?? "";
  const editorValue = editor.getValue();
  tab.draft =
    tab.doc !== null && frontmatterSupportsTags(current)
      ? setMarkdownTags(editorValue, tab.doc.meta.tags)
      : editorValue;
  tab.cursorOffset = editor.getCursorOffset();
  tab.sourceMode = editor.isSourceMode;
  tab.dirty = tab.doc !== null && tab.draft !== tab.doc.content;
}

function scheduleSessionSave(): void {
  window.clearTimeout(sessionTimer);
  sessionTimer = window.setTimeout(() => {
    const session: SessionState = {
      openTabs: state.tabs.map((tab) => ({
        noteId: tab.noteId,
        title: tab.title,
        path: tab.path,
        cursorOffset: tab.cursorOffset,
        sourceMode: tab.sourceMode,
      })),
      activeNoteId: state.activeNoteId,
      closedTabs: state.closedTabs,
    };
    void saveSession(session, state.vault);
  }, 250);
}

async function updateSearch(): Promise<void> {
  const query = state.searchQuery.trim();
  state.searchHits = query === "" ? null : await searchNotes(query, state.vault);
  render();
}

async function updateSearchOverlay(): Promise<void> {
  const query = state.searchOverlayQuery.trim();
  state.searchOverlayHits = query === "" ? null : await searchNotes(query, state.vault);
  render();
}

async function commandCreate(): Promise<void> {
  const path = prompt("Path", "Untitled.md");
  if (path === null || path.trim() === "") {
    return;
  }
  const response = await createNote(
    { path, content: `# ${path.replace(/\.md$/i, "")}\n`, source: null },
    state.vault,
  );
  if (response.document !== null) {
    state.notes.set(response.meta.noteId, response.meta);
    state.tabs.push({
      noteId: response.meta.noteId,
      title: response.meta.title,
      path: response.meta.path,
      doc: response.document,
      draft: response.document.content,
      dirty: false,
      saving: false,
      conflict: false,
      cursorOffset: null,
      sourceMode: false,
    });
    await activateTab(response.meta.noteId);
  }
}

async function commandOpen(): Promise<void> {
  const query = prompt("Open note", state.searchQuery);
  if (query === null) {
    return;
  }
  const needle = query.trim().toLowerCase();
  if (needle === "") {
    state.searchOpen = true;
    render();
    return;
  }
  const direct = [...state.notes.values()].find(
    (note) => note.title.toLowerCase().includes(needle) || note.path.toLowerCase().includes(needle),
  );
  if (direct !== undefined) {
    await openInTab(direct.noteId);
    return;
  }
  const [hit] = await searchNotes(query, state.vault);
  if (hit !== undefined) {
    await openInTab(hit.note.noteId);
  }
}

async function commandRename(): Promise<void> {
  const tab = activeTab();
  if (tab === undefined) {
    return;
  }
  const path = prompt("Path", tab.path);
  if (path === null || path.trim() === "" || path === tab.path) {
    return;
  }
  const response = await renameNote(tab.noteId, { path }, state.vault);
  tab.title = response.meta.title;
  tab.path = response.meta.path;
  if (tab.doc !== null) {
    tab.doc.meta = response.meta;
  }
  state.notes.set(response.meta.noteId, response.meta);
  render();
}

async function commandDelete(): Promise<void> {
  const tab = activeTab();
  if (tab === undefined || !confirm(`Delete ${tab.path}?`)) {
    return;
  }
  await deleteNote(tab.noteId, state.vault);
  state.notes.delete(tab.noteId);
  closeTab(tab.noteId, false);
}

async function commandPin(): Promise<void> {
  const tab = activeTab();
  if (tab === undefined) {
    return;
  }
  const pinned = !state.pinned.has(tab.noteId);
  await setPinned(tab.noteId, pinned, state.vault);
  if (pinned) {
    state.pinned.add(tab.noteId);
  } else {
    state.pinned.delete(tab.noteId);
  }
  render();
}

async function commandReopenClosed(): Promise<void> {
  const tab = state.closedTabs.shift();
  if (tab !== undefined) {
    await openInTab(tab.noteId);
  }
}

async function commandImportHtml(): Promise<void> {
  const file = await pickHtmlFile();
  if (file === null) {
    return;
  }
  const html = await file.text();
  const doc = new DOMParser().parseFromString(html, "text/html");
  const parsed = await new Defuddle(doc, { markdown: true, separateMarkdown: true }).parseAsync();
  const markdown = parsed.contentMarkdown?.trim();
  if (markdown === undefined || markdown === "") {
    notify("HTML import failed");
    return;
  }
  const title = parsed.title?.trim() || file.name.replace(/\.html?$/i, "") || "Imported";
  const body = importedMarkdown(title, markdown, parsed);
  const response = await createNote(
    { path: uniqueImportPath(title), content: body, source: "import" },
    state.vault,
  );
  if (response.document !== null) {
    state.notes.set(response.meta.noteId, response.meta);
    state.tabs.push({
      noteId: response.meta.noteId,
      title: response.meta.title,
      path: response.meta.path,
      doc: response.document,
      draft: response.document.content,
      dirty: false,
      saving: false,
      conflict: false,
      cursorOffset: null,
      sourceMode: false,
    });
    await activateTab(response.meta.noteId);
  }
}

async function commandSettings(): Promise<void> {
  if (state.boot === null) {
    return;
  }
  const current = state.boot.settings.excludedFolders.join(", ");
  const value = prompt("Excluded folders", current);
  if (value === null) {
    return;
  }
  const settings = {
    ...state.boot.settings,
    excludedFolders: value
      .split(",")
      .map((part) => part.trim())
      .filter((part) => part !== ""),
  };
  state.boot.settings = await saveSettings(settings, state.vault);
  notify("Settings saved");
}

function commandRevisions(): void {
  notify("Revisions UI is stage 13");
}

async function commandAddTag(): Promise<void> {
  const tab = activeTab();
  if (
    tab?.doc === null ||
    tab === undefined ||
    !frontmatterSupportsTags(tab.draft ?? tab.doc.content)
  ) {
    return;
  }
  const value = prompt("Tag", "");
  const tag = normalizeTag(value ?? "");
  if (tag === null) {
    return;
  }
  updateActiveTags([...new Set([...tab.doc.meta.tags, tag])]);
}

function toggleSourceMode(): void {
  const tab = activeTab();
  if (tab === undefined || editor === null) {
    return;
  }
  editor.toggleSourceMode();
  tab.sourceMode = editor.isSourceMode;
  scheduleSessionSave();
}

function filteredCommands(): Command[] {
  const commands: Command[] = [
    { id: "open", label: "Open note", run: commandOpen },
    { id: "create", label: "Create note", run: commandCreate },
    { id: "save", label: "Save note", run: manualSave },
    { id: "rename", label: "Rename note", run: commandRename },
    { id: "delete", label: "Delete note", run: commandDelete },
    {
      id: "pin",
      label:
        state.activeNoteId !== null && state.pinned.has(state.activeNoteId)
          ? "Unpin note"
          : "Pin note",
      run: commandPin,
    },
    { id: "reopen", label: "Reopen closed tab", run: commandReopenClosed },
    {
      id: "search",
      label: "Search notes",
      run: () => {
        state.searchOpen = true;
        render();
      },
    },
    { id: "import", label: "Import HTML", run: commandImportHtml },
    { id: "revisions", label: "Revisions", run: () => commandRevisions() },
    { id: "settings", label: "Settings", run: commandSettings },
    { id: "source", label: "Source mode", run: () => toggleSourceMode() },
  ];
  const query = state.commandFilter.toLowerCase();
  return commands.filter((command) =>
    `${command.id} ${command.label}`.toLowerCase().includes(query),
  );
}

function renderTagRow(tab: Tab): HTMLElement {
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
        updateActiveTags(tab.doc?.meta.tags.filter((item) => item !== tag) ?? []);
      },
      "tag",
    );
    tagButton.disabled = !supported;
    row.append(tagButton);
  }
  const add = button("+ tag", "Add tag", () => void commandAddTag(), "tag tag-add");
  add.disabled = !supported;
  row.append(add);
  if (!supported) {
    row.append(span("Tags locked", "tag-disabled"));
  }
  return row;
}

function noteList(ids: string[]): HTMLElement {
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
        () => void openInTab(note.noteId),
        state.activeNoteId === note.noteId ? "note-row active" : "note-row",
      ),
    );
  }
  return list;
}

function section(title: string, body: HTMLElement): HTMLElement {
  return el("section", "sidebar-section", el("h2", "section-title", title), body);
}

function activeTab(): Tab | undefined {
  return state.tabs.find((tab) => tab.noteId === state.activeNoteId);
}

function tabById(noteId: string): Tab | undefined {
  return state.tabs.find((tab) => tab.noteId === noteId);
}

function closeButton(noteId: string): HTMLElement {
  const close = button(
    "×",
    "Close",
    (event) => {
      event.stopPropagation();
      closeTab(noteId);
    },
    "tab-close",
  );
  return close;
}

function button(
  label: string,
  title: string,
  onClick: (event: MouseEvent) => void,
  className = "button",
): HTMLButtonElement {
  const element = document.createElement("button");
  element.type = "button";
  element.className = className;
  element.title = title;
  element.textContent = label;
  element.addEventListener("click", onClick);
  return element;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  ...children: Array<Node | string>
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  element.className = className;
  for (const child of children) {
    element.append(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return element;
}

function span(text: string, className = ""): HTMLSpanElement {
  const element = document.createElement("span");
  element.className = className;
  element.textContent = text;
  return element;
}

function renderStatusOnly(): void {
  const status = document.querySelector(".statusbar");
  status?.replaceWith(statusBar());
}

function notify(message: string): void {
  state.notice = message;
  window.setTimeout(() => {
    state.notice = null;
    render();
  }, 2400);
}

function isSaveConflict(error: unknown): boolean {
  const response =
    error instanceof Error && "response" in error
      ? (error.response as ApiErrorResponse | null)
      : null;
  return response?.error.code === "save_conflict";
}

function updateActiveTags(tags: string[]): void {
  syncActiveDraft();
  const tab = activeTab();
  if (tab === undefined || tab.doc === null) {
    return;
  }
  const current = tab.draft ?? tab.doc.content;
  if (!frontmatterSupportsTags(current)) {
    return;
  }
  const next = setMarkdownTags(markdownBody(current), tags);
  tab.draft = next;
  tab.doc.meta.tags = tags;
  tab.dirty = next !== tab.doc.content;
  editor?.setValue(markdownBody(next), tab.cursorOffset ?? undefined);
  scheduleAutosave();
  render();
}

function editableMarkdown(tab: Tab): string {
  const content = tab.draft ?? tab.doc?.content ?? "";
  return frontmatterSupportsTags(content) ? markdownBody(content) : content;
}

function frontmatterSupportsTags(content: string): boolean {
  if (!content.startsWith("---\n") && !content.startsWith("---\r\n")) {
    return true;
  }
  const normalized = content.replaceAll("\r\n", "\n");
  const end = normalized.indexOf("\n---", 4);
  if (end === -1) {
    return false;
  }
  const body = normalized.slice(4, end).split("\n");
  let inTagsList = false;
  for (const line of body) {
    const trimmed = line.trim();
    if (trimmed === "") {
      continue;
    }
    if (trimmed.startsWith("tags:")) {
      inTagsList = true;
      continue;
    }
    if (inTagsList && trimmed.startsWith("-")) {
      continue;
    }
    return false;
  }
  return true;
}

function setMarkdownTags(content: string, tags: string[]): string {
  const body = markdownBody(content);
  if (tags.length === 0) {
    return body;
  }
  return `---\ntags:\n${tags.map((tag) => `  - ${tag}`).join("\n")}\n---\n\n${body}`;
}

function markdownBody(content: string): string {
  const normalized = content.replaceAll("\r\n", "\n");
  const hasFrontmatter = normalized.startsWith("---\n");
  const end = hasFrontmatter ? normalized.indexOf("\n---", 4) : -1;
  return end === -1 ? normalized : normalized.slice(end + 4).replace(/^\n+/, "");
}

function normalizeTag(value: string): string | null {
  const tag = value.trim().replace(/^#/, "");
  return tag === "" || /[\r\n]/.test(tag) ? null : tag;
}

function pickHtmlFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".html,.htm,text/html";
    input.addEventListener("change", () => resolve(input.files?.[0] ?? null), { once: true });
    input.click();
  });
}

function importedMarkdown(
  title: string,
  markdown: string,
  parsed: { author?: string; site?: string; published?: string; description?: string },
): string {
  const metadata = [
    parsed.author ? `Author: ${parsed.author}` : null,
    parsed.site ? `Site: ${parsed.site}` : null,
    parsed.published ? `Published: ${parsed.published}` : null,
    parsed.description ? `Description: ${parsed.description}` : null,
  ].filter((line): line is string => line !== null);
  const heading = markdown.startsWith("# ") ? "" : `# ${title}\n\n`;
  return metadata.length === 0
    ? `${heading}${markdown}\n`
    : `${heading}${metadata.join("\n")}\n\n${markdown}\n`;
}

function uniqueImportPath(title: string): string {
  const stem =
    title
      .trim()
      .replace(/[^\d A-Za-z._-]+/g, "")
      .replace(/\s+/g, " ")
      .trim() || "Imported";
  let path = `${stem}.md`;
  let suffix = 2;
  const existing = new Set([...state.notes.values()].map((note) => note.path.toLowerCase()));
  while (existing.has(path.toLowerCase())) {
    path = `${stem} ${suffix}.md`;
    suffix += 1;
  }
  return path;
}
