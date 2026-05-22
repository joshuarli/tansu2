import type { EditorState, LogicalPosition } from "./editor-model.js";

export const BLANK_LINE_SELECTOR = '[data-md-blank="true"]';

const INDENTABLE_BLOCKS = new Set([
  "P",
  "DIV",
  "LI",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "TD",
  "TH",
  "CODE",
]);

const STRUCTURAL_PASTE_BOUNDARY_TAGS = new Set([
  "BLOCKQUOTE",
  "DIV",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "LI",
  "P",
]);

export function sourceBoundary(el: HTMLElement, key: string): number | null {
  const value = el.dataset[key];
  if (value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function childOffset(node: Node): number {
  let offset = 0;
  let current = node.previousSibling;
  while (current) {
    offset++;
    current = current.previousSibling;
  }
  return offset;
}

export function hostDirectHandle(host: HTMLElement): HTMLElement | null {
  const handle = host.querySelector(":scope > .md-block-handle");
  return handle instanceof HTMLElement ? handle : null;
}

export function hostTextWithoutControls(host: HTMLElement): string {
  const clone = host.cloneNode(true) as HTMLElement;
  for (const control of clone.querySelectorAll("button,input")) {
    control.remove();
  }
  return (clone.textContent ?? "").replaceAll("​", "");
}

export function domPointFromVisualOffset(
  root: HTMLElement,
  visualOffset: number,
): {
  node: Node;
  offset: number;
} {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (parent?.closest("button,input")) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  let remaining = Math.max(0, visualOffset);
  let current = walker.nextNode();
  while (current) {
    const text = (current.textContent ?? "").replaceAll("​", "");
    if (remaining <= text.length) {
      return { node: current, offset: remaining };
    }
    remaining -= text.length;
    current = walker.nextNode();
  }
  const handle = hostDirectHandle(root);
  return { node: root, offset: handle ? childOffset(handle) : root.childNodes.length };
}

function sourceColumnFromDom(host: HTMLElement, node: Node | null, offset: number): number | null {
  if (node === null) return null;
  if (node.nodeType === Node.TEXT_NODE) {
    const parent = node.parentElement;
    const sourceElement = parent?.closest("[data-md-content-start]");
    if (sourceElement instanceof HTMLElement && host.contains(sourceElement)) {
      const contentStart = Number(sourceElement.dataset["mdContentStart"]);
      if (!Number.isFinite(contentStart)) return null;
      const range = document.createRange();
      range.selectNodeContents(sourceElement);
      try {
        range.setEnd(node, offset);
      } catch {
        return null;
      }
      if (sourceElement.dataset["mdAtomicSource"] === "true") {
        const contentEnd = sourceBoundary(sourceElement, "mdContentEnd");
        return range.toString().replaceAll("​", "").length === 0 || contentEnd === null
          ? contentStart
          : contentEnd;
      }
      return contentStart + range.toString().replaceAll("​", "").length;
    }
    return null;
  }
  if (!(node instanceof HTMLElement)) return null;

  const children = [...node.childNodes];
  const before = children[offset - 1];
  if (before instanceof HTMLElement) {
    const end = sourceBoundary(before, "mdSourceEnd");
    if (end !== null) return end;
  }
  const after = children[offset];
  if (after instanceof HTMLElement) {
    const start = sourceBoundary(after, "mdSourceStart");
    if (start !== null) return start;
  }
  if (node !== host) {
    const sourceElement = node.closest("[data-md-content-start]");
    if (sourceElement instanceof HTMLElement && host.contains(sourceElement)) {
      const contentStart = sourceBoundary(sourceElement, "mdContentStart");
      const contentEnd = sourceBoundary(sourceElement, "mdContentEnd");
      if (offset === 0 && contentStart !== null) return contentStart;
      if (offset >= node.childNodes.length && contentEnd !== null) return contentEnd;
    }
  }
  return null;
}

export function createEditorDomHelpers(contentEl: HTMLElement): {
  lineHostForNode(node: Node | null): HTMLElement | null;
  logicalPositionFromDom(
    state: EditorState,
    node: Node | null,
    offset: number,
  ): LogicalPosition | null;
  getBlockHandle(target: EventTarget | null): HTMLElement | null;
  getNextElementSibling(node: Node): HTMLElement | null;
  getPrevElementSibling(node: Node): HTMLElement | null;
  placeCursorAtBlockStart(block: HTMLElement): void;
  placeCursorAtBlockEnd(block: HTMLElement): void;
  ensureEmptyParagraphPlaceholder(block: HTMLElement): void;
  getBlankLineBlock(node: Node | null): HTMLElement | null;
  isBlankLineElement(el: Element | null): el is HTMLElement;
  isEditableBlankLineElement(el: Element | null): el is HTMLElement;
  isVisibleContentBlock(el: Element | null): boolean;
  hideBlankLine(blank: HTMLElement): void;
  showBlankLine(blank: HTMLElement): void;
  showActiveBlankLine(blank: HTMLElement): void;
  isIndentableBlock(el: HTMLElement): boolean;
  getIndentableBlock(node: Node): HTMLElement | null;
  getStructuralPasteBoundaryBlock(node: Node): HTMLElement | null;
  createBlankLineSpacer(): HTMLElement;
  createCursorParagraph(): HTMLElement;
} {
  function lineHostForNode(node: Node | null): HTMLElement | null {
    const el = node instanceof Element ? node : node?.parentElement;
    const host = el?.closest("[data-md-line-index]");
    return host instanceof HTMLElement && contentEl.contains(host) ? host : null;
  }

  function logicalPositionFromDom(
    state: EditorState,
    node: Node | null,
    offset: number,
  ): LogicalPosition | null {
    const host = lineHostForNode(node);
    if (!host) return null;
    const lineIndex = Number(host.dataset["mdLineIndex"]);
    if (!Number.isInteger(lineIndex) || lineIndex < 0 || lineIndex >= state.doc.lines.length) {
      return null;
    }
    const hostTextLength = (host.textContent ?? "").replaceAll("​", "").length;
    const maxColumn = Math.max(hostTextLength, state.doc.lines[lineIndex]!.text.length);
    const sourceColumn = sourceColumnFromDom(host, node, offset);
    if (sourceColumn !== null) {
      return {
        line: lineIndex,
        column: Math.min(sourceColumn, maxColumn),
      };
    }
    const lineContentStart = Number(host.dataset["mdLineContentStart"]);
    const range = document.createRange();
    range.selectNodeContents(host);
    try {
      range.setEnd(node ?? host, offset);
    } catch {
      return null;
    }
    const visualColumn = range.toString().replaceAll("​", "").length;
    const column = Number.isFinite(lineContentStart)
      ? lineContentStart + visualColumn
      : visualColumn;
    return {
      line: lineIndex,
      column: Math.min(column, maxColumn),
    };
  }

  function getBlockHandle(target: EventTarget | null): HTMLElement | null {
    const node = target instanceof Element ? target : null;
    const handle = node?.closest("[data-md-block-handle]");
    return handle instanceof HTMLElement && contentEl.contains(handle) ? handle : null;
  }

  function getNextElementSibling(node: Node): HTMLElement | null {
    let cur = node.nextSibling;
    while (cur) {
      if (cur instanceof HTMLElement) return cur;
      cur = cur.nextSibling;
    }
    return null;
  }

  function getPrevElementSibling(node: Node): HTMLElement | null {
    let cur = node.previousSibling;
    while (cur) {
      if (cur instanceof HTMLElement) return cur;
      cur = cur.previousSibling;
    }
    return null;
  }

  function placeCursorAtBlockStart(block: HTMLElement): void {
    const sel = window.getSelection();
    if (!sel) return;
    const point = domPointFromVisualOffset(block, 0);
    const range = document.createRange();
    range.setStart(point.node, point.offset);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
  }

  function placeCursorAtBlockEnd(block: HTMLElement): void {
    const sel = window.getSelection();
    if (!sel) return;
    const point = domPointFromVisualOffset(block, hostTextWithoutControls(block).length);
    const range = document.createRange();
    range.setStart(point.node, point.offset);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
  }

  function ensureEmptyParagraphPlaceholder(block: HTMLElement): void {
    if (block.dataset["mdBlank"] === "true") {
      return;
    }
    const handle = hostDirectHandle(block);
    const hasEditableContent = Array.from(block.childNodes).some((child) => {
      if (child === handle) return false;
      if (child.nodeName === "BR") return true;
      return (child.textContent ?? "").replaceAll("​", "") !== "";
    });
    if (!hasEditableContent) {
      block.insertBefore(document.createElement("br"), handle);
    }
  }

  function getBlankLineBlock(node: Node | null): HTMLElement | null {
    if (!node) return null;
    const el = node instanceof Element ? node : node.parentElement;
    const blank = el?.closest(BLANK_LINE_SELECTOR);
    return blank instanceof HTMLElement && contentEl.contains(blank) ? blank : null;
  }

  function isBlankLineElement(el: Element | null): el is HTMLElement {
    return el instanceof HTMLElement && el.dataset["mdBlank"] === "true";
  }

  function isEditableBlankLineElement(el: Element | null): el is HTMLElement {
    return isBlankLineElement(el) && el.dataset["mdBlankRole"] !== "separator";
  }

  function isVisibleContentBlock(el: Element | null): boolean {
    return el instanceof HTMLElement && el.dataset["mdBlank"] !== "true";
  }

  function hideBlankLine(blank: HTMLElement): void {
    blank.hidden = true;
    blank.setAttribute("contenteditable", "false");
  }

  function showBlankLine(blank: HTMLElement): void {
    blank.hidden = false;
    blank.setAttribute("contenteditable", "false");
    if (!blank.querySelector("br") && (blank.textContent ?? "") === "") {
      blank.prepend(document.createElement("br"));
    }
  }

  function showActiveBlankLine(blank: HTMLElement): void {
    if (!isEditableBlankLineElement(blank)) {
      showBlankLine(blank);
      return;
    }
    const hasAdjacentBlank =
      isBlankLineElement(blank.previousElementSibling) ||
      isBlankLineElement(blank.nextElementSibling);
    if (!hasAdjacentBlank) {
      delete blank.dataset["mdBlank"];
    }
    blank.hidden = false;
    blank.setAttribute("contenteditable", "true");
    if (!blank.querySelector("br") && (blank.textContent ?? "") === "") {
      blank.prepend(document.createElement("br"));
    }
  }

  function isIndentableBlock(el: HTMLElement): boolean {
    if (el === contentEl) return false;
    if (!INDENTABLE_BLOCKS.has(el.tagName)) return false;
    return el.tagName !== "CODE" || el.parentElement?.tagName === "PRE";
  }

  function getIndentableBlock(node: Node): HTMLElement | null {
    let cur: Node | null = node;
    while (cur && cur !== contentEl) {
      if (cur instanceof HTMLElement && isIndentableBlock(cur)) return cur;
      cur = cur.parentNode;
    }
    return null;
  }

  function getStructuralPasteBoundaryBlock(node: Node): HTMLElement | null {
    let cur: Node | null = node;
    while (cur && cur !== contentEl) {
      if (cur instanceof HTMLElement && STRUCTURAL_PASTE_BOUNDARY_TAGS.has(cur.tagName)) {
        return cur;
      }
      cur = cur.parentNode;
    }
    return null;
  }

  function createBlankLineSpacer(): HTMLElement {
    const blank = document.createElement("p");
    blank.dataset["mdBlank"] = "true";
    blank.dataset["mdBlankRole"] = "editable";
    showBlankLine(blank);
    return blank;
  }

  function createCursorParagraph(): HTMLElement {
    const paragraph = document.createElement("p");
    paragraph.append(document.createElement("br"));
    return paragraph;
  }

  return {
    lineHostForNode,
    logicalPositionFromDom,
    getBlockHandle,
    getNextElementSibling,
    getPrevElementSibling,
    placeCursorAtBlockStart,
    placeCursorAtBlockEnd,
    ensureEmptyParagraphPlaceholder,
    getBlankLineBlock,
    isBlankLineElement,
    isEditableBlankLineElement,
    isVisibleContentBlock,
    hideBlankLine,
    showBlankLine,
    showActiveBlankLine,
    isIndentableBlock,
    getIndentableBlock,
    getStructuralPasteBoundaryBlock,
    createBlankLineSpacer,
    createCursorParagraph,
  };
}
