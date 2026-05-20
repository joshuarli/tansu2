import {
  activeTab,
  createState,
  sessionFromState,
  tabById,
  tabFromDocument,
  tabFromMeta,
} from "./state.ts";
import type { NoteDocument, NoteMeta } from "./types.generated.ts";

describe("state helpers", () => {
  it("creates isolated state containers for vaults", () => {
    const first = createState(1);
    const second = createState(2);

    first.notes.set("n1", note("n1", "one.md", "One"));
    first.pinned.add("n1");

    expect(first.vault).toBe(1);
    expect(second.vault).toBe(2);
    expect(second.notes.size).toBe(0);
    expect(second.pinned.size).toBe(0);
  });

  it("finds active and arbitrary tabs by note id", () => {
    const state = createState(0);
    state.tabs = [tabFromMeta(note("a", "a.md", "A")), tabFromMeta(note("b", "b.md", "B"))];
    state.activeNoteId = "b";

    expect(activeTab(state)?.path).toBe("b.md");
    expect(tabById(state, "a")?.title).toBe("A");
    expect(tabById(state, "missing")).toBeUndefined();
  });

  it("converts note documents and current tabs to a persisted session", () => {
    const state = createState(0);
    const document: NoteDocument = {
      meta: note("n1", "one.md", "One"),
      content: "# One\n",
    };
    const tab = tabFromDocument(document);
    tab.cursorOffset = 5;
    tab.sourceMode = true;
    state.tabs = [tab];
    state.activeNoteId = "n1";
    state.closedTabs = [
      { noteId: "old", title: "Old", path: "old.md", cursorOffset: null, sourceMode: false },
    ];

    expect(tab.doc).toBe(document);
    expect(tab.draft).toBe("# One\n");
    expect(sessionFromState(state)).toEqual({
      openTabs: [{ noteId: "n1", title: "One", path: "one.md", cursorOffset: 5, sourceMode: true }],
      activeNoteId: "n1",
      closedTabs: state.closedTabs,
    });
  });
});

function note(noteId: string, path: string, title: string): NoteMeta {
  return {
    noteId,
    path,
    title,
    tags: [],
    seq: 1,
    contentHash: "hash",
    updatedAtMs: 1,
  };
}
