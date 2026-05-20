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

export type Tab = {
  noteId: string;
  title: string;
  path: string;
  doc: NoteDocument | null;
  draft: string | null;
  dirty: boolean;
  saving: boolean;
  conflict: boolean;
  conflictDraftId: number | null;
  cursorOffset: number | null;
  sourceMode: boolean;
};

export type Command = {
  id: string;
  label: string;
  run: () => void | Promise<void>;
};

export type NoteDialog =
  | { kind: "create"; title: string }
  | { kind: "rename"; noteId: string; title: string }
  | { kind: "tag"; value: string }
  | { kind: "delete"; noteId: string };

export type ContextMenuState = {
  noteId: string;
  x: number;
  y: number;
};

export type State = {
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
  revisionsOpen: boolean;
  revisionList: RevisionMeta[] | null;
  revisionDocument: RevisionDocument | null;
  conflictDraft: ConflictDraftDocument | null;
  settingsOpen: boolean;
  noteDialog: NoteDialog | null;
  contextMenu: ContextMenuState | null;
  notice: string | null;
};

export function createState(vault: number): State {
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
    conflict: false,
    conflictDraftId: null,
    cursorOffset: null,
    sourceMode: false,
  };
}

export function tabFromDocument(document: NoteDocument): Tab {
  return {
    noteId: document.meta.noteId,
    title: document.meta.title,
    path: document.meta.path,
    doc: document,
    draft: document.content,
    dirty: false,
    saving: false,
    conflict: false,
    conflictDraftId: null,
    cursorOffset: null,
    sourceMode: false,
  };
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
