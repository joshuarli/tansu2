import {
  normalizeMarkdownNewlines,
  offsetsToSelection,
  selectionToOffsets as modelSelectionToOffsets,
  type EditorState,
} from "./editor-model.js";
import type { SelectionOffsets } from "./editor-selection.js";

export type BlockSelectionControllerOptions = {
  contentEl: HTMLElement;
  getState(): EditorState;
  setState(state: EditorState): void;
  currentMarkdown(): string;
  renderSelectionAndModel(markdown: string, selectionStart: number, selectionEnd: number): void;
  renderCurrentModel(): void;
  pushUndo(markdown: string, selectionStart: number, selectionEnd: number): void;
  onChange(): void;
};

export function createBlockSelectionController(options: BlockSelectionControllerOptions): {
  renderBlockSelectionClasses(): void;
  selectBlock(blockId: string, extend: boolean): void;
  selectedBlockOffsets(): SelectionOffsets | null;
  replaceBlockSelection(text: string): boolean;
  copyBlockSelection(e: ClipboardEvent): boolean;
  collapseBlockSelectionToStart(): boolean;
} {
  function renderBlockSelectionClasses(): void {
    const state = options.getState();
    for (const el of options.contentEl.querySelectorAll("[data-md-block-id]")) {
      el.classList.remove("md-block-selected");
      el.removeAttribute("aria-selected");
    }
    if (state.selection.kind !== "block") return;
    const anchor = state.doc.blocks.byId.get(state.selection.anchorBlockId);
    const focus = state.doc.blocks.byId.get(state.selection.focusBlockId);
    if (!anchor || !focus) return;
    const startLine = Math.min(anchor.startLine, focus.startLine);
    const endLine = Math.max(anchor.startLine, focus.startLine);
    for (const block of state.doc.blocks.blocks) {
      if (block.startLine < startLine || block.startLine > endLine) {
        continue;
      }
      for (const el of options.contentEl.querySelectorAll(`[data-md-block-id="${block.id}"]`)) {
        el.classList.add("md-block-selected");
        el.setAttribute("aria-selected", "true");
      }
    }
  }

  function selectBlock(blockId: string, extend: boolean): void {
    const state = options.getState();
    const anchor =
      extend && state.selection.kind === "block" ? state.selection.anchorBlockId : blockId;
    options.setState({
      ...state,
      selection: {
        kind: "block",
        anchorBlockId: anchor,
        focusBlockId: blockId,
      },
    });
    window.getSelection()?.removeAllRanges();
    renderBlockSelectionClasses();
  }

  function selectedBlockOffsets(): SelectionOffsets | null {
    const state = options.getState();
    return state.selection.kind === "block"
      ? modelSelectionToOffsets(state.doc, state.selection)
      : null;
  }

  function replaceBlockSelection(text: string): boolean {
    const offsets = selectedBlockOffsets();
    if (!offsets) return false;
    const md = options.currentMarkdown();
    const normalized = normalizeMarkdownNewlines(text);
    options.pushUndo(md, offsets.start, offsets.end);
    const nextMd = md.slice(0, offsets.start) + normalized + md.slice(offsets.end);
    const cursor = offsets.start + normalized.length;
    options.renderSelectionAndModel(nextMd, cursor, cursor);
    options.onChange();
    return true;
  }

  function copyBlockSelection(e: ClipboardEvent): boolean {
    const offsets = selectedBlockOffsets();
    if (!offsets || !e.clipboardData) return false;
    const md = options.currentMarkdown();
    e.preventDefault();
    e.clipboardData.setData("text/plain", md.slice(offsets.start, offsets.end));
    return true;
  }

  function collapseBlockSelectionToStart(): boolean {
    const state = options.getState();
    if (state.selection.kind !== "block") {
      return false;
    }
    const block = state.doc.blocks.byId.get(state.selection.anchorBlockId);
    const offset = block ? state.doc.lineStarts[block.startLine]! : 0;
    options.setState({
      ...state,
      selection: offsetsToSelection(state.doc, offset, offset),
    });
    options.renderCurrentModel();
    options.contentEl.focus();
    return true;
  }

  return {
    renderBlockSelectionClasses,
    selectBlock,
    selectedBlockOffsets,
    replaceBlockSelection,
    copyBlockSelection,
    collapseBlockSelectionToStart,
  };
}
