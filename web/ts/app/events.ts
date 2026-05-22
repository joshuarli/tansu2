import type { NoteId, RevisionEventId, VaultIndex } from "../state.ts";

export type CommandId =
  | "open"
  | "create"
  | "save"
  | "rename"
  | "delete"
  | "pin"
  | "reopen"
  | "reading"
  | "search"
  | "import"
  | "revisions"
  | "settings"
  | "source";

export type CommandItem = {
  id: CommandId;
  label: string;
};

export type EditorToolbarCommand =
  | "bold"
  | "italic"
  | "highlight"
  | "strikethrough"
  | "heading"
  | "undo"
  | "redo"
  | "source"
  | "save";

type SettingsFormValue = {
  excludedFoldersText: string;
  autosaveDelayMs: number;
  undoStackMax: number;
  imageWebpQuality: number;
};

export type ViewEvent =
  | { type: "vault.switch"; index: VaultIndex }
  | { type: "search.input"; query: string }
  | { type: "search.open" }
  | { type: "search.overlayInput"; query: string }
  | { type: "command.open" }
  | { type: "command.filter"; query: string }
  | { type: "command.run"; id: CommandId }
  | { type: "dialog.input"; value: string }
  | { type: "dialog.submit"; value?: string }
  | { type: "settings.submit"; settings: SettingsFormValue }
  | { type: "overlay.close" }
  | { type: "context.close" }
  | { type: "context.open"; noteId: NoteId; x: number; y: number }
  | { type: "tab.activate"; noteId: NoteId }
  | { type: "tab.close"; noteId: NoteId }
  | { type: "note.open"; noteId: NoteId }
  | { type: "note.rename"; noteId?: NoteId }
  | { type: "note.delete"; noteId?: NoteId }
  | { type: "note.pin"; noteId?: NoteId }
  | { type: "note.addTag" }
  | { type: "tags.update"; tags: string[] }
  | { type: "reading.toggle" }
  | { type: "editor.toolbar"; command: EditorToolbarCommand }
  | { type: "revisions.open" }
  | { type: "revisions.select"; eventId: RevisionEventId }
  | { type: "revisions.restore" }
  | { type: "conflict.view" }
  | { type: "conflict.restore" }
  | { type: "render.request" };
