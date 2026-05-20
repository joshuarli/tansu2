import {
  createCalloutExtension,
  createEditor,
  createWikiImageExtension,
  toggleBold,
  toggleHeading,
  toggleHighlight,
  toggleItalic,
  toggleStrikethrough,
  type EditorConfig,
  type EditorHandle,
} from "@joshuarli98/md-wysiwyg";

import {
  activeVault,
  assetUrl,
  bootstrap,
  connectEvents,
  createNote,
  deleteNote,
  listRevisions,
  openConflictDraft,
  openNote,
  openRevision,
  parseServerEvent,
  renameNote,
  restoreConflictDraft,
  restoreRevision,
  saveNote,
  saveSettings,
  saveSession,
  searchNotes,
  setActiveVault,
  setPinned,
  uploadImage,
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
import type { ApiErrorResponse, NoteMeta } from "./types.generated.ts";
import { renderApp, renderLoading, renderStatusBar, type ViewActions } from "./view.ts";

export class TansuApp {
  private readonly state: State;
  private editor: EditorHandle | null = null;
  private editorNoteId: string | null = null;
  private autosaveTimer: number | undefined;
  private sessionTimer: number | undefined;
  private events: EventSource | null = null;
  private readonly extensions = [
    createWikiImageExtension({ resolveUrl: (name) => assetUrl(name, this.state.vault) }),
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
        conflictDraftId: null,
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
    window.addEventListener("beforeunload", () => {
      this.syncActiveDraft();
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
      if (
        event.key === "Escape" &&
        (this.state.commandOpen ||
          this.state.searchOpen ||
          this.state.revisionsOpen ||
          this.state.settingsOpen ||
          this.state.conflictDraft !== null ||
          this.state.noteDialog !== null ||
          this.state.contextMenu !== null)
      ) {
        event.preventDefault();
        this.closeOverlays();
        return;
      }
      if (!inEditor && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "n") {
        event.preventDefault();
        void this.commandCreate();
      }
    });

    window.addEventListener("click", (event) => {
      if (
        this.state.contextMenu !== null &&
        event.target instanceof HTMLElement &&
        event.target.closest(".context-menu") === null
      ) {
        this.state.contextMenu = null;
        this.render();
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
    const config: EditorConfig = {
      extensions: this.extensions,
      contentClassName: "md-editor-content app-editor",
      sourceClassName: "md-editor-source app-editor-source",
      onImagePaste: (blob) => this.uploadPastedImage(blob),
      onChange: () => this.captureEditorChange(),
      onSave: () => void this.manualSave(),
    };
    const settings = this.state.boot?.settings;
    if (settings !== undefined) {
      config.undoStackMax = settings.undoStackMax;
      config.typingCheckpointMs = settings.autosaveDelayMs;
      config.imageWebpQuality = settings.imageWebpQuality;
    }
    this.editor = createEditor(mount, config);
    this.editorNoteId = tab.noteId;
    this.editor.setValue(editableMarkdown(tab), tab.cursorOffset ?? undefined);
    if (tab.sourceMode && !this.editor.isSourceMode) {
      this.editor.toggleSourceMode();
    }
    this.editor.focus();
  }

  private async uploadPastedImage(blob: Blob): Promise<string | null> {
    try {
      const uploaded = await uploadImage(blob, this.state.vault);
      return `<img src="${assetUrl(uploaded.name, this.state.vault)}" alt="${uploaded.name}" data-wiki-image="${uploaded.name}" loading="lazy">`;
    } catch {
      this.notify("Image upload failed");
      return null;
    }
  }

  private destroyEditor(): void {
    if (this.editor !== null) {
      this.editor.destroy();
      this.editor = null;
    }
    this.editorNoteId = null;
  }

  private captureEditorChange(): void {
    const active =
      this.editorNoteId === null ? activeTab(this.state) : tabById(this.state, this.editorNoteId);
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
    const tab =
      this.editorNoteId === null ? activeTab(this.state) : tabById(this.state, this.editorNoteId);
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
    this.touchRecent(noteId);
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
    }, this.state.boot?.settings.autosaveDelayMs ?? 900);
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
      tab.conflictDraftId = null;
    } catch (error) {
      const conflict = saveConflict(error);
      tab.conflict = conflict !== null;
      tab.conflictDraftId = conflict?.draft.draftId ?? null;
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
    this.state.noteDialog = { kind: "create", title: "" };
    this.state.commandOpen = false;
    this.render();
  }

  private commandOpen(): void {
    this.state.searchOpen = true;
    this.state.commandOpen = false;
    this.state.searchOverlayQuery = this.state.searchQuery;
    this.state.searchOverlayHits = this.state.searchHits;
    this.render();
  }

  private commandRename(noteId = this.state.activeNoteId ?? undefined): void {
    if (noteId === undefined) {
      return;
    }
    const note = this.state.notes.get(noteId);
    if (note === undefined) {
      return;
    }
    this.state.noteDialog = { kind: "rename", noteId, title: note.title };
    this.render();
  }

  private commandDelete(noteId = this.state.activeNoteId ?? undefined): void {
    if (noteId === undefined || !this.state.notes.has(noteId)) {
      return;
    }
    this.state.noteDialog = { kind: "delete", noteId };
    this.render();
  }

  private async commandPin(noteId = this.state.activeNoteId ?? undefined): Promise<void> {
    if (noteId === undefined) {
      return;
    }
    const pinned = !this.state.pinned.has(noteId);
    await setPinned(noteId, pinned, this.state.vault);
    if (pinned) {
      this.state.pinned.add(noteId);
    } else {
      this.state.pinned.delete(noteId);
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

  private commandSettings(): void {
    if (this.state.boot === null) {
      return;
    }
    this.state.settingsOpen = true;
    this.render();
  }

  private async commandRevisions(): Promise<void> {
    const tab = activeTab(this.state);
    if (tab === undefined) {
      return;
    }
    this.state.revisionsOpen = true;
    this.state.revisionList = await listRevisions(tab.noteId, this.state.vault);
    this.state.revisionDocument = null;
    this.render();
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
    this.state.noteDialog = { kind: "tag", value: "" };
    this.render();
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

  private closeOverlays(): void {
    this.state.commandOpen = false;
    this.state.searchOpen = false;
    this.state.revisionsOpen = false;
    this.state.settingsOpen = false;
    this.state.conflictDraft = null;
    this.state.noteDialog = null;
    this.state.contextMenu = null;
    this.render();
  }

  private closeContextMenu(): void {
    this.state.contextMenu = null;
    this.render();
  }

  private openNoteContextMenu(noteId: string, x: number, y: number): void {
    this.state.contextMenu = { noteId, x, y };
    this.render();
  }

  private async submitNoteDialog(value?: string): Promise<void> {
    const dialog = this.state.noteDialog;
    if (dialog === null) {
      return;
    }
    if (dialog.kind === "create") {
      const title = (value ?? "").trim() || "Untitled";
      const path = uniqueNotePath(title, this.state.notes.values());
      const response = await createNote(
        { path, content: `# ${title}\n`, source: null },
        this.state.vault,
      );
      if (response.document !== null) {
        this.state.notes.set(response.meta.noteId, response.meta);
        this.state.tabs.push(tabFromDocument(response.document));
        this.state.noteDialog = null;
        await this.activateTab(response.meta.noteId);
      }
      return;
    }
    if (dialog.kind === "rename") {
      const note = this.state.notes.get(dialog.noteId);
      const title = (value ?? "").trim();
      if (note === undefined || title === "" || title === note.title) {
        this.state.noteDialog = null;
        this.render();
        return;
      }
      const path = renamedPath(note.path, title, this.state.notes.values(), dialog.noteId);
      const response = await renameNote(dialog.noteId, { path }, this.state.vault);
      const tab = tabById(this.state, dialog.noteId);
      if (tab !== undefined) {
        tab.title = response.meta.title;
        tab.path = response.meta.path;
        if (tab.doc !== null) {
          tab.doc.meta = response.meta;
        }
      }
      this.state.notes.set(response.meta.noteId, response.meta);
      this.state.noteDialog = null;
      this.render();
      return;
    }
    if (dialog.kind === "tag") {
      const tab = activeTab(this.state);
      const tag = normalizeTag(value ?? "");
      if (tab?.doc !== null && tab !== undefined && tag !== null) {
        this.updateActiveTags([...new Set([...tab.doc.meta.tags, tag])]);
      }
      this.state.noteDialog = null;
      this.render();
      return;
    }
    const noteId = dialog.noteId;
    this.state.noteDialog = null;
    this.render();
    try {
      await deleteNote(noteId, this.state.vault);
      this.state.notes.delete(noteId);
      this.state.pinned.delete(noteId);
      this.state.recent = this.state.recent.filter((item) => item !== noteId);
      this.closeTab(noteId, false);
    } catch {
      this.notify("Delete failed");
    }
  }

  private async saveSettingsFromModal(settings: {
    excludedFoldersText: string;
    autosaveDelayMs: number;
    undoStackMax: number;
    imageWebpQuality: number;
  }): Promise<void> {
    if (this.state.boot === null) {
      return;
    }
    this.state.boot.settings = await saveSettings(
      {
        ...this.state.boot.settings,
        excludedFolders: settings.excludedFoldersText
          .split(",")
          .map((part) => part.trim())
          .filter((part) => part !== ""),
        autosaveDelayMs: Math.max(150, settings.autosaveDelayMs),
        undoStackMax: Math.max(20, settings.undoStackMax),
        imageWebpQuality: Math.min(1, Math.max(0.1, settings.imageWebpQuality)),
      },
      this.state.vault,
    );
    this.editor?.setConfig({
      undoStackMax: this.state.boot.settings.undoStackMax,
      typingCheckpointMs: this.state.boot.settings.autosaveDelayMs,
      imageWebpQuality: this.state.boot.settings.imageWebpQuality,
    });
    this.state.settingsOpen = false;
    this.notify("Settings saved");
  }

  private async selectRevision(eventId: number): Promise<void> {
    const tab = activeTab(this.state);
    if (tab === undefined) {
      return;
    }
    this.syncActiveDraft();
    this.state.revisionDocument = await openRevision(tab.noteId, eventId, this.state.vault);
    this.render();
  }

  private async restoreSelectedRevision(): Promise<void> {
    const tab = activeTab(this.state);
    const revision = this.state.revisionDocument;
    if (tab === undefined || revision === null) {
      return;
    }
    const response = await restoreRevision(tab.noteId, revision.revision.eventId, this.state.vault);
    this.applyMutationToTab(response);
    this.state.revisionsOpen = false;
    this.state.revisionDocument = null;
    this.notify("Revision restored");
  }

  private async restoreActiveConflictDraft(): Promise<void> {
    const tab = activeTab(this.state);
    if (tab === undefined || tab.conflictDraftId === null) {
      return;
    }
    const response = await restoreConflictDraft(tab.noteId, tab.conflictDraftId, this.state.vault);
    this.applyMutationToTab(response);
    this.state.conflictDraft = null;
    this.notify("Conflict draft restored");
  }

  private async viewActiveConflictDraft(): Promise<void> {
    const tab = activeTab(this.state);
    if (tab === undefined || tab.conflictDraftId === null) {
      return;
    }
    this.state.conflictDraft = await openConflictDraft(
      tab.noteId,
      tab.conflictDraftId,
      this.state.vault,
    );
    this.render();
  }

  private applyMutationToTab(response: Awaited<ReturnType<typeof saveNote>>): void {
    if (response.document === null) {
      return;
    }
    let tab = tabById(this.state, response.meta.noteId);
    if (tab === undefined) {
      tab = tabFromDocument(response.document);
      this.state.tabs.push(tab);
    } else {
      tab.doc = response.document;
      tab.draft = response.document.content;
      tab.title = response.document.meta.title;
      tab.path = response.document.meta.path;
      tab.dirty = false;
      tab.conflict = false;
      tab.conflictDraftId = null;
    }
    this.state.notes.set(response.meta.noteId, response.meta);
    this.state.activeNoteId = response.meta.noteId;
    this.touchRecent(response.meta.noteId);
    this.render();
  }

  private touchRecent(noteId: string): void {
    if (!this.state.notes.has(noteId)) {
      return;
    }
    this.state.recent = [noteId, ...this.state.recent.filter((item) => item !== noteId)].slice(
      0,
      50,
    );
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
      commandRename: (noteId) => this.commandRename(noteId),
      commandDelete: (noteId) => this.commandDelete(noteId),
      commandPin: (noteId) => void this.commandPin(noteId),
      commandAddTag: () => void this.commandAddTag(),
      closeOverlays: () => this.closeOverlays(),
      closeContextMenu: () => this.closeContextMenu(),
      openNoteContextMenu: (noteId, x, y) => this.openNoteContextMenu(noteId, x, y),
      submitNoteDialog: (value) => void this.submitNoteDialog(value),
      saveSettings: (settings) => void this.saveSettingsFromModal(settings),
      openRevisions: () => void this.commandRevisions(),
      selectRevision: (eventId) => void this.selectRevision(eventId),
      restoreSelectedRevision: () => void this.restoreSelectedRevision(),
      viewConflictDraft: () => void this.viewActiveConflictDraft(),
      restoreConflictDraft: () => void this.restoreActiveConflictDraft(),
      filteredCommands: () => this.filteredCommands(),
      activateTab: (noteId) => void this.activateTab(noteId),
      closeTab: (noteId) => this.closeTab(noteId),
      openInTab: (noteId) => void this.openInTab(noteId),
      updateActiveTags: (tags) => this.updateActiveTags(tags),
      formatBold: () => this.editor?.applyFormat(toggleBold),
      formatItalic: () => this.editor?.applyFormat(toggleItalic),
      formatHighlight: () => this.editor?.applyFormat(toggleHighlight),
      formatStrikethrough: () => this.editor?.applyFormat(toggleStrikethrough),
      formatHeading: () => this.editor?.applyFormat((md, start) => toggleHeading(md, start, 1)),
      undo: () => this.editor?.undo(),
      redo: () => this.editor?.redo(),
      toggleSourceMode: () => this.toggleSourceMode(),
      manualSave: () => void this.manualSave(),
    };
  }
}

function saveConflict(
  error: unknown,
): Extract<ApiErrorResponse["error"], { code: "save_conflict" }> | null {
  const response =
    error instanceof Error && "response" in error
      ? (error.response as ApiErrorResponse | null)
      : null;
  return response?.error.code === "save_conflict" ? response.error : null;
}

function uniqueNotePath(title: string, notes: Iterable<NoteMeta>): string {
  const base = slugifyTitle(title);
  const existing = new Set([...notes].map((note) => note.path.toLowerCase()));
  for (let i = 1; ; i += 1) {
    const suffix = i === 1 ? "" : `-${i}`;
    const path = `${base}${suffix}.md`;
    if (!existing.has(path.toLowerCase())) {
      return path;
    }
  }
}

function renamedPath(
  currentPath: string,
  title: string,
  notes: Iterable<NoteMeta>,
  noteId: string,
): string {
  const slash = currentPath.lastIndexOf("/");
  const dir = slash === -1 ? "" : `${currentPath.slice(0, slash + 1)}`;
  const base = slugifyTitle(title);
  const existing = new Set(
    [...notes].filter((note) => note.noteId !== noteId).map((note) => note.path.toLowerCase()),
  );
  for (let i = 1; ; i += 1) {
    const suffix = i === 1 ? "" : `-${i}`;
    const path = `${dir}${base}${suffix}.md`;
    if (!existing.has(path.toLowerCase())) {
      return path;
    }
  }
}

function slugifyTitle(title: string): string {
  const slug = title
    .trim()
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "untitled";
}

export function startApp(root: HTMLElement): void {
  const app = new TansuApp(root);
  app.bindGlobalEvents();
  void app.boot();
}
