import type { State } from "../state.ts";
import type { CommandItem } from "./events.ts";

export function commandItems(state: State): CommandItem[] {
  const items: CommandItem[] = [
    { id: "open", label: "Open note" },
    { id: "create", label: "Create note" },
    { id: "save", label: "Save note" },
    { id: "rename", label: "Rename note" },
    { id: "delete", label: "Delete note" },
    {
      id: "pin",
      label:
        state.activeNoteId !== null && state.pinned.has(state.activeNoteId)
          ? "Unpin note"
          : "Pin note",
    },
    { id: "reopen", label: "Reopen closed tab" },
    { id: "reading", label: state.readingMode ? "Edit mode" : "Reading mode" },
    { id: "search", label: "Search notes" },
    { id: "import", label: "Import HTML" },
    { id: "revisions", label: "Revisions" },
    { id: "settings", label: "Settings" },
    { id: "source", label: "Source mode" },
  ];
  const query = state.commandFilter.toLowerCase();
  return items.filter((item) => `${item.id} ${item.label}`.toLowerCase().includes(query));
}
