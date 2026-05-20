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
import { pickHtmlImport } from "./html-import.ts";
import {
  editableMarkdown,
  frontmatterSupportsTags,
  markdownBody,
  normalizeTag,
  setMarkdownTags,
} from "./markdown-tags.ts";
import {
  activeTab,
  createState,
  sessionFromState,
  tabById,
  tabFromDocument,
  tabFromMeta,
  type Command,
  type State,
  type Tab,
} from "./state.ts";
import type { ApiErrorResponse } from "./types.generated.ts";
import { renderApp, renderLoading, renderStatusBar, type ViewActions } from "./view.ts";

export class TansuApp {
  private readonly state: State;
  private editor: EditorHandle | null = null;
  private autosaveTimer: number | undefined;
  private sessionTimer: number | undefined;
  private events: EventSource | null = null;
  private readonly extensions = [
    createWikiImageExtension({ resolveUrl: (name) => `/${name}` }),
    createCalloutExtension(),
  ];

  constructor(private readonly root: HTMLElement) {
    this.state = createState(activeVault());
  }

  async boot(): Promise<void> {
    this.destroyEditor();
    this.events?.close();
    this.state.vault = activeVault();
    this.state.boot = await bootstrap(this.state.vault);
    this.state.notes = new Map(this.state.boot.notes.map((note) => [note.noteId, note]));
    this.state.pinned = new Set(this.state.boot.pinnedNoteIds);
    this.state.recent = this.state.boot.recentNoteIds;
    this.state.tabs = this.state.boot.session.openTabs
      .filter((tab) => this.state.notes.has(tab.noteId))
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
    this.state.closedTabs = this.state.boot.session.closedTabs.filter((tab) =>
      this.state.notes.has(tab.noteId),
    );
    this.state.activeNoteId =
      this.state.boot.session.activeNoteId &&
      this.state.notes.has(this.state.boot.session.activeNoteId)
        ? this.state.boot.session.activeNoteId
        : (this.state.tabs[0]?.noteId ?? null);
    this.connectSse();
    this.render();
    if (this.state.activeNoteId !== null) {
      await this.ensureActiveLoaded();
    }
  }

  bindGlobalEvents(): void {
    window.addEventListener("beforeunload", (event) => {
      this.syncActiveDraft();
      if (this.state.tabs.some((tab) => tab.dirty)) {
        event.preventDefault();
      }
    });

    window.addEventListener("keydown", (event) => {
      const target = event.target;
      const inEditor =
        target instanceof HTMLElement &&
        (target.closest(".md-editor-content") !== null ||
          target.closest(".md-editor-source") !== null);
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        this.state.commandOpen = true;
        this.state.searchOpen = false;
        this.state.commandFilter = "";
        this.render();
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "p") {
        event.preventDefault();
        this.state.searchOpen = true;
        this.state.commandOpen = false;
        this.state.searchOverlayQuery = this.state.searchQuery;
        this.state.searchOverlayHits = this.state.searchHits;
        this.render();
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void this.manualSave();
        return;
      }
      if (event.key === "Escape" && (this.state.commandOpen || this.state.searchOpen)) {
        event.preventDefault();
        this.state.commandOpen = false;
        this.state.searchOpen = false;
        this.render();
        return;
      }
      if (!inEditor && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "n") {
        event.preventDefault();
        void this.commandCreate();
      }
    });
  }

  private connectSse(): void {
    this.events?.close();
    this.events = connectEvents(this.state.vault);
    this.events.addEventListener("message", (event) => {
      const payload = parseServerEvent(event as MessageEvent<string>);
      if (payload.vault !== this.state.vault) {
        return;
      }
      for (const note of payload.notes) {
        this.state.notes.set(note.noteId, note);
        const tab = tabById(this.state, note.noteId);
        if (tab !== undefined) {
          tab.title = note.title;
          tab.path = note.path;
          if (tab.doc !== null) {
            tab.doc.meta = note;
          }
        }
      }
      for (const noteId of payload.deletedNoteIds) {
        this.state.notes.delete(noteId);
        this.closeTab(noteId, false);
      }
      this.render();
    });
  }

  private render(): void {
    this.syncActiveDraft();
    this.destroyEditor();
    if (this.state.boot === null) {
      this.root.replaceChildren(renderLoading());
      return;
    }
    this.root.replaceChildren(...renderApp(this.state, this.viewActions()));
    this.mountActiveEditor();
    this.scheduleSessionSave();
  }

  private renderStatusOnly(): void {
    const status = document.querySelector(".statusbar");
    status?.replaceWith(renderStatusBar(this.state));
  }

  private mountActiveEditor(): void {
    const tab = activeTab(this.state);
    const mount = document.querySelector<HTMLElement>("#editor-mount");
    if (tab?.doc === null && tab !== undefined) {
      void this.ensureActiveLoaded();
      return;
    }
    if (tab === undefined || tab.doc === null || mount === null) {
      return;
    }
    this.editor = createEditor(mount, {
      extensions: this.extensions,
      contentClassName: "md-editor-content app-editor",
      sourceClassName: "md-editor-source app-editor-source",
      onChange: () => this.captureEditorChange(),
      onSave: () => void this.manualSave(),
    });
    this.editor.setValue(editableMarkdown(tab), tab.cursorOffset ?? undefined);
    if (tab.sourceMode && !this.editor.isSourceMode) {
      this.editor.toggleSourceMode();
    }
    this.editor.focus();
  }

  private destroyEditor(): void {
    if (this.editor !== null) {
      this.editor.destroy();
      this.editor = null;
    }
  }

  private captureEditorChange(): void {
    const active = activeTab(this.state);
    if (active === undefined || this.editor === null) {
      return;
    }
    const current = active.draft ?? active.doc?.content ?? "";
    const editorValue = this.editor.getValue();
    active.draft =
      active.doc !== null && frontmatterSupportsTags(current)
        ? setMarkdownTags(editorValue, active.doc.meta.tags)
        : editorValue;
    active.dirty = active.draft !== active.doc?.content;
    active.cursorOffset = this.editor.getCursorOffset();
    active.sourceMode = this.editor.isSourceMode;
    this.scheduleAutosave();
    this.scheduleSessionSave();
    this.renderStatusOnly();
  }

  private syncActiveDraft(): void {
    const tab = activeTab(this.state);
    if (tab === undefined || this.editor === null) {
      return;
    }
    const current = tab.draft ?? tab.doc?.content ?? "";
    const editorValue = this.editor.getValue();
    tab.draft =
      tab.doc !== null && frontmatterSupportsTags(current)
        ? setMarkdownTags(editorValue, tab.doc.meta.tags)
        : editorValue;
    tab.cursorOffset = this.editor.getCursorOffset();
    tab.sourceMode = this.editor.isSourceMode;
    tab.dirty = tab.doc !== null && tab.draft !== tab.doc.content;
  }

  private async ensureActiveLoaded(): Promise<void> {
    const tab = activeTab(this.state);
    if (tab === undefined || tab.doc !== null) {
      return;
    }
    tab.doc = await openNote(tab.noteId, this.state.vault);
    tab.title = tab.doc.meta.title;
    tab.path = tab.doc.meta.path;
    this.state.notes.set(tab.doc.meta.noteId, tab.doc.meta);
    this.render();
  }

  private async activateTab(noteId: string): Promise<void> {
    this.syncActiveDraft();
    this.state.activeNoteId = noteId;
    this.render();
    await this.ensureActiveLoaded();
  }

  private async openInTab(noteId: string): Promise<void> {
    let tab = tabById(this.state, noteId);
    const note = this.state.notes.get(noteId);
    if (tab === undefined && note !== undefined) {
      tab = tabFromMeta(note);
      this.state.tabs.push(tab);
    }
    if (tab !== undefined) {
      await this.activateTab(noteId);
    }
  }

  private closeTab(noteId: string, remember = true): void {
    const index = this.state.tabs.findIndex((tab) => tab.noteId === noteId);
    if (index === -1) {
      return;
    }
    const [closed] = this.state.tabs.splice(index, 1);
    if (remember && closed !== undefined) {
      this.state.closedTabs = [
        {
          noteId: closed.noteId,
          title: closed.title,
          path: closed.path,
          cursorOffset: closed.cursorOffset,
          sourceMode: closed.sourceMode,
        },
        ...this.state.closedTabs.filter((tab) => tab.noteId !== closed.noteId),
      ].slice(0, 20);
    }
    if (this.state.activeNoteId === noteId) {
      this.state.activeNoteId =
        this.state.tabs[Math.max(0, index - 1)]?.noteId ?? this.state.tabs[0]?.noteId ?? null;
    }
    this.render();
  }

  private async manualSave(): Promise<void> {
    this.syncActiveDraft();
    const tab = activeTab(this.state);
    if (tab === undefined || tab.doc === null || !tab.dirty || tab.saving) {
      return;
    }
    await this.persistTab(tab);
  }

  private scheduleAutosave(): void {
    window.clearTimeout(this.autosaveTimer);
    this.autosaveTimer = window.setTimeout(() => {
      const tab = activeTab(this.state);
      if (tab !== undefined && tab.dirty && !tab.saving) {
        void this.persistTab(tab);
      }
    }, 900);
  }

  private async persistTab(tab: Tab): Promise<void> {
    if (tab.doc === null || tab.draft === null) {
      return;
    }
    tab.saving = true;
    this.renderStatusOnly();
    try {
      const response = await saveNote(
        tab.noteId,
        {
          content: tab.draft,
          baseSeq: tab.doc.meta.seq,
          baseHash: tab.doc.meta.contentHash,
          checkpoint: false,
        },
        this.state.vault,
      );
      if (response.document !== null) {
        tab.doc = response.document;
        tab.draft = response.document.content;
        tab.title = response.document.meta.title;
        tab.path = response.document.meta.path;
        this.state.notes.set(response.document.meta.noteId, response.document.meta);
      }
      tab.dirty = false;
      tab.conflict = false;
    } catch (error) {
      tab.conflict = isSaveConflict(error);
      this.notify(tab.conflict ? "Save conflict" : "Save failed");
    } finally {
      tab.saving = false;
      this.render();
    }
  }

  private scheduleSessionSave(): void {
    window.clearTimeout(this.sessionTimer);
    this.sessionTimer = window.setTimeout(() => {
      void saveSession(sessionFromState(this.state), this.state.vault);
    }, 250);
  }

  private async updateSearch(): Promise<void> {
    const query = this.state.searchQuery.trim();
    this.state.searchHits = query === "" ? null : await searchNotes(query, this.state.vault);
    this.render();
  }

  private async updateSearchOverlay(): Promise<void> {
    const query = this.state.searchOverlayQuery.trim();
    this.state.searchOverlayHits = query === "" ? null : await searchNotes(query, this.state.vault);
    this.render();
  }

  private async commandCreate(): Promise<void> {
    const path = prompt("Path", "Untitled.md");
    if (path === null || path.trim() === "") {
      return;
    }
    const response = await createNote(
      { path, content: `# ${path.replace(/\.md$/i, "")}\n`, source: null },
      this.state.vault,
    );
    if (response.document !== null) {
      this.state.notes.set(response.meta.noteId, response.meta);
      this.state.tabs.push(tabFromDocument(response.document));
      await this.activateTab(response.meta.noteId);
    }
  }

  private async commandOpen(): Promise<void> {
    const query = prompt("Open note", this.state.searchQuery);
    if (query === null) {
      return;
    }
    const needle = query.trim().toLowerCase();
    if (needle === "") {
      this.state.searchOpen = true;
      this.render();
      return;
    }
    const direct = [...this.state.notes.values()].find(
      (note) =>
        note.title.toLowerCase().includes(needle) || note.path.toLowerCase().includes(needle),
    );
    if (direct !== undefined) {
      await this.openInTab(direct.noteId);
      return;
    }
    const [hit] = await searchNotes(query, this.state.vault);
    if (hit !== undefined) {
      await this.openInTab(hit.note.noteId);
    }
  }

  private async commandRename(): Promise<void> {
    const tab = activeTab(this.state);
    if (tab === undefined) {
      return;
    }
    const path = prompt("Path", tab.path);
    if (path === null || path.trim() === "" || path === tab.path) {
      return;
    }
    const response = await renameNote(tab.noteId, { path }, this.state.vault);
    tab.title = response.meta.title;
    tab.path = response.meta.path;
    if (tab.doc !== null) {
      tab.doc.meta = response.meta;
    }
    this.state.notes.set(response.meta.noteId, response.meta);
    this.render();
  }

  private async commandDelete(): Promise<void> {
    const tab = activeTab(this.state);
    if (tab === undefined || !confirm(`Delete ${tab.path}?`)) {
      return;
    }
    await deleteNote(tab.noteId, this.state.vault);
    this.state.notes.delete(tab.noteId);
    this.closeTab(tab.noteId, false);
  }

  private async commandPin(): Promise<void> {
    const tab = activeTab(this.state);
    if (tab === undefined) {
      return;
    }
    const pinned = !this.state.pinned.has(tab.noteId);
    await setPinned(tab.noteId, pinned, this.state.vault);
    if (pinned) {
      this.state.pinned.add(tab.noteId);
    } else {
      this.state.pinned.delete(tab.noteId);
    }
    this.render();
  }

  private async commandReopenClosed(): Promise<void> {
    const tab = this.state.closedTabs.shift();
    if (tab !== undefined) {
      await this.openInTab(tab.noteId);
    }
  }

  private async commandImportHtml(): Promise<void> {
    const imported = await pickHtmlImport(this.state.notes.values());
    if (imported === null) {
      this.notify("HTML import failed");
      return;
    }
    const response = await createNote(
      { path: imported.path, content: imported.content, source: "import" },
      this.state.vault,
    );
    if (response.document !== null) {
      this.state.notes.set(response.meta.noteId, response.meta);
      this.state.tabs.push(tabFromDocument(response.document));
      await this.activateTab(response.meta.noteId);
    }
  }

  private async commandSettings(): Promise<void> {
    if (this.state.boot === null) {
      return;
    }
    const current = this.state.boot.settings.excludedFolders.join(", ");
    const value = prompt("Excluded folders", current);
    if (value === null) {
      return;
    }
    const settings = {
      ...this.state.boot.settings,
      excludedFolders: value
        .split(",")
        .map((part) => part.trim())
        .filter((part) => part !== ""),
    };
    this.state.boot.settings = await saveSettings(settings, this.state.vault);
    this.notify("Settings saved");
  }

  private commandRevisions(): void {
    this.notify("Revisions UI is stage 13");
  }

  private async commandAddTag(): Promise<void> {
    const tab = activeTab(this.state);
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
    this.updateActiveTags([...new Set([...tab.doc.meta.tags, tag])]);
  }

  private updateActiveTags(tags: string[]): void {
    this.syncActiveDraft();
    const tab = activeTab(this.state);
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
    this.editor?.setValue(markdownBody(next), tab.cursorOffset ?? undefined);
    this.scheduleAutosave();
    this.render();
  }

  private toggleSourceMode(): void {
    const tab = activeTab(this.state);
    if (tab === undefined || this.editor === null) {
      return;
    }
    this.editor.toggleSourceMode();
    tab.sourceMode = this.editor.isSourceMode;
    this.scheduleSessionSave();
  }

  private filteredCommands(): Command[] {
    const commands: Command[] = [
      { id: "open", label: "Open note", run: () => this.commandOpen() },
      { id: "create", label: "Create note", run: () => this.commandCreate() },
      { id: "save", label: "Save note", run: () => this.manualSave() },
      { id: "rename", label: "Rename note", run: () => this.commandRename() },
      { id: "delete", label: "Delete note", run: () => this.commandDelete() },
      {
        id: "pin",
        label:
          this.state.activeNoteId !== null && this.state.pinned.has(this.state.activeNoteId)
            ? "Unpin note"
            : "Pin note",
        run: () => this.commandPin(),
      },
      { id: "reopen", label: "Reopen closed tab", run: () => this.commandReopenClosed() },
      {
        id: "search",
        label: "Search notes",
        run: () => {
          this.state.searchOpen = true;
          this.render();
        },
      },
      { id: "import", label: "Import HTML", run: () => this.commandImportHtml() },
      { id: "revisions", label: "Revisions", run: () => this.commandRevisions() },
      { id: "settings", label: "Settings", run: () => this.commandSettings() },
      { id: "source", label: "Source mode", run: () => this.toggleSourceMode() },
    ];
    const query = this.state.commandFilter.toLowerCase();
    return commands.filter((command) =>
      `${command.id} ${command.label}`.toLowerCase().includes(query),
    );
  }

  private notify(message: string): void {
    this.state.notice = message;
    window.setTimeout(() => {
      this.state.notice = null;
      this.render();
    }, 2400);
  }

  private viewActions(): ViewActions {
    return {
      render: () => this.render(),
      switchVault: (index) => {
        setActiveVault(index);
        void this.boot();
      },
      updateSearch: () => void this.updateSearch(),
      updateSearchOverlay: () => void this.updateSearchOverlay(),
      commandCreate: () => void this.commandCreate(),
      commandAddTag: () => void this.commandAddTag(),
      filteredCommands: () => this.filteredCommands(),
      activateTab: (noteId) => void this.activateTab(noteId),
      closeTab: (noteId) => this.closeTab(noteId),
      openInTab: (noteId) => void this.openInTab(noteId),
      updateActiveTags: (tags) => this.updateActiveTags(tags),
      formatBold: () => this.editor?.applyFormat(toggleBold),
      formatItalic: () => this.editor?.applyFormat(toggleItalic),
      formatHighlight: () => this.editor?.applyFormat(toggleHighlight),
      formatHeading: () => this.editor?.applyFormat((md, start) => toggleHeading(md, start, 1)),
      undo: () => this.editor?.undo(),
      redo: () => this.editor?.redo(),
      toggleSourceMode: () => this.toggleSourceMode(),
      manualSave: () => void this.manualSave(),
    };
  }
}

function isSaveConflict(error: unknown): boolean {
  const response =
    error instanceof Error && "response" in error
      ? (error.response as ApiErrorResponse | null)
      : null;
  return response?.error.code === "save_conflict";
}

export function startApp(root: HTMLElement): void {
  const app = new TansuApp(root);
  app.bindGlobalEvents();
  void app.boot();
}
