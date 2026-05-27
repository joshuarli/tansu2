import { saveConflictError } from "./api.ts";
import { commandItems } from "./app/commands.ts";
import type { CommandId, CommandItem, EditorToolbarCommand, ViewEvent } from "./app/events.ts";
import { defaultServices, type AppServices } from "./app/services.ts";
import { logClientEvent } from "./dev-log.ts";
import {
  createCalloutExtension,
  createWikiImageExtension,
  toggleBold,
  toggleHeading,
  toggleHighlight,
  toggleItalic,
  toggleStrikethrough,
  type EditorConfig,
  type EditorHandle,
} from "./editor/index.js";
import {
  editableMarkdown,
  frontmatterSupportsTags,
  markdownBody,
  normalizeTag,
  setMarkdownTags,
} from "./markdown-tags.ts";
import { buildSaveNoteDeltaRequest } from "./save-delta.ts";
import {
  activeTab,
  createState,
  normalizeMarkdownNewlines,
  sessionFromState,
  tabById,
  tabFromDocument,
  tabFromMeta,
  toAssetName,
  toConflictDraftId,
  toContentHash,
  toNoteId,
  toRevisionEventId,
  type State,
  type VaultIndex,
  type Tab,
} from "./state.ts";
import type { NoteMeta, NoteMutationResponse } from "./types.generated.ts";
import { renderApp, renderLoading, renderStatusBar, type ViewActions } from "./view.ts";

const SESSION_SAVE_DELAY_MS = 250;
const EDITOR_SESSION_SAVE_DELAY_MS = 3000;
const MIN_SEARCH_QUERY_CHARS = 3;

export class TansuApp {
  private readonly state: State;
  private editor: EditorHandle | null = null;
  private editorNoteId: string | null = null;
  private captureTimer: number | undefined;
  private readonly autosaveTimers = new Map<string, number>();
  private sessionTimer: number | undefined;
  private events: EventSource | null = null;
  private readonly noteLoads = new Map<string, Promise<void>>();
  private bootSeq = 0;
  private searchRequestSeq = 0;
  private searchOverlayRequestSeq = 0;
  private editorChangeLogged = false;
  private readonly extensions = [
    createWikiImageExtension({
      resolveUrl: (name) => this.services.api.assetUrl(toAssetName(name), this.state.vault),
    }),
    createCalloutExtension(),
  ];

  constructor(
    private readonly root: HTMLElement,
    private readonly services: AppServices = defaultServices,
  ) {
    this.state = createState(this.services.api.activeVault());
  }

  async boot(): Promise<void> {
    const bootSeq = ++this.bootSeq;
    this.destroyEditor();
    this.events?.close();
    this.clearAutosaveTimers();
    this.noteLoads.clear();
    const vault = this.services.api.activeVault();
    logClientEvent("info", "system.event", {
      system: { component: "app", action: "boot_start" },
      vault,
    });
    this.state.vault = vault;
    this.services.performance.markPerformance("tansu:bootstrap:start");
    const boot = await this.services.api.bootstrap(vault);
    if (bootSeq !== this.bootSeq || this.state.vault !== vault) {
      return;
    }
    this.state.boot = boot;
    logClientEvent("info", "system.event", {
      system: { component: "app", action: "boot_ready" },
      vault,
      notes: boot.notes.length,
    });
    this.services.performance.markPerformance("tansu:bootstrap:response");
    this.state.notes = new Map(this.state.boot.notes.map((note) => [note.noteId, note]));
    this.state.pinned = new Set(this.state.boot.pinnedNoteIds);
    this.state.recent = this.state.boot.recentNoteIds;
    this.state.tabs = this.state.boot.session.openTabs
      .filter((tab) => this.state.notes.has(tab.noteId))
      .map((tab) => ({
        noteId: toNoteId(tab.noteId),
        title: tab.title,
        path: tab.path,
        doc: null,
        draft: null,
        dirty: false,
        saving: false,
        savePending: false,
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
        ? toNoteId(this.state.boot.session.activeNoteId)
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
      const inEditor = this.editor?.containsEditableTarget(target) ?? false;
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
        this.state.searchOverlayQuery = "";
        this.state.searchOverlayHits = null;
        this.render();
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        this.runAsync(this.manualSave(), "Save failed");
        return;
      }
      if (!inEditor && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "e") {
        event.preventDefault();
        this.toggleReadingMode();
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
        this.runAsync(this.commandCreate(), "Create failed");
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
    this.events = this.services.api.connectEvents(this.state.vault);
    this.events.addEventListener("message", (event) => {
      const payload = this.services.api.parseServerEvent(event as MessageEvent<string>);
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
        void this.services.noteCache.deleteCachedNoteBodies(this.state.vault, noteId);
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
    const reading = this.state.readingMode;
    const config: EditorConfig = {
      extensions: this.extensions,
      contentClassName: reading
        ? "md-editor-content app-editor app-reader"
        : "md-editor-content app-editor",
      sourceClassName: "md-editor-source app-editor-source",
      onImagePaste: (blob) => this.uploadPastedImage(blob),
      onChange: () => this.noteEditorChanged(),
      onSave: () => this.runAsync(this.manualSave(), "Save failed"),
      indentUnit: "  ",
    };
    const settings = this.state.boot?.settings;
    if (settings !== undefined) {
      config.undoStackMax = settings.undoStackMax;
      config.typingCheckpointMs = settings.autosaveDelayMs;
      config.imageWebpQuality = settings.imageWebpQuality;
    }
    this.editor = this.services.editor.createEditor(mount, config);
    this.editorNoteId = tab.noteId;
    this.editorChangeLogged = false;
    logClientEvent("info", "client.editor", {
      editor: { action: "mount", noteId: tab.noteId, sourceMode: tab.sourceMode, reading },
      note: { id: tab.noteId, path: tab.path, vault: this.state.vault },
    });
    this.editor.setValue(
      editableMarkdown(tab),
      reading ? undefined : (tab.cursorOffset ?? undefined),
    );
    if (reading) {
      this.editor.setReadOnly(true);
      return;
    }
    if (tab.sourceMode && !this.editor.isSourceMode) {
      this.editor.toggleSourceMode();
    }
    this.services.performance.markPerformance("tansu:editor:mount");
    this.services.performance.markNextPaint("tansu:editor:first-editable-paint");
    this.editor.focus();
  }

  private async uploadPastedImage(blob: Blob): Promise<string | null> {
    try {
      const uploaded = await this.services.api.uploadImage(blob, this.state.vault);
      return `<img src="${this.services.api.assetUrl(toAssetName(uploaded.name), this.state.vault)}" alt="${uploaded.name}" data-wiki-image="${uploaded.name}" loading="lazy">`;
    } catch {
      logClientEvent("warn", "system.event", {
        system: { component: "image", action: "upload_failed" },
      });
      this.notify("Image upload failed");
      return null;
    }
  }

  private destroyEditor(): void {
    if (this.editor !== null) {
      this.flushEditorChange();
      this.editor.destroy();
      this.editor = null;
    }
    this.editorNoteId = null;
  }

  private noteEditorChanged(): void {
    const active =
      this.editorNoteId === null ? activeTab(this.state) : tabById(this.state, this.editorNoteId);
    if (active === undefined || this.editor === null) {
      return;
    }
    active.dirty = true;
    if (!this.editorChangeLogged) {
      this.editorChangeLogged = true;
      logClientEvent("info", "client.editor", {
        editor: { action: "first_change", noteId: active.noteId },
        note: { id: active.noteId, vault: this.state.vault },
      });
    }
    window.clearTimeout(this.captureTimer);
    this.captureTimer = window.setTimeout(() => {
      this.captureTimer = undefined;
      this.captureEditorChange();
    }, 150);
    this.scheduleAutosave();
    this.scheduleEditorSessionSave();
    this.renderStatusOnly();
  }

  private flushEditorChange(): void {
    if (this.captureTimer === undefined) {
      return;
    }
    window.clearTimeout(this.captureTimer);
    this.captureTimer = undefined;
    this.captureEditorChange();
  }

  private captureEditorChange(renderStatus = true): void {
    const active =
      this.editorNoteId === null ? activeTab(this.state) : tabById(this.state, this.editorNoteId);
    if (active === undefined || this.editor === null) {
      return;
    }
    const current = active.draft ?? active.doc?.content ?? "";
    const snapshot = this.editor.getSnapshot();
    const editorValue = snapshot.markdown;
    active.draft =
      active.doc !== null && frontmatterSupportsTags(current)
        ? setMarkdownTags(editorValue, active.doc.meta.tags)
        : editorValue;
    active.dirty = active.draft !== active.doc?.content;
    active.cursorOffset = snapshot.cursorOffset >= 0 ? snapshot.cursorOffset : null;
    active.sourceMode = snapshot.sourceMode;
    if (renderStatus) {
      this.renderStatusOnly();
    }
  }

  private syncActiveDraft(): void {
    window.clearTimeout(this.captureTimer);
    this.captureTimer = undefined;
    const tab =
      this.editorNoteId === null ? activeTab(this.state) : tabById(this.state, this.editorNoteId);
    if (
      tab === undefined ||
      this.state.readingMode ||
      this.editor === null ||
      this.editor.isReadOnly
    ) {
      return;
    }
    const current = tab.draft ?? tab.doc?.content ?? "";
    const snapshot = this.editor.getSnapshot();
    const editorValue = snapshot.markdown;
    tab.draft =
      tab.doc !== null && frontmatterSupportsTags(current)
        ? setMarkdownTags(editorValue, tab.doc.meta.tags)
        : editorValue;
    tab.cursorOffset = snapshot.cursorOffset >= 0 ? snapshot.cursorOffset : null;
    tab.sourceMode = snapshot.sourceMode;
    tab.dirty = tab.doc !== null && tab.draft !== tab.doc.content;
  }

  private async ensureActiveLoaded(): Promise<void> {
    const tab = activeTab(this.state);
    if (tab === undefined || tab.doc !== null) {
      return;
    }
    const key = this.noteLoadKey(tab.noteId);
    const existing = this.noteLoads.get(key);
    if (existing !== undefined) {
      await existing;
      return;
    }
    const vault = this.state.vault;
    logClientEvent("info", "note.open", {
      note: { id: tab.noteId, vault },
    });
    const load = this.loadNote(tab.noteId, vault);
    this.noteLoads.set(key, load);
    try {
      await load;
    } finally {
      if (this.noteLoads.get(key) === load) {
        this.noteLoads.delete(key);
      }
    }
  }

  private noteLoadKey(noteId: string): string {
    return `${this.state.vault}:${noteId}`;
  }

  private async loadNote(noteId: string, vault: VaultIndex): Promise<void> {
    this.services.performance.markPerformance("tansu:note:request:start");
    const serverLoad = this.services.api.openNote(toNoteId(noteId), vault).then((document) => {
      this.services.performance.markPerformance("tansu:note:request:response");
      return {
        ...document,
        content: normalizeMarkdownNewlines(document.content),
      };
    });
    const cached = await this.readCachedNote(noteId, vault);
    if (cached) {
      this.render();
    }
    const document = await serverLoad;
    void this.services.noteCache.cacheNoteBody(vault, document);
    if (this.state.vault !== vault) {
      return;
    }
    const loadedTab = tabById(this.state, document.meta.noteId);
    if (loadedTab === undefined) {
      return;
    }
    this.state.notes.set(document.meta.noteId, document.meta);
    if (loadedTab.dirty) {
      return;
    }
    const sameVisibleContent =
      loadedTab.doc !== null && loadedTab.doc.meta.contentHash === document.meta.contentHash;
    loadedTab.doc = document;
    loadedTab.draft = document.content;
    loadedTab.title = document.meta.title;
    loadedTab.path = document.meta.path;
    if (this.state.activeNoteId === document.meta.noteId && !sameVisibleContent) {
      this.render();
    }
  }

  private async readCachedNote(noteId: string, vault: number): Promise<boolean> {
    const meta = this.state.notes.get(noteId);
    if (meta === undefined) {
      this.services.performance.markPerformance("tansu:note-cache:miss");
      return false;
    }
    const cached = await this.services.noteCache.getCachedNoteBody(vault, meta);
    if (this.state.vault !== vault) {
      return false;
    }
    const target = tabById(this.state, noteId);
    const currentMeta = this.state.notes.get(noteId);
    if (
      cached === null ||
      target === undefined ||
      this.state.activeNoteId !== noteId ||
      target.doc !== null ||
      target.dirty ||
      currentMeta === undefined ||
      cached.contentHash !== currentMeta.contentHash
    ) {
      this.services.performance.markPerformance("tansu:note-cache:miss");
      return false;
    }
    target.doc = {
      meta: currentMeta,
      content: normalizeMarkdownNewlines(cached.content),
    };
    target.draft = target.doc.content;
    target.title = currentMeta.title;
    target.path = currentMeta.path;
    this.services.performance.markPerformance("tansu:note-cache:hit");
    return true;
  }

  private async activateTab(noteId: string): Promise<void> {
    this.syncActiveDraft();
    this.state.activeNoteId = toNoteId(noteId);
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
    if (tab === undefined || tab.doc === null || !tab.dirty) {
      return;
    }
    if (tab.saving) {
      tab.savePending = true;
      return;
    }
    this.clearAutosaveTimer(tab);
    await this.persistTab(tab);
  }

  private scheduleAutosave(): void {
    const tab =
      this.editorNoteId === null ? activeTab(this.state) : tabById(this.state, this.editorNoteId);
    const noteId = tab?.noteId;
    const vault = this.state.vault;
    if (noteId === undefined) {
      return;
    }
    const key = this.autosaveTimerKey(vault, noteId);
    this.clearAutosaveTimerByKey(key);
    const timer = window.setTimeout(() => {
      this.autosaveTimers.delete(key);
      this.syncActiveDraft();
      if (this.state.vault !== vault) {
        return;
      }
      const target = tabById(this.state, noteId);
      if (target !== undefined && target.dirty) {
        if (target.saving) {
          target.savePending = true;
        } else {
          this.runAsync(this.persistTab(target), "Save failed");
        }
      }
    }, this.state.boot?.settings.autosaveDelayMs ?? 900);
    this.autosaveTimers.set(key, timer);
  }

  private autosaveTimerKey(vault: VaultIndex, noteId: string): string {
    return `${vault}:${noteId}`;
  }

  private clearAutosaveTimer(tab: Tab): void {
    this.clearAutosaveTimerByKey(this.autosaveTimerKey(this.state.vault, tab.noteId));
  }

  private clearAutosaveTimerByKey(key: string): void {
    const timer = this.autosaveTimers.get(key);
    if (timer === undefined) {
      return;
    }
    window.clearTimeout(timer);
    this.autosaveTimers.delete(key);
  }

  private clearAutosaveTimers(): void {
    for (const timer of this.autosaveTimers.values()) {
      window.clearTimeout(timer);
    }
    this.autosaveTimers.clear();
  }

  private async persistTab(tab: Tab): Promise<void> {
    if (tab.doc === null || tab.draft === null) {
      return;
    }
    const vault = this.state.vault;
    const savingDraft = tab.draft;
    tab.savePending = false;
    tab.saving = true;
    this.renderStatusOnly();
    try {
      const request = await buildSaveNoteDeltaRequest(
        tab.doc.content,
        tab.draft,
        tab.doc.meta.seq,
        tab.doc.meta.contentHash,
        false,
      );
      const response = await this.services.api.saveNoteDelta(
        tab.noteId,
        {
          ...request,
          baseHash: toContentHash(request.baseHash),
          contentHash: toContentHash(request.contentHash),
        },
        vault,
      );
      if (response.document !== null) {
        const document = {
          ...response.document,
          content: normalizeMarkdownNewlines(response.document.content),
        };
        void this.services.noteCache.cacheNoteBody(vault, document);
        if (this.state.vault !== vault) {
          return;
        }
        const currentDraft = tab.draft;
        tab.doc = document;
        tab.draft = currentDraft === savingDraft ? document.content : currentDraft;
        tab.title = document.meta.title;
        tab.path = document.meta.path;
        this.state.notes.set(document.meta.noteId, document.meta);
        tab.dirty = tab.draft !== document.content;
      } else {
        const document = {
          meta: response.meta,
          content: normalizeMarkdownNewlines(savingDraft),
        };
        void this.services.noteCache.cacheNoteBody(vault, document);
        if (this.state.vault !== vault) {
          return;
        }
        const currentDraft = tab.draft;
        tab.doc = document;
        tab.draft = currentDraft === savingDraft ? document.content : currentDraft;
        tab.title = document.meta.title;
        tab.path = document.meta.path;
        this.state.notes.set(document.meta.noteId, document.meta);
        tab.dirty = tab.draft !== document.content;
      }
      tab.conflict = false;
      tab.conflictDraftId = null;
      logClientEvent("info", "note.save", {
        note: { id: tab.noteId, path: tab.path, vault },
        save: {
          bytes: savingDraft.length,
          seq: tab.doc?.meta.seq,
          dirty: tab.dirty,
          delta: true,
        },
      });
    } catch (error) {
      if (this.state.vault !== vault) {
        return;
      }
      const conflict = saveConflictError(error);
      tab.conflict = conflict !== null;
      tab.conflictDraftId = conflict === null ? null : toConflictDraftId(conflict.draft.draftId);
      logClientEvent(conflict === null ? "error" : "warn", "note.save_failed", {
        note: { id: tab.noteId, vault },
        error: errorSummary(error),
        conflict: conflict !== null,
      });
      this.notify(tab.conflict ? "Save conflict" : "Save failed");
    } finally {
      tab.saving = false;
      if (this.state.vault === vault) {
        if (tab.savePending && tab.dirty && tab.doc !== null) {
          tab.savePending = false;
          this.runAsync(this.persistTab(tab), "Save failed");
        } else {
          this.render();
        }
      }
    }
  }

  private scheduleSessionSave(): void {
    window.clearTimeout(this.sessionTimer);
    this.sessionTimer = window.setTimeout(() => {
      void this.services.api.saveSession(sessionFromState(this.state), this.state.vault);
    }, SESSION_SAVE_DELAY_MS);
  }

  private scheduleEditorSessionSave(): void {
    window.clearTimeout(this.sessionTimer);
    this.sessionTimer = window.setTimeout(() => {
      this.syncActiveDraft();
      void this.services.api.saveSession(sessionFromState(this.state), this.state.vault);
    }, EDITOR_SESSION_SAVE_DELAY_MS);
  }

  private async updateSearch(): Promise<void> {
    const seq = ++this.searchRequestSeq;
    const vault = this.state.vault;
    const query = this.state.searchQuery.trim();
    if (query.length < MIN_SEARCH_QUERY_CHARS) {
      this.state.searchHits = null;
      this.render();
      return;
    }
    logClientEvent("info", "client.search", {
      search: { surface: "sidebar", action: "start", queryLength: query.length },
      vault,
    });
    const hits = await this.services.api.searchNotes(query, vault);
    if (
      seq !== this.searchRequestSeq ||
      this.state.vault !== vault ||
      query !== this.state.searchQuery.trim()
    ) {
      return;
    }
    this.state.searchHits = hits;
    logClientEvent("info", "client.search", {
      search: {
        surface: "sidebar",
        action: "complete",
        queryLength: query.length,
        hits: hits.length,
      },
      vault,
    });
    this.render();
  }

  private async updateSearchOverlay(): Promise<void> {
    const seq = ++this.searchOverlayRequestSeq;
    const vault = this.state.vault;
    const query = this.state.searchOverlayQuery.trim();
    if (query.length < MIN_SEARCH_QUERY_CHARS) {
      this.state.searchOverlayHits = null;
      this.render();
      return;
    }
    logClientEvent("info", "client.search", {
      search: { surface: "overlay", action: "start", queryLength: query.length },
      vault,
    });
    const hits = await this.services.api.searchNotes(query, vault);
    if (
      seq !== this.searchOverlayRequestSeq ||
      this.state.vault !== vault ||
      query !== this.state.searchOverlayQuery.trim()
    ) {
      return;
    }
    this.state.searchOverlayHits = hits;
    logClientEvent("info", "client.search", {
      search: {
        surface: "overlay",
        action: "complete",
        queryLength: query.length,
        hits: hits.length,
      },
      vault,
    });
    this.render();
  }

  private async commandCreate(): Promise<void> {
    this.logCommand("create");
    this.state.noteDialog = { kind: "create", title: "" };
    this.state.commandOpen = false;
    this.render();
  }

  private commandOpen(): void {
    this.logCommand("open");
    this.state.searchOpen = true;
    this.state.commandOpen = false;
    this.state.searchOverlayQuery = "";
    this.state.searchOverlayHits = null;
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
    this.logCommand("rename", noteId);
    this.state.noteDialog = { kind: "rename", noteId: toNoteId(noteId), title: note.title };
    this.render();
  }

  private commandDelete(noteId = this.state.activeNoteId ?? undefined): void {
    if (noteId === undefined || !this.state.notes.has(noteId)) {
      return;
    }
    this.logCommand("delete", noteId);
    this.state.noteDialog = { kind: "delete", noteId: toNoteId(noteId) };
    this.render();
  }

  private async commandPin(noteId = this.state.activeNoteId ?? undefined): Promise<void> {
    if (noteId === undefined) {
      return;
    }
    const pinned = !this.state.pinned.has(noteId);
    this.logCommand("pin", noteId, { pinned });
    await this.services.api.setPinned(toNoteId(noteId), pinned, this.state.vault);
    if (pinned) {
      this.state.pinned.add(noteId);
    } else {
      this.state.pinned.delete(noteId);
    }
    this.render();
  }

  private async commandReopenClosed(): Promise<void> {
    const closed = this.state.closedTabs.shift();
    if (closed === undefined) {
      return;
    }
    this.logCommand("reopen", closed.noteId);
    let tab = tabById(this.state, closed.noteId);
    const note = this.state.notes.get(closed.noteId);
    if (tab === undefined && note !== undefined) {
      tab = tabFromMeta(note);
      tab.cursorOffset = closed.cursorOffset ?? null;
      tab.sourceMode = closed.sourceMode;
      this.state.tabs.push(tab);
    }
    if (tab !== undefined) {
      await this.activateTab(closed.noteId);
    }
  }

  private async commandImportHtml(): Promise<void> {
    const imported = await this.services.htmlImport.pickHtmlImport(this.state.notes.values());
    if (imported === null) {
      logClientEvent("warn", "client.import", {
        import: { action: "cancel_or_failed" },
        vault: this.state.vault,
      });
      this.notify("HTML import failed");
      return;
    }
    this.logCommand("import", undefined, { path: imported.path, bytes: imported.content.length });
    const response = await this.services.api.createNote(
      { path: imported.path, content: imported.content, source: "import" },
      this.state.vault,
    );
    if (response.document !== null) {
      this.state.notes.set(response.meta.noteId, response.meta);
      this.state.tabs.push(tabFromDocument(response.document));
      logClientEvent("info", "client.import", {
        import: { action: "complete", path: imported.path, bytes: imported.content.length },
        note: { id: response.meta.noteId, path: response.meta.path, vault: this.state.vault },
      });
      await this.activateTab(response.meta.noteId);
    }
  }

  private commandSettings(): void {
    if (this.state.boot === null) {
      return;
    }
    this.logCommand("settings");
    this.state.settingsOpen = true;
    this.render();
  }

  private async commandRevisions(): Promise<void> {
    const tab = activeTab(this.state);
    if (tab === undefined) {
      return;
    }
    this.logCommand("revisions", tab.noteId);
    this.state.revisionsOpen = true;
    this.state.revisionList = await this.services.api.listRevisions(tab.noteId, this.state.vault);
    logClientEvent("info", "client.revisions", {
      revisions: { action: "list", count: this.state.revisionList.length },
      note: { id: tab.noteId, vault: this.state.vault },
    });
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
    this.logCommand("add_tag", tab.noteId);
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
    logClientEvent("info", "client.tags", {
      tags: { action: "update", count: tags.length },
      note: { id: tab.noteId, path: tab.path, vault: this.state.vault },
    });
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
    logClientEvent("info", "client.editor", {
      editor: { action: "toggle_source", sourceMode: tab.sourceMode },
      note: { id: tab.noteId, path: tab.path, vault: this.state.vault },
    });
    this.scheduleSessionSave();
  }

  private toggleReadingMode(): void {
    if (activeTab(this.state) === undefined) {
      return;
    }
    this.state.readingMode = !this.state.readingMode;
    logClientEvent("info", "client.editor", {
      editor: { action: "toggle_reading", reading: this.state.readingMode },
      note: { id: this.state.activeNoteId, vault: this.state.vault },
    });
    this.render();
  }

  private filteredCommands(): CommandItem[] {
    return commandItems(this.state);
  }

  private executeCommand(id: CommandId): void {
    this.state.commandOpen = false;
    switch (id) {
      case "open": {
        this.commandOpen();
        return;
      }
      case "create": {
        this.runAsync(this.commandCreate(), "Create failed");
        return;
      }
      case "save": {
        this.runAsync(this.manualSave(), "Save failed");
        return;
      }
      case "rename": {
        this.commandRename();
        return;
      }
      case "delete": {
        this.commandDelete();
        return;
      }
      case "pin": {
        this.runAsync(this.commandPin(), "Pin failed");
        return;
      }
      case "reopen": {
        this.runAsync(this.commandReopenClosed(), "Reopen failed");
        return;
      }
      case "reading": {
        this.toggleReadingMode();
        return;
      }
      case "search": {
        this.state.searchOpen = true;
        this.render();
        return;
      }
      case "import": {
        this.runAsync(this.commandImportHtml(), "Import failed");
        return;
      }
      case "revisions": {
        this.runAsync(this.commandRevisions(), "Revisions failed");
        return;
      }
      case "settings": {
        this.commandSettings();
        return;
      }
      case "source": {
        this.toggleSourceMode();
        return;
      }
    }
  }

  private notify(message: string): void {
    logClientEvent("info", "client.notice", {
      notice: { message },
    });
    this.state.notice = message;
    this.render();
    window.setTimeout(() => {
      this.state.notice = null;
      this.render();
    }, 2400);
  }

  private runAsync(promise: Promise<unknown>, failureMessage: string): void {
    void promise.catch((error: unknown) => {
      logClientEvent("error", "client.error", {
        error: errorSummary(error),
        message: failureMessage,
      });
      this.notify(failureMessage);
    });
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
    logClientEvent("info", "client.command", {
      command: { id: "context", action: "open" },
      note: { id: noteId, vault: this.state.vault },
      position: { x, y },
    });
    this.state.contextMenu = { noteId: toNoteId(noteId), x, y };
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
      const response = await this.services.api.createNote(
        { path, content: `# ${title}\n`, source: null },
        this.state.vault,
      );
      if (response.document !== null) {
        this.state.notes.set(response.meta.noteId, response.meta);
        const tab = tabFromDocument(response.document);
        tab.cursorOffset = tab.doc?.content.length ?? null;
        this.state.tabs.push(tab);
        this.state.noteDialog = null;
        logClientEvent("info", "note.create", {
          note: { id: response.meta.noteId, path: response.meta.path, vault: this.state.vault },
          create: { titleLength: title.length },
        });
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
      const response = await this.services.api.renameNote(
        toNoteId(dialog.noteId),
        { path },
        this.state.vault,
      );
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
      logClientEvent("info", "note.rename", {
        note: { id: response.meta.noteId, path: response.meta.path, vault: this.state.vault },
        rename: { titleLength: title.length },
      });
      this.render();
      return;
    }
    if (dialog.kind === "tag") {
      const tab = activeTab(this.state);
      const tag = normalizeTag(value ?? "");
      if (tab?.doc !== null && tab !== undefined && tag !== null) {
        this.updateActiveTags([...new Set([...tab.doc.meta.tags, tag])]);
        logClientEvent("info", "client.tags", {
          tags: { action: "add", value: tag },
          note: { id: tab.noteId, path: tab.path, vault: this.state.vault },
        });
      }
      this.state.noteDialog = null;
      this.render();
      return;
    }
    const noteId = dialog.noteId;
    const vault = this.state.vault;
    this.state.noteDialog = null;
    this.render();
    try {
      await this.services.api.deleteNote(toNoteId(noteId), vault);
      void this.services.noteCache.deleteCachedNoteBodies(vault, noteId);
      if (this.state.vault !== vault) {
        return;
      }
      this.state.notes.delete(noteId);
      this.state.pinned.delete(noteId);
      this.state.recent = this.state.recent.filter((item) => item !== noteId);
      logClientEvent("info", "note.delete", {
        note: { id: noteId, vault },
      });
      this.closeTab(noteId, false);
    } catch (error) {
      logClientEvent("error", "note.delete_failed", {
        note: { id: noteId, vault },
        error: errorSummary(error),
      });
      if (this.state.vault === vault) {
        this.notify("Delete failed");
      }
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
    const current = this.state.boot.settings;
    this.state.boot.settings = await this.services.api.saveSettings(
      {
        ...current,
        excludedFolders: settings.excludedFoldersText
          .split(",")
          .map((part) => part.trim())
          .filter((part) => part !== ""),
        autosaveDelayMs: Number.isFinite(settings.autosaveDelayMs)
          ? Math.max(150, settings.autosaveDelayMs)
          : current.autosaveDelayMs,
        undoStackMax: Number.isFinite(settings.undoStackMax)
          ? Math.max(20, settings.undoStackMax)
          : current.undoStackMax,
        imageWebpQuality: Number.isFinite(settings.imageWebpQuality)
          ? Math.min(1, Math.max(0.1, settings.imageWebpQuality))
          : current.imageWebpQuality,
      },
      this.state.vault,
    );
    this.editor?.setConfig({
      undoStackMax: this.state.boot.settings.undoStackMax,
      typingCheckpointMs: this.state.boot.settings.autosaveDelayMs,
      imageWebpQuality: this.state.boot.settings.imageWebpQuality,
    });
    this.state.settingsOpen = false;
    logClientEvent("info", "client.settings", {
      settings: {
        action: "save",
        autosaveDelayMs: this.state.boot.settings.autosaveDelayMs,
        undoStackMax: this.state.boot.settings.undoStackMax,
        imageWebpQuality: this.state.boot.settings.imageWebpQuality,
        excludedFolders: this.state.boot.settings.excludedFolders.length,
      },
      vault: this.state.vault,
    });
    this.notify("Settings saved");
  }

  private async selectRevision(eventId: number): Promise<void> {
    const tab = activeTab(this.state);
    if (tab === undefined) {
      return;
    }
    this.syncActiveDraft();
    this.state.revisionDocument = await this.services.api.openRevision(
      tab.noteId,
      toRevisionEventId(eventId),
      this.state.vault,
    );
    logClientEvent("info", "client.revisions", {
      revisions: { action: "select", eventId },
      note: { id: tab.noteId, vault: this.state.vault },
    });
    this.render();
  }

  private async restoreSelectedRevision(): Promise<void> {
    const tab = activeTab(this.state);
    const revision = this.state.revisionDocument;
    if (tab === undefined || revision === null) {
      return;
    }
    const vault = this.state.vault;
    const response = await this.services.api.restoreRevision(
      tab.noteId,
      toRevisionEventId(revision.revision.eventId),
      vault,
    );
    if (this.state.vault !== vault) {
      return;
    }
    this.applyMutationToTab(response, vault);
    this.state.revisionsOpen = false;
    this.state.revisionDocument = null;
    logClientEvent("info", "client.revisions", {
      revisions: { action: "restore", eventId: revision.revision.eventId },
      note: { id: tab.noteId, vault },
    });
    this.notify("Revision restored");
  }

  private async restoreActiveConflictDraft(): Promise<void> {
    const tab = activeTab(this.state);
    if (tab === undefined || tab.conflictDraftId === null) {
      return;
    }
    const vault = this.state.vault;
    const response = await this.services.api.restoreConflictDraft(
      tab.noteId,
      toConflictDraftId(tab.conflictDraftId),
      vault,
    );
    if (this.state.vault !== vault) {
      return;
    }
    this.applyMutationToTab(response, vault);
    this.state.conflictDraft = null;
    logClientEvent("info", "client.conflict", {
      conflict: { action: "restore", draftId: tab.conflictDraftId },
      note: { id: tab.noteId, vault },
    });
    this.notify("Conflict draft restored");
  }

  private async viewActiveConflictDraft(): Promise<void> {
    const tab = activeTab(this.state);
    if (tab === undefined || tab.conflictDraftId === null) {
      return;
    }
    this.state.conflictDraft = await this.services.api.openConflictDraft(
      tab.noteId,
      toConflictDraftId(tab.conflictDraftId),
      this.state.vault,
    );
    logClientEvent("info", "client.conflict", {
      conflict: { action: "view", draftId: tab.conflictDraftId },
      note: { id: tab.noteId, vault: this.state.vault },
    });
    this.render();
  }

  private applyMutationToTab(response: NoteMutationResponse, vault = this.state.vault): void {
    if (response.document === null) {
      return;
    }
    void this.services.noteCache.cacheNoteBody(vault, {
      ...response.document,
      content: normalizeMarkdownNewlines(response.document.content),
    });
    let tab = tabById(this.state, response.meta.noteId);
    if (tab === undefined) {
      tab = tabFromDocument(response.document);
      this.state.tabs.push(tab);
    } else {
      const document = {
        ...response.document,
        content: normalizeMarkdownNewlines(response.document.content),
      };
      tab.doc = document;
      tab.draft = document.content;
      tab.title = document.meta.title;
      tab.path = document.meta.path;
      tab.dirty = false;
      tab.conflict = false;
      tab.conflictDraftId = null;
    }
    this.state.notes.set(response.meta.noteId, response.meta);
    this.state.activeNoteId = toNoteId(response.meta.noteId);
    this.touchRecent(response.meta.noteId);
    logClientEvent("info", "note.apply_mutation", {
      note: { id: response.meta.noteId, path: response.meta.path, vault },
    });
    this.render();
  }

  private logCommand(id: string, noteId?: string, extra: Record<string, unknown> = {}): void {
    logClientEvent("info", "client.command", {
      command: { id, ...extra },
      note: noteId === undefined ? undefined : { id: noteId, vault: this.state.vault },
      vault: this.state.vault,
    });
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

  private dispatch(event: ViewEvent): void {
    switch (event.type) {
      case "vault.switch": {
        this.services.api.setActiveVault(event.index);
        this.runAsync(this.boot(), "Load failed");
        return;
      }
      case "search.input": {
        this.state.searchQuery = event.query;
        this.runAsync(this.updateSearch(), "Search failed");
        return;
      }
      case "search.open": {
        this.state.searchOpen = true;
        this.state.commandOpen = false;
        this.state.searchOverlayQuery = "";
        this.state.searchOverlayHits = null;
        this.render();
        return;
      }
      case "search.overlayInput": {
        this.state.searchOverlayQuery = event.query;
        this.runAsync(this.updateSearchOverlay(), "Search failed");
        return;
      }
      case "command.open": {
        this.state.commandOpen = true;
        this.state.searchOpen = false;
        this.state.commandFilter = "";
        this.render();
        return;
      }
      case "command.filter": {
        this.state.commandFilter = event.query;
        this.render();
        return;
      }
      case "command.run": {
        this.executeCommand(event.id);
        return;
      }
      case "dialog.input": {
        if (this.state.noteDialog?.kind === "create" || this.state.noteDialog?.kind === "rename") {
          this.state.noteDialog.title = event.value;
        } else if (this.state.noteDialog?.kind === "tag") {
          this.state.noteDialog.value = event.value;
        }
        return;
      }
      case "dialog.submit": {
        this.runAsync(this.submitNoteDialog(event.value), "Action failed");
        return;
      }
      case "settings.submit": {
        this.runAsync(this.saveSettingsFromModal(event.settings), "Settings failed");
        return;
      }
      case "overlay.close": {
        this.closeOverlays();
        return;
      }
      case "context.close": {
        this.closeContextMenu();
        return;
      }
      case "context.open": {
        this.openNoteContextMenu(event.noteId, event.x, event.y);
        return;
      }
      case "tab.activate": {
        this.runAsync(this.activateTab(event.noteId), "Open failed");
        return;
      }
      case "tab.close": {
        this.closeTab(event.noteId);
        return;
      }
      case "note.open": {
        this.runAsync(this.openInTab(event.noteId), "Open failed");
        return;
      }
      case "note.rename": {
        this.commandRename(event.noteId);
        return;
      }
      case "note.delete": {
        this.commandDelete(event.noteId);
        return;
      }
      case "note.pin": {
        this.runAsync(this.commandPin(event.noteId), "Pin failed");
        return;
      }
      case "note.addTag": {
        this.runAsync(this.commandAddTag(), "Tag failed");
        return;
      }
      case "tags.update": {
        this.updateActiveTags(event.tags);
        return;
      }
      case "reading.toggle": {
        this.toggleReadingMode();
        return;
      }
      case "editor.toolbar": {
        this.dispatchEditorToolbar(event.command);
        return;
      }
      case "revisions.open": {
        this.runAsync(this.commandRevisions(), "Revisions failed");
        return;
      }
      case "revisions.select": {
        this.runAsync(this.selectRevision(event.eventId), "Revision failed");
        return;
      }
      case "revisions.restore": {
        this.runAsync(this.restoreSelectedRevision(), "Restore failed");
        return;
      }
      case "conflict.view": {
        this.runAsync(this.viewActiveConflictDraft(), "Conflict draft failed");
        return;
      }
      case "conflict.restore": {
        this.runAsync(this.restoreActiveConflictDraft(), "Restore failed");
        return;
      }
      case "render.request": {
        this.render();
        return;
      }
    }
  }

  private dispatchEditorToolbar(command: EditorToolbarCommand): void {
    switch (command) {
      case "bold": {
        this.editor?.applyFormat(toggleBold);
        return;
      }
      case "italic": {
        this.editor?.applyFormat(toggleItalic);
        return;
      }
      case "highlight": {
        this.editor?.applyFormat(toggleHighlight);
        return;
      }
      case "strikethrough": {
        this.editor?.applyFormat(toggleStrikethrough);
        return;
      }
      case "heading": {
        this.editor?.applyFormat((md, start) => toggleHeading(md, start, 1));
        return;
      }
      case "undo": {
        this.editor?.undo();
        return;
      }
      case "redo": {
        this.editor?.redo();
        return;
      }
      case "source": {
        this.toggleSourceMode();
        return;
      }
      case "save": {
        this.runAsync(this.manualSave(), "Save failed");
        return;
      }
    }
  }

  private viewActions(): ViewActions {
    return {
      dispatch: (event) => this.dispatch(event),
      commandItems: () => this.filteredCommands(),
    };
  }
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
    .replaceAll(/['"]/g, "")
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-+|-+$/g, "");
  return slug || "untitled";
}

export function startApp(root: HTMLElement): void {
  const app = new TansuApp(root);
  app.bindGlobalEvents();
  void app.boot().catch((error: unknown) => {
    logClientEvent("error", "client.error", {
      error: errorSummary(error),
      message: "Load failed",
    });
    root.replaceChildren(renderLoading());
  });
}

function errorSummary(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }
  return { message: String(error) };
}
