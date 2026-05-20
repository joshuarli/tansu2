import { bootstrap, openNote, searchNotes, setActiveVault } from "./api.ts";
import type { BootstrapResponse, NoteDocument, NoteMeta } from "./types.generated.ts";

type State = {
  bootstrap: BootstrapResponse | null;
  activeNote: NoteDocument | null;
  notes: Map<string, NoteMeta>;
  searchQuery: string;
};

const state: State = {
  bootstrap: null,
  activeNote: null,
  notes: new Map(),
  searchQuery: "",
};

const appRoot = document.querySelector<HTMLElement>("#app");
if (appRoot === null) {
  throw new Error("missing app root");
}
const root: HTMLElement = appRoot;

void start();

async function start(): Promise<void> {
  state.bootstrap = await bootstrap();
  state.notes = new Map(state.bootstrap.notes.map((note) => [note.noteId, note]));
  render();
}

function render(): void {
  if (state.bootstrap === null) {
    root.innerHTML = `<section class="editor-pane empty">Loading</section>`;
    return;
  }
  const notes = [...state.notes.values()];
  root.replaceChildren(sidebar(state.bootstrap, notes), content());
}

function sidebar(data: BootstrapResponse, notes: NoteMeta[]): HTMLElement {
  const element = document.createElement("aside");
  element.className = "sidebar";
  const vaults = document.createElement("div");
  for (const vault of data.vaults) {
    const button = document.createElement("button");
    button.className = "vault-row";
    button.type = "button";
    button.textContent = vault.name;
    button.addEventListener("click", () => {
      setActiveVault(vault.index);
      state.activeNote = null;
      void start();
    });
    vaults.append(button);
  }
  const search = document.createElement("input");
  search.className = "search-input";
  search.type = "search";
  search.placeholder = "Search";
  search.value = state.searchQuery;
  search.addEventListener("input", () => {
    state.searchQuery = search.value;
    void updateSearch(search.value);
  });
  const list = document.createElement("div");
  for (const note of notes) {
    const button = document.createElement("button");
    button.className = "note-row";
    button.type = "button";
    button.textContent = note.title;
    button.addEventListener("click", () => {
      void selectNote(note.noteId);
    });
    list.append(button);
  }
  element.append(vaults, search, list);
  return element;
}

function content(): HTMLElement {
  const element = document.createElement("section");
  element.className = "content";
  const topbar = document.createElement("div");
  topbar.className = "topbar";
  topbar.textContent = state.activeNote?.meta.path ?? "No note selected";
  const pane = document.createElement("div");
  pane.className = "editor-pane";
  if (state.activeNote === null) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "Select a note";
    pane.append(empty);
  } else {
    const title = document.createElement("h1");
    title.className = "note-title";
    title.textContent = state.activeNote.meta.title;
    const textarea = document.createElement("textarea");
    textarea.className = "note-body";
    textarea.value = state.activeNote.content;
    pane.append(title, textarea);
  }
  element.append(topbar, pane);
  return element;
}

async function selectNote(noteId: string): Promise<void> {
  state.activeNote = await openNote(noteId);
  render();
}

async function updateSearch(query: string): Promise<void> {
  if (query.trim() === "" || state.bootstrap === null) {
    state.notes =
      state.bootstrap === null
        ? new Map()
        : new Map(state.bootstrap.notes.map((note) => [note.noteId, note]));
    render();
    return;
  }
  const hits = await searchNotes(query);
  state.notes = new Map(hits.map((hit) => [hit.note.noteId, hit.note]));
  render();
}
