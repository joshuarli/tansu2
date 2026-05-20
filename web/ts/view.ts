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
  toggleReadingMode: () => void;
  formatBold: () => void;
  formatItalic: () => void;
  formatHighlight: () => void;
  formatStrikethrough: () => void;
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
  const sidebar = el("aside", state.readingMode ? "sidebar reading-sidebar" : "sidebar");
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
  sidebar.append(section("Recent", noteList(state, recentNoteIds(state), actions)));
  return sidebar;
}

function renderMain(state: State, actions: ViewActions): HTMLElement {
  const active = activeTab(state);
  const reading = state.readingMode;
  const main = el("main", reading ? "main reading-mode" : "main");
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
  const title = active === undefined ? "No note selected" : active.path;
  const topbar = el("div", "topbar", tabs, topbarActions(active, state, actions));
  const workspace = el("section", "workspace");
  if (active === undefined) {
    workspace.append(emptyState(actions));
  } else if (active.doc === null) {
    workspace.append(el("div", "loading", "Loading"));
  } else {
    const mount = el("div", "editor-mount");
    mount.id = "editor-mount";
    if (reading) {
      workspace.append(mount);
    } else {
      const meta = el(
        "div",
        "editor-meta",
        el("div", "path-label", title),
        renderTagRow(active, actions),
      );
      workspace.append(meta, mount);
    }
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
  if (!reading) {
    main.append(topbar, editorToolbar(actions));
  }
  main.append(workspace, renderStatusBar(state));
  return main;
}

function topbarActions(active: Tab | undefined, state: State, actions: ViewActions): HTMLElement {
  const controls = el("div", "topbar-actions");
  if (active !== undefined) {
    controls.append(
      toolButton(state.readingMode ? "edit" : "read", state.readingMode ? "Edit" : "Read", () =>
        actions.toggleReadingMode(),
      ),
    );
  }
  return controls;
}

function editorToolbar(actions: ViewActions): HTMLElement {
  return el(
    "div",
    "toolbar",
    toolButton("bold", "Bold", () => actions.formatBold()),
    toolButton("italic", "Italic", () => actions.formatItalic()),
    toolButton("strikethrough", "Strikethrough", () => actions.formatStrikethrough()),
    toolButton("highlight", "Highlight", () => actions.formatHighlight()),
    toolButton("heading", "Heading", () => actions.formatHeading()),
    toolButton("undo", "Undo", () => actions.undo()),
    toolButton("redo", "Redo", () => actions.redo()),
    toolButton("code", "Source", () => actions.toggleSourceMode()),
    toolButton("save", "Save", () => actions.manualSave()),
  );
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

function recentNoteIds(state: State): string[] {
  const ids = new Set(state.recent);
  return [...state.recent, ...[...state.notes.keys()].filter((noteId) => !ids.has(noteId))];
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

type ToolIcon =
  | "bold"
  | "italic"
  | "strikethrough"
  | "highlight"
  | "heading"
  | "undo"
  | "redo"
  | "code"
  | "save"
  | "read"
  | "edit";

function toolButton(iconName: ToolIcon, title: string, onClick: (event: MouseEvent) => void) {
  const element = button("", title, onClick, "tool-button");
  element.ariaLabel = title;
  element.append(toolIcon(iconName));
  return element;
}

function toolIcon(iconName: ToolIcon): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  for (const child of iconPaths(iconName)) {
    svg.append(child);
  }
  return svg;
}

function iconPaths(iconName: ToolIcon): SVGElement[] {
  switch (iconName) {
    case "bold":
      return [iconPath("M8 5h5a3 3 0 0 1 0 6H8zM8 11h6a4 4 0 0 1 0 8H8zM8 5v14")];
    case "italic":
      return [iconPath("M10 5h7M7 19h7M14 5l-4 14")];
    case "strikethrough":
      return [
        iconPath("M7 7.5A4 4 0 0 1 11 5h5M8 17a5 5 0 0 0 4 2h1.5a3.5 3.5 0 0 0 0-7H6M5 12h14"),
      ];
    case "highlight":
      return [
        iconShape("path", {
          d: "M7 18.5h4.5L20 10l-2.8-2.8-11.7 9.3z",
          fill: "#ffe16a",
          stroke: "none",
        }),
        iconPath("M14 4l6 6-8.5 8.5H7.5l-2-2z", "#d88b18"),
        iconPath("M5 20h11", "#d88b18"),
      ];
    case "heading":
      return [iconPath("M6 5v14M18 5v14M6 12h12M14 19h7")];
    case "undo":
      return [iconPath("M9 7l-5 5 5 5M4 12h10a5 5 0 1 1-3.5 8.5")];
    case "redo":
      return [iconPath("M15 7l5 5-5 5M20 12H10a5 5 0 1 0 3.5 8.5")];
    case "code":
      return [iconPath("M9 7l-5 5 5 5M15 7l5 5-5 5")];
    case "save":
      return [
        iconShape("rect", { x: "9", y: "15", width: "6", height: "5", fill: "#dfe7f2" }),
        iconPath("M5 4h12l2 2v14H5zM8 4v6h8V4M8 20v-6h8v6"),
      ];
    case "read":
      return [
        iconPath(
          "M4 6.5A7 7 0 0 1 11 6h2a7 7 0 0 1 7 7 7 7 0 0 1-7 7h-2a7 7 0 0 1-7-7zM8 9h8M8 13h6M8 17h4",
        ),
      ];
    case "edit":
      return [iconPath("M5 19h4l10-10-4-4L5 15zM13.5 6.5l4 4M4 22h16")];
  }
}

function iconPath(d: string, stroke = "currentColor"): SVGPathElement {
  return iconShape("path", {
    d,
    fill: "none",
    stroke,
    "stroke-width": "1.8",
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
  }) as SVGPathElement;
}

function iconShape<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attributes: Record<string, string>,
): SVGElementTagNameMap[K] {
  const element = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [key, value] of Object.entries(attributes)) {
    element.setAttribute(key, value);
  }
  return element;
}
