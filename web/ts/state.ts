import type {
  BootstrapResponse,
  ConflictDraftDocument,
  NoteDocument,
  NoteMeta,
  RevisionDocument,
  RevisionMeta,
  SearchHit,
  SessionState,
  SessionTab,
} from "./types.generated.ts";

declare const appBrand: unique symbol;

type AppBrand<T, Name extends string> = T & { readonly [appBrand]?: Name };
export type NoteId = AppBrand<string, "NoteId">;
export type VaultIndex = AppBrand<number, "VaultIndex">;
export type ContentHash = AppBrand<string, "ContentHash">;
export type RevisionEventId = AppBrand<number, "RevisionEventId">;
export type ConflictDraftId = AppBrand<number, "ConflictDraftId">;
export type AssetName = AppBrand<string, "AssetName">;

export type Tab = {
  noteId: NoteId;
  title: string;
  path: string;
  doc: NoteDocument | null;
  draft: string | null;
  dirty: boolean;
  saving: boolean;
  savePending: boolean;
  conflict: boolean;
  conflictDraftId: ConflictDraftId | null;
  cursorOffset: number | null;
  sourceMode: boolean;
};

type NoteDialog =
  | { kind: "create"; title: string }
  | { kind: "rename"; noteId: string; title: string }
  | { kind: "tag"; value: string }
  | { kind: "delete"; noteId: string };

type ContextMenuState = {
  noteId: string;
  x: number;
  y: number;
};

export type State = {
  boot: BootstrapResponse | null;
  vault: VaultIndex;
  notes: Map<string, NoteMeta>;
  pinned: Set<string>;
  recent: string[];
  tabs: Tab[];
  closedTabs: SessionTab[];
  activeNoteId: NoteId | null;
  searchQuery: string;
  searchHits: SearchHit[] | null;
  searchOpen: boolean;
  searchOverlayQuery: string;
  searchOverlayHits: SearchHit[] | null;
  commandOpen: boolean;
  commandFilter: string;
  revisionsOpen: boolean;
  revisionList: RevisionMeta[] | null;
  revisionDocument: RevisionDocument | null;
  conflictDraft: ConflictDraftDocument | null;
  settingsOpen: boolean;
  noteDialog: NoteDialog | null;
  contextMenu: ContextMenuState | null;
  notice: string | null;
  readingMode: boolean;
};

export function createState(vault: VaultIndex): State {
  return {
    boot: null,
    vault,
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
    revisionsOpen: false,
    revisionList: null,
    revisionDocument: null,
    conflictDraft: null,
    settingsOpen: false,
    noteDialog: null,
    contextMenu: null,
    notice: null,
    readingMode: false,
  };
}

export function activeTab(state: State): Tab | undefined {
  return state.tabs.find((tab) => tab.noteId === state.activeNoteId);
}

export function tabById(state: State, noteId: string): Tab | undefined {
  return state.tabs.find((tab) => tab.noteId === noteId);
}

export function tabFromMeta(note: NoteMeta): Tab {
  return {
    noteId: note.noteId,
    title: note.title,
    path: note.path,
    doc: null,
    draft: null,
    dirty: false,
    saving: false,
    savePending: false,
    conflict: false,
    conflictDraftId: null,
    cursorOffset: null,
    sourceMode: false,
  };
}

export function tabFromDocument(document: NoteDocument): Tab {
  const content = normalizeMarkdownNewlines(document.content);
  const doc = content === document.content ? document : { ...document, content };
  return {
    noteId: doc.meta.noteId,
    title: doc.meta.title,
    path: doc.meta.path,
    doc,
    draft: doc.content,
    dirty: false,
    saving: false,
    savePending: false,
    conflict: false,
    conflictDraftId: null,
    cursorOffset: null,
    sourceMode: false,
  };
}

export function loadedDocument(tab: Tab): NoteDocument | null {
  return tab.doc;
}

export function loadedDraft(tab: Tab): string | null {
  return tab.doc === null ? null : (tab.draft ?? tab.doc.content);
}

export function tabIsDirty(tab: Tab): boolean {
  return tab.dirty;
}

export function normalizeMarkdownNewlines(markdown: string): string {
  return markdown.replaceAll(/\r\n?/g, "\n");
}

export function sessionFromState(state: State): SessionState {
  return {
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
}
