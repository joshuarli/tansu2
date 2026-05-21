import { clampNodeOffset } from "./util.js";

export type SelectionOffsets = {
  start: number;
  end: number;
};

type EditorSelectionController = {
  placeCursorAtEnd(): void;
};

export function createEditorSelectionController(contentEl: HTMLElement): EditorSelectionController {
  function placeCursorAtEnd(): void {
    const sel = window.getSelection();
    if (!sel) return;
    const range = document.createRange();
    range.selectNodeContents(contentEl);
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
  }

  return {
    placeCursorAtEnd,
  };
}

export function isRangeAtStartOfBlock(range: Range, block: HTMLElement): boolean {
  const before = range.cloneRange();
  before.selectNodeContents(block);
  before.setEnd(range.startContainer, clampNodeOffset(range.startContainer, range.startOffset));
  return before.toString().replaceAll("​", "") === "";
}
