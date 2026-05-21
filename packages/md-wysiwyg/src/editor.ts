/// WYSIWYG editor wiring layer. Creates DOM, manages undo stack, routes keyboard
/// events, and handles image paste. All markdown-specific behavior is delegated to
/// the render/serialize/transform modules; callers configure extensions and callbacks.

import { LIST_INDENT_SPACES } from "./constants.js";
import {
  createTextSelection,
  deleteBackward as modelDeleteBackward,
  deleteEmptyListItemBackward as modelDeleteEmptyListItemBackward,
  deleteForward as modelDeleteForward,
  docToMarkdown,
  insertListParagraph as modelInsertListParagraph,
  insertParagraph as modelInsertParagraph,
  markdownToDoc,
  normalizeMarkdownNewlines,
  offsetsToSelection,
  replaceLineText,
  replaceSelection as modelReplaceSelection,
  selectionToOffsets as modelSelectionToOffsets,
  type EditorState,
  type LogicalPosition,
  type TransactionResult,
} from "./editor-model.js";
import { normalizeEditableContent } from "./editor-normalize.js";
import { annotateEditorDom, createEditorRenderer } from "./editor-renderer.js";
import {
  createEditorSelectionController,
  isRangeAtStartOfBlock,
  type SelectionOffsets,
} from "./editor-selection.js";
import { createSelectionTransactionController } from "./editor-transactions.js";
import { createEditorUndoController } from "./editor-undo.js";
import type { MarkdownExtension } from "./extension.js";
import {
  shiftIndent,
  toggleBold,
  toggleHighlight,
  toggleItalic,
  type FormatResult,
} from "./format-ops.js";
import { checkInlineTransform } from "./inline-transforms.js";
import { domToMarkdown } from "./serialize.js";
import { checkBlockInputTransform, handleBlockTransform } from "./transforms.js";

const DISALLOWED_PASTE_TAGS = new Set([
  "BASE",
  "EMBED",
  "FRAME",
  "IFRAME",
  "LINK",
  "META",
  "OBJECT",
  "SCRIPT",
  "STYLE",
  "TEMPLATE",
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
const IMAGE_RESIZE_EDGE_PX = 14;
const IMAGE_RESIZE_MIN_WIDTH = 48;
const IMAGE_RESIZE_MAX_WIDTH = 2400;
const BLANK_LINE_SELECTOR = '[data-md-blank="true"]';

type ImageResizeDrag = {
  image: HTMLImageElement;
  startX: number;
  startWidth: number;
  changed: boolean;
};

function hasDataTransferType(dataTransfer: DataTransfer, type: string): boolean {
  return [...dataTransfer.types].includes(type);
}

function isSafePastedUrl(url: string): boolean {
  const trimmed = url.trim();
  if (trimmed === "") {
    return true;
  }
  const lower = trimmed.toLowerCase();
  return (
    lower.startsWith("#") ||
    lower.startsWith("/") ||
    lower.startsWith("./") ||
    lower.startsWith("../") ||
    lower.startsWith("http:") ||
    lower.startsWith("https:") ||
    lower.startsWith("mailto:") ||
    lower.startsWith("tel:") ||
    lower.startsWith("data:image/")
  );
}

function sanitizePastedTree(root: ParentNode): void {
  const toRemove: Element[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
  let current = walker.nextNode();
  while (current) {
    const el = current as Element;
    if (DISALLOWED_PASTE_TAGS.has(el.tagName)) {
      toRemove.push(el);
      current = walker.nextNode();
      continue;
    }
    for (const attr of el.attributes) {
      const name = attr.name.toLowerCase();
      if (name.startsWith("on")) {
        el.removeAttribute(attr.name);
        continue;
      }
      if (
        (name === "href" || name === "src" || name === "xlink:href") &&
        !isSafePastedUrl(attr.value)
      ) {
        el.removeAttribute(attr.name);
      }
    }
    current = walker.nextNode();
  }
  for (const el of toRemove) {
    el.remove();
  }
}

function htmlToSanitizedContainer(html: string): HTMLElement {
  const container = document.createElement("div");
  const sanitizerContainer = container as HTMLDivElement & {
    setHTML?: (input: string, options?: { sanitizer?: unknown }) => void;
  };
  if (typeof sanitizerContainer.setHTML === "function") {
    sanitizerContainer.setHTML(html);
    return container;
  }
  const doc = new DOMParser().parseFromString(html, "text/html");
  sanitizePastedTree(doc.body);
  for (const child of doc.body.childNodes) {
    container.append(child.cloneNode(true));
  }
  return container;
}

function findLineStart(md: string, offset: number): number {
  const lineStartIdx = md.lastIndexOf("\n", offset - 1);
  return lineStartIdx === -1 ? 0 : lineStartIdx + 1;
}

export type EditorConfig = {
  extensions?: MarkdownExtension[];
  onImagePaste?: (blob: Blob) => Promise<string | null>;
  onChange?: () => void;
  onSave?: () => void;
  contentClassName?: string;
  sourceClassName?: string;
  undoStackMax?: number;
  typingCheckpointMs?: number;
  imageWebpQuality?: number;
  indentUnit?: string;
};

export type EditorHandle = {
  getValue(): string;
  getSnapshot(): EditorSnapshot;
  setValue(md: string, cursorOffset?: number): void;
  getSelectionOffsets(): { start: number; end: number } | null;
  getCursorOffset(): number;
  applyFormat(op: (md: string, s: number, e: number) => FormatResult): void;
  undo(): void;
  redo(): void;
  toggleSourceMode(): void;
  focus(): void;
  setConfig(partial: Partial<EditorConfig>): void;
  readonly isSourceMode: boolean;
  readonly contentEl: HTMLElement;
  readonly sourceEl: HTMLTextAreaElement;
  destroy(): void;
};

export type EditorSnapshot = {
  markdown: string;
  cursorOffset: number;
  selection: { start: number; end: number } | null;
  revision: number;
  sourceMode: boolean;
};

export function createEditor(container: HTMLElement, config: EditorConfig = {}): EditorHandle {
  let cfg = { ...config };
  const extensions = cfg.extensions ?? [];
  let preferPlainTextPaste = false;

  const contentEl = document.createElement("div");
  contentEl.contentEditable = "true";
  contentEl.className = cfg.contentClassName ?? "md-editor-content";
  const sourceEl = document.createElement("textarea");
  sourceEl.className = cfg.sourceClassName ?? "md-editor-source";
  sourceEl.style.display = "none";
  container.append(contentEl, sourceEl);

  let _isSourceMode = false;
  const renderer = createEditorRenderer(contentEl, extensions);
  const selection = createEditorSelectionController(contentEl, extensions);
  let suppressNextInsertParagraph = false;
  let state: EditorState = (() => {
    const doc = markdownToDoc("");
    return {
      doc,
      selection: createTextSelection(doc, 0),
      revision: 0,
      composing: false,
      sourceMode: false,
    };
  })();

  function currentMarkdown(): string {
    return docToMarkdown(state.doc);
  }

  function setModelMarkdown(
    md: string,
    selectionOffsets?: SelectionOffsets,
    sourceMode = _isSourceMode,
  ): void {
    const doc = markdownToDoc(md);
    state = {
      ...state,
      doc,
      selection:
        selectionOffsets === undefined
          ? createTextSelection(doc, 0)
          : offsetsToSelection(doc, selectionOffsets.start, selectionOffsets.end),
      revision: state.revision + 1,
      sourceMode,
    };
  }

  function setModelSelection(selectionOffsets: SelectionOffsets | null): void {
    if (selectionOffsets === null) return;
    state = {
      ...state,
      selection: offsetsToSelection(state.doc, selectionOffsets.start, selectionOffsets.end),
    };
  }

  function syncModelFromDom(): void {
    if (_isSourceMode) return;
    const md = domToMarkdown(contentEl, { extensions });
    const offsets = selection.getSelectionOffsets();
    if (md !== currentMarkdown()) {
      setModelMarkdown(md, offsets ?? undefined);
    } else {
      setModelSelection(offsets);
    }
  }

  function syncModelFromSource(): void {
    const md = normalizeMarkdownNewlines(sourceEl.value);
    const offsets = { start: sourceEl.selectionStart, end: sourceEl.selectionEnd };
    if (md !== currentMarkdown()) {
      setModelMarkdown(md, offsets, true);
    } else {
      setModelSelection(offsets);
      state = { ...state, sourceMode: true };
    }
  }

  function renderSelectionAndModel(md: string, selStart: number, selEnd: number): void {
    const normalized = normalizeMarkdownNewlines(md);
    setModelMarkdown(normalized, { start: selStart, end: selEnd });
    renderer.renderWithSelection(normalized, selStart, selEnd);
    annotateEditorDom(contentEl, state.doc);
  }

  function commitTransaction(result: TransactionResult, notify = true): boolean {
    if (!result.changed) return false;
    state = result.state;
    const offsets = modelSelectionToOffsets(state.doc, state.selection);
    const md = currentMarkdown();
    renderer.renderWithSelection(md, offsets?.start ?? 0, offsets?.end ?? offsets?.start ?? 0);
    annotateEditorDom(contentEl, state.doc);
    selection.restoreSelectionFromRenderedMarkers();
    updateActiveBlankVisibility();
    if (notify) {
      undoController.scheduleTypingCheckpoint();
      cfg.onChange?.();
    }
    return true;
  }

  function commitStructuralTransaction(result: TransactionResult): boolean {
    if (!result.changed) return false;
    undoController.checkpoint();
    return commitTransaction(result);
  }

  function currentSelectionOffsets(): SelectionOffsets | null {
    if (_isSourceMode) {
      return { start: sourceEl.selectionStart, end: sourceEl.selectionEnd };
    }
    return modelSelectionToOffsets(state.doc, state.selection);
  }

  function getBlockHandle(target: EventTarget | null): HTMLElement | null {
    const node = target instanceof Element ? target : null;
    const handle = node?.closest("[data-md-block-handle]");
    return handle instanceof HTMLElement && contentEl.contains(handle) ? handle : null;
  }

  function renderBlockSelectionClasses(): void {
    for (const el of contentEl.querySelectorAll("[data-md-block-id]")) {
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
      for (const el of contentEl.querySelectorAll(`[data-md-block-id="${block.id}"]`)) {
        el.classList.add("md-block-selected");
        el.setAttribute("aria-selected", "true");
      }
    }
  }

  function selectBlock(blockId: string, extend: boolean): void {
    const anchor =
      extend && state.selection.kind === "block" ? state.selection.anchorBlockId : blockId;
    state = {
      ...state,
      selection: {
        kind: "block",
        anchorBlockId: anchor,
        focusBlockId: blockId,
      },
    };
    window.getSelection()?.removeAllRanges();
    renderBlockSelectionClasses();
  }

  function selectedBlockOffsets(): SelectionOffsets | null {
    return state.selection.kind === "block"
      ? modelSelectionToOffsets(state.doc, state.selection)
      : null;
  }

  function replaceBlockSelection(text: string): boolean {
    const offsets = selectedBlockOffsets();
    if (!offsets) return false;
    const md = currentMarkdown();
    const normalized = normalizeMarkdownNewlines(text);
    undoController.pushUndo(md, offsets.start, offsets.end);
    const nextMd = md.slice(0, offsets.start) + normalized + md.slice(offsets.end);
    const cursor = offsets.start + normalized.length;
    renderSelectionAndModel(nextMd, cursor, cursor);
    selection.restoreSelectionFromRenderedMarkers();
    updateActiveBlankVisibility();
    cfg.onChange?.();
    return true;
  }

  function copyBlockSelection(e: ClipboardEvent): boolean {
    const offsets = selectedBlockOffsets();
    if (!offsets || !e.clipboardData) return false;
    const md = currentMarkdown();
    e.preventDefault();
    e.clipboardData.setData("text/plain", md.slice(offsets.start, offsets.end));
    return true;
  }

  function lineHostForNode(node: Node | null): HTMLElement | null {
    const el = node instanceof Element ? node : node?.parentElement;
    const host = el?.closest("[data-md-line-index]");
    return host instanceof HTMLElement && contentEl.contains(host) ? host : null;
  }

  function logicalPositionFromDom(node: Node | null, offset: number): LogicalPosition | null {
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

  function sourceColumnFromDom(
    host: HTMLElement,
    node: Node | null,
    offset: number,
  ): number | null {
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

  function sourceBoundary(el: HTMLElement, key: string): number | null {
    const value = el.dataset[key];
    if (value === undefined) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function syncSelectionFromDomMetadata(): boolean {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return false;
    const range = sel.getRangeAt(0);
    if (!contentEl.contains(range.startContainer) || !contentEl.contains(range.endContainer)) {
      return false;
    }
    const anchor = logicalPositionFromDom(range.startContainer, range.startOffset);
    const focus = logicalPositionFromDom(range.endContainer, range.endOffset);
    if (!anchor || !focus) return false;
    state = {
      ...state,
      selection: { kind: "text", anchor, focus },
    };
    return true;
  }

  function syncActiveLineFromDom(): boolean {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return false;
    const range = sel.getRangeAt(0);
    const host = lineHostForNode(range.startContainer);
    if (!host || !contentEl.contains(range.startContainer)) return false;
    const block = host.closest("[data-md-block-kind]");
    const blockKind = block instanceof HTMLElement ? block.dataset["mdBlockKind"] : undefined;
    if (blockKind !== "paragraph" && blockKind !== "blank") return false;
    const hasRichInline = [...host.children].some(
      (child) =>
        child instanceof HTMLElement &&
        child.tagName !== "BR" &&
        child.tagName !== "BUTTON" &&
        child.className !== "md-block-handle",
    );
    if (hasRichInline) return false;
    const lineIndex = Number(host.dataset["mdLineIndex"]);
    if (!Number.isInteger(lineIndex)) return false;
    const text = (host.textContent ?? "").replaceAll("​", "");
    const pos = logicalPositionFromDom(range.startContainer, range.startOffset);
    const result = replaceLineText(state, lineIndex, text, pos?.column ?? text.length);
    state = result.state;
    return result.changed || result.renderHint.kind === "none";
  }

  function shouldRenderModelBlockInputTransform(): boolean {
    if (state.selection.kind !== "text") return false;
    const { anchor, focus } = state.selection;
    if (anchor.line !== focus.line || anchor.column !== focus.column) return false;
    const text = state.doc.lines[anchor.line]?.text ?? "";
    return (
      /^#{1,6}[ \u00A0]$/.test(text) ||
      /^[-*][ \u00A0]$/.test(text) ||
      /^\d+\.[ \u00A0]$/.test(text) ||
      /^\[([ xX])\][ \u00A0]$/.test(text) ||
      /^>[ \u00A0]$/.test(text) ||
      /^```[^ \u00A0]*[ \u00A0]$/.test(text)
    );
  }

  function renderModelAfterInputTransform(): boolean {
    if (!shouldRenderModelBlockInputTransform()) return false;
    const offsets = modelSelectionToOffsets(state.doc, state.selection);
    renderer.renderWithSelection(
      currentMarkdown(),
      offsets?.start ?? 0,
      offsets?.end ?? offsets?.start ?? 0,
    );
    annotateEditorDom(contentEl, state.doc);
    selection.restoreSelectionFromRenderedMarkers();
    updateActiveBlankVisibility();
    return true;
  }

  // ── getValue / setValue ─────────────────────────────────────────────────────

  function getValue(): string {
    return _isSourceMode ? normalizeMarkdownNewlines(sourceEl.value) : currentMarkdown();
  }

  function getSnapshot(): EditorSnapshot {
    if (_isSourceMode) {
      syncModelFromSource();
    } else if (state.selection.kind !== "block") {
      syncSelectionFromDomMetadata();
    }
    const offsets = currentSelectionOffsets();
    return {
      markdown: currentMarkdown(),
      cursorOffset: offsets?.start ?? -1,
      selection: offsets,
      revision: state.revision,
      sourceMode: _isSourceMode,
    };
  }

  function getSelectionOffsets(): SelectionOffsets | null {
    if (_isSourceMode) {
      return { start: sourceEl.selectionStart, end: sourceEl.selectionEnd };
    }
    if (state.selection.kind === "block") {
      return modelSelectionToOffsets(state.doc, state.selection);
    }
    if (syncSelectionFromDomMetadata()) {
      return modelSelectionToOffsets(state.doc, state.selection);
    }
    const offsets = selection.getSelectionOffsets();
    setModelSelection(offsets);
    return offsets;
  }

  function getCursorOffset(): number {
    const offsets = getSelectionOffsets();
    return offsets?.start ?? -1;
  }

  function setValue(md: string, cursorOffset?: number): void {
    const normalized = normalizeMarkdownNewlines(md);
    const selectionOffsets =
      cursorOffset === undefined
        ? { start: 0, end: 0 }
        : { start: cursorOffset, end: cursorOffset };
    setModelMarkdown(normalized, selectionOffsets);
    if (_isSourceMode) {
      sourceEl.value = normalized;
    } else if (cursorOffset !== undefined) {
      renderer.renderWithCursor(normalized, cursorOffset);
      annotateEditorDom(contentEl, state.doc);
      selection.restoreCursorMarker();
      const activeBlock = getIndentableBlock(window.getSelection()?.anchorNode ?? contentEl);
      if (activeBlock && isEmptyParagraphBlock(activeBlock)) {
        ensureEmptyParagraphPlaceholder(activeBlock);
        placeCursorAtBlockStart(activeBlock);
      }
      updateActiveBlankVisibility();
      setModelSelection(selection.getSelectionOffsets());
    } else {
      renderer.render(normalized);
      annotateEditorDom(contentEl, state.doc);
    }
    const sel = selection.getSelectionOffsets();
    setModelSelection(sel);
    undoController.pushUndo(normalized, sel?.start ?? 0, sel?.end ?? 0);
  }

  const undoController = createEditorUndoController({
    getValue,
    getSelectionOffsets,
    renderSelection: renderSelectionAndModel,
    restoreSelection: selection.restoreSelectionFromRenderedMarkers,
    getUndoStackMax: () => cfg.undoStackMax ?? 200,
    getTypingCheckpointMs: () => cfg.typingCheckpointMs ?? 1000,
    ...(cfg.onChange ? { onChange: cfg.onChange } : {}),
  });

  const transactions = createSelectionTransactionController({
    getValue,
    getSelectionOffsets,
    pushUndo: undoController.pushUndo,
    checkpoint: undoController.checkpoint,
    renderSelection: renderSelectionAndModel,
    restoreSelection: selection.restoreSelectionFromRenderedMarkers,
    ...(cfg.onChange ? { onChange: cfg.onChange } : {}),
  });
  let imageResizeDrag: ImageResizeDrag | null = null;

  // ── Format ──────────────────────────────────────────────────────────────────

  function applyFormat(op: (md: string, s: number, e: number) => FormatResult): void {
    if (_isSourceMode) return;
    transactions.applySelectionEdit(op);
  }

  // ── Undo / redo ─────────────────────────────────────────────────────────────

  function undo(): void {
    undoController.undo();
  }

  function redo(): void {
    undoController.redo();
  }

  // ── List-editing helpers ────────────────────────────────────────────────────

  function isListItemBlock(el: HTMLElement): boolean {
    return (
      el.tagName === "LI" &&
      (el.parentElement?.tagName === "UL" || el.parentElement?.tagName === "OL")
    );
  }

  function isNestedListItem(el: HTMLElement): boolean {
    return isListItemBlock(el) && el.parentElement?.parentElement?.tagName === "LI";
  }

  function isListItemEmpty(item: HTMLElement): boolean {
    const clone = item.cloneNode(true) as HTMLElement;
    for (const nested of clone.querySelectorAll("ul, ol")) nested.remove();
    const text = (clone.textContent ?? "").replaceAll("​", "").replaceAll(" ", " ").trim();
    return text === "";
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
    const range = document.createRange();
    range.selectNodeContents(block);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
  }

  function ensureEmptyParagraphPlaceholder(block: HTMLElement): void {
    if (
      (block.tagName === "P" || block.tagName === "DIV") &&
      block.dataset["mdBlank"] !== "true" &&
      !block.hasChildNodes()
    ) {
      block.append(document.createElement("br"));
    }
  }

  function placeCursorAtBlockEnd(block: HTMLElement): void {
    const sel = window.getSelection();
    if (!sel) return;
    const range = document.createRange();
    range.selectNodeContents(block);
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
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

  function hideBlankLine(blank: HTMLElement): void {
    blank.hidden = true;
    blank.contentEditable = "false";
  }

  function showBlankLine(blank: HTMLElement): void {
    blank.hidden = false;
    blank.contentEditable = "false";
    if (!blank.hasChildNodes()) {
      blank.append(document.createElement("br"));
    }
  }

  function isVisibleContentBlock(el: Element | null): boolean {
    return el instanceof HTMLElement && el.dataset["mdBlank"] !== "true";
  }

  function showMultiBlankRunsBetweenContent(): void {
    const children = [...contentEl.children];
    let i = 0;
    while (i < children.length) {
      if (!isBlankLineElement(children[i] ?? null)) {
        i++;
        continue;
      }

      const start = i;
      while (i < children.length && isBlankLineElement(children[i] ?? null)) {
        i++;
      }
      const blanks = children.slice(start, i).filter(isBlankLineElement);
      if (
        blanks.length > 1 &&
        isVisibleContentBlock(children[start - 1] ?? null) &&
        isVisibleContentBlock(children[i] ?? null)
      ) {
        for (const blank of blanks) {
          showBlankLine(blank);
        }
      }
    }
  }

  function updateActiveBlankVisibility(): void {
    for (const blank of contentEl.querySelectorAll(BLANK_LINE_SELECTOR)) {
      if (blank instanceof HTMLElement) {
        hideBlankLine(blank);
      }
    }
    showMultiBlankRunsBetweenContent();

    const sel = window.getSelection();
    const anchorNode = sel?.anchorNode;
    const activeBlock = anchorNode ? getIndentableBlock(anchorNode) : null;
    if (!activeBlock) {
      return;
    }

    if (!isEmptyParagraphBlock(activeBlock)) {
      return;
    }

    let previous = activeBlock.previousElementSibling;
    while (isBlankLineElement(previous)) {
      showBlankLine(previous);
      previous = previous.previousElementSibling;
    }
    let next = activeBlock.nextElementSibling;
    while (isBlankLineElement(next)) {
      showBlankLine(next);
      next = next.nextElementSibling;
    }
  }

  function selectionStartsInBlankLine(): boolean {
    const sel = window.getSelection();
    return !!sel?.anchorNode && getBlankLineBlock(sel.anchorNode) !== null;
  }

  function placeCursorNearBlankLine(blank: HTMLElement): void {
    const next = getNextElementSibling(blank);
    if (next) {
      placeCursorAtBlockStart(next);
      return;
    }
    const previous = getPrevElementSibling(blank);
    if (previous) {
      placeCursorAtBlockEnd(previous);
      return;
    }
    selection.placeCursorAtEnd();
  }

  function removeEmptyTopLevelListItem(item: HTMLElement): void {
    const parentList = item.parentElement;
    if (
      !(parentList instanceof HTMLElement) ||
      (parentList.tagName !== "UL" && parentList.tagName !== "OL")
    )
      return;
    const previous = getPrevElementSibling(item);
    const next = getNextElementSibling(item);
    item.remove();
    if (parentList.querySelector(":scope > li") === null) {
      const p = document.createElement("p");
      p.append(document.createElement("br"));
      parentList.replaceWith(p);
      placeCursorAtBlockStart(p);
      return;
    }
    if (previous) {
      placeCursorAtBlockEnd(previous);
      return;
    }
    if (next) {
      placeCursorAtBlockStart(next);
      return;
    }
    placeCursorAtBlockEnd(parentList);
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

  function getListItemBlock(node: Node): HTMLElement | null {
    const block = getIndentableBlock(node);
    return block && isListItemBlock(block) ? block : null;
  }

  function getHeadingBlock(node: Node): HTMLElement | null {
    const block = getIndentableBlock(node);
    if (!block) {
      return null;
    }
    return /^H[1-6]$/.test(block.tagName) ? block : null;
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

  function getBlockPasteSelectionOverride(text: string): SelectionOffsets | undefined {
    if (!text.includes("\n\n")) {
      return undefined;
    }
    const domSelection = window.getSelection();
    if (!domSelection || domSelection.rangeCount === 0 || !domSelection.isCollapsed) {
      return undefined;
    }
    const range = domSelection.getRangeAt(0);
    if (!contentEl.contains(range.startContainer)) {
      return undefined;
    }
    const block = getStructuralPasteBoundaryBlock(range.startContainer);
    if (!block || !isRangeAtStartOfBlock(range, block)) {
      return undefined;
    }
    const offsets = selection.getSelectionOffsets();
    if (!offsets) {
      return undefined;
    }
    const start = findLineStart(getValue(), offsets.start);
    return { start, end: start };
  }

  function handleEmptyListItemBackspace(e: KeyboardEvent): boolean {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return false;
    const range = sel.getRangeAt(0);
    if (!contentEl.contains(range.startContainer)) return false;
    const listItem = getListItemBlock(range.startContainer);
    if (!listItem || !isRangeAtStartOfBlock(range, listItem) || !isListItemEmpty(listItem)) {
      return false;
    }
    e.preventDefault();
    if (isNestedListItem(listItem)) {
      const md = getValue();
      const offsets = selection.getSelectionOffsets();
      if (!offsets) return false;
      undoController.pushUndo(md, offsets.start, offsets.end);
      const { md: newMd, selStart, selEnd } = shiftIndent(md, offsets.start, offsets.end, true);
      renderSelectionAndModel(newMd, selStart, selEnd);
      selection.restoreSelectionFromRenderedMarkers();
    } else {
      syncSelectionFromDomMetadata();
      if (commitStructuralTransaction(modelDeleteEmptyListItemBackward(state))) {
        return true;
      }
      removeEmptyTopLevelListItem(listItem);
      syncModelFromDom();
    }
    normalizeEditableContent(contentEl, { preserveActiveEmptyBlock: true });
    if (!syncSelectionFromDomMetadata()) {
      syncModelFromDom();
    }
    cfg.onChange?.();
    return true;
  }

  function handleHeadingEnter(): boolean {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) {
      return false;
    }
    const anchorNode = sel.anchorNode;
    if (!anchorNode) {
      return false;
    }
    const range = sel.getRangeAt(0);

    const heading = getHeadingBlock(anchorNode);
    if (!heading || !isRangeAtEndOfBlock(range, heading)) {
      return false;
    }

    trimTrailingPlaceholderBreaks(heading);
    const paragraph = document.createElement("p");
    paragraph.className = "md-heading-continuation";
    paragraph.append(document.createElement("br"));
    heading.after(paragraph);
    placeCursorAtBlockStart(paragraph);
    syncModelFromDom();
    cfg.onChange?.();
    return true;
  }

  function isEmptyParagraphBlock(block: HTMLElement): boolean {
    if (block.dataset["mdBlank"] === "true" || (block.tagName !== "P" && block.tagName !== "DIV")) {
      return false;
    }
    return (block.textContent ?? "").replaceAll("​", "").trim() === "";
  }

  function handleEmptyParagraphEnter(): boolean {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) {
      return false;
    }
    const anchorNode = sel.anchorNode;
    if (!anchorNode) {
      return false;
    }
    const block = getIndentableBlock(anchorNode);
    if (!block || !isEmptyParagraphBlock(block)) {
      return false;
    }

    const blank = document.createElement("p");
    blank.dataset["mdBlank"] = "true";
    showBlankLine(blank);
    const next = document.createElement("p");
    next.append(document.createElement("br"));
    block.replaceWith(blank, next);
    placeCursorAtBlockStart(next);
    updateActiveBlankVisibility();
    syncModelFromDom();
    cfg.onChange?.();
    return true;
  }

  function createBlankLineSpacer(): HTMLElement {
    const blank = document.createElement("p");
    blank.dataset["mdBlank"] = "true";
    showBlankLine(blank);
    return blank;
  }

  function createCursorParagraph(): HTMLElement {
    const paragraph = document.createElement("p");
    paragraph.append(document.createElement("br"));
    return paragraph;
  }

  function moveCursorIntoBlankLine(blank: HTMLElement, activeEmpty?: HTMLElement): void {
    if (activeEmpty) {
      activeEmpty.replaceWith(createBlankLineSpacer());
    }
    const cursorLine = createCursorParagraph();
    blank.replaceWith(cursorLine);
    placeCursorAtBlockStart(cursorLine);
    updateActiveBlankVisibility();
  }

  function handleArrowThroughBlankLines(e: KeyboardEvent): boolean {
    if (
      (e.key !== "ArrowUp" && e.key !== "ArrowDown") ||
      e.shiftKey ||
      e.metaKey ||
      e.ctrlKey ||
      e.altKey
    ) {
      return false;
    }
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || !sel.isCollapsed || !sel.anchorNode) {
      return false;
    }
    const activeBlock = getIndentableBlock(sel.anchorNode);
    if (!activeBlock) {
      return false;
    }

    const previous = activeBlock.previousElementSibling;
    const next = activeBlock.nextElementSibling;
    if (e.key === "ArrowUp" && isBlankLineElement(previous)) {
      e.preventDefault();
      moveCursorIntoBlankLine(
        previous,
        isEmptyParagraphBlock(activeBlock) ? activeBlock : undefined,
      );
      return true;
    }
    if (e.key === "ArrowDown" && isBlankLineElement(next)) {
      e.preventDefault();
      moveCursorIntoBlankLine(next, isEmptyParagraphBlock(activeBlock) ? activeBlock : undefined);
      return true;
    }
    return false;
  }

  function isRangeAtEndOfBlock(range: Range, block: HTMLElement): boolean {
    const after = range.cloneRange();
    after.selectNodeContents(block);
    after.setStart(range.endContainer, range.endOffset);
    return after.toString().replaceAll("​", "") === "";
  }

  function trimTrailingPlaceholderBreaks(block: HTMLElement): void {
    while (block.lastChild instanceof HTMLBRElement) {
      block.lastChild.remove();
    }
  }

  // ── Source mode Tab key ─────────────────────────────────────────────────────

  function dedentLine(line: string): string {
    const indentUnit = cfg.indentUnit ?? "\t";
    if (line.startsWith(indentUnit)) return line.slice(indentUnit.length);
    const match = line.match(new RegExp(`^[ ]{1,${LIST_INDENT_SPACES}}`));
    return match ? line.slice(match[0].length) : line;
  }

  function handleSourceTabKey(e: KeyboardEvent): void {
    e.preventDefault();
    const indentUnit = cfg.indentUnit ?? "\t";
    const { value } = sourceEl;
    const start = sourceEl.selectionStart;
    const end = sourceEl.selectionEnd;

    if (!e.shiftKey && start === end) {
      sourceEl.value = value.slice(0, start) + indentUnit + value.slice(end);
      sourceEl.selectionStart = start + indentUnit.length;
      sourceEl.selectionEnd = start + indentUnit.length;
      cfg.onChange?.();
      return;
    }

    const lineStartIdx = value.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
    const adjustedEnd = end > start && value[end - 1] === "\n" ? end - 1 : end;
    const nextNewline = value.indexOf("\n", adjustedEnd);
    const lineEnd = nextNewline === -1 ? value.length : nextNewline;
    const lines = value.slice(lineStartIdx, lineEnd).split("\n");
    const transformed = e.shiftKey ? lines.map(dedentLine) : lines.map((l) => indentUnit + l);
    sourceEl.setRangeText(transformed.join("\n"), lineStartIdx, lineEnd, "select");
    sourceEl.selectionStart = lineStartIdx;
    sourceEl.selectionEnd = lineStartIdx + transformed.join("\n").length;
    cfg.onChange?.();
  }

  // ── Event handlers ──────────────────────────────────────────────────────────

  function onKeyDown(e: KeyboardEvent): void {
    const meta = e.metaKey || e.ctrlKey;
    if (state.selection.kind === "block") {
      if (e.key === "Escape") {
        e.preventDefault();
        const block = state.doc.blocks.byId.get(state.selection.anchorBlockId);
        const offset = block ? state.doc.lineStarts[block.startLine]! : 0;
        state = { ...state, selection: offsetsToSelection(state.doc, offset, offset) };
        renderBlockSelectionClasses();
        renderer.renderWithSelection(currentMarkdown(), offset, offset);
        annotateEditorDom(contentEl, state.doc);
        selection.restoreSelectionFromRenderedMarkers();
        updateActiveBlankVisibility();
        return;
      }
      if (e.key === "Backspace" || e.key === "Delete") {
        e.preventDefault();
        replaceBlockSelection("");
        return;
      }
      if (e.key.length === 1 && !meta && !e.altKey) {
        e.preventDefault();
        replaceBlockSelection(e.key);
        return;
      }
    }
    if (meta && e.key === "s") {
      e.preventDefault();
      e.stopPropagation();
      cfg.onSave?.();
      return;
    }
    if (meta && e.key === "z" && !e.shiftKey) {
      e.preventDefault();
      undo();
      return;
    }
    if ((meta && e.shiftKey && e.key === "z") || (meta && e.key === "y")) {
      e.preventDefault();
      redo();
      return;
    }
    if (e.key === "Tab") {
      e.preventDefault();
      const dedent = e.shiftKey;
      applyFormat((md, s, end) => shiftIndent(md, s, end, dedent));
      return;
    }
    if (meta && e.key === "b") {
      e.preventDefault();
      applyFormat(toggleBold);
      return;
    }
    if (meta && e.shiftKey && e.key.toLowerCase() === "i") {
      e.preventDefault();
      applyFormat(toggleItalic);
      return;
    }
    if (meta && e.key === "h") {
      e.preventDefault();
      applyFormat(toggleHighlight);
      return;
    }
    if (handleArrowThroughBlankLines(e)) return;
    if (e.key === "Backspace" && handleEmptyListItemBackspace(e)) return;
    if (e.key === "Enter" && !e.shiftKey) {
      if (handleHeadingEnter()) {
        suppressNextInsertParagraph = true;
        window.setTimeout(() => {
          suppressNextInsertParagraph = false;
        }, 0);
        e.preventDefault();
        return;
      }
      if (handleEmptyParagraphEnter()) {
        suppressNextInsertParagraph = true;
        window.setTimeout(() => {
          suppressNextInsertParagraph = false;
        }, 0);
        e.preventDefault();
        return;
      }
      handleBlockTransform(e, contentEl, () => cfg.onChange?.());
    }
  }

  function onInput(): void {
    if (state.composing) {
      syncActiveLineFromDom();
      undoController.scheduleTypingCheckpoint();
      cfg.onChange?.();
      return;
    }
    checkInlineTransform();
    const activeBlock = getIndentableBlock(window.getSelection()?.anchorNode ?? contentEl);
    normalizeEditableContent(activeBlock ?? contentEl, { preserveActiveEmptyBlock: true });
    const blank = window.getSelection()?.anchorNode;
    const blankBlock = blank ? getBlankLineBlock(blank) : null;
    if (blankBlock) {
      placeCursorNearBlankLine(blankBlock);
    }
    updateActiveBlankVisibility();
    const lineSynced = syncActiveLineFromDom();
    if (lineSynced && renderModelAfterInputTransform()) {
      undoController.scheduleTypingCheckpoint();
      cfg.onChange?.();
      return;
    }
    if (!lineSynced) {
      if (checkBlockInputTransform(contentEl)) {
        syncModelFromDom();
        cfg.onChange?.();
        return;
      }
      syncModelFromDom();
    }
    undoController.scheduleTypingCheckpoint();
    cfg.onChange?.();
  }

  async function onPaste(e: ClipboardEvent): Promise<void> {
    e.preventDefault();
    const clipData = e.clipboardData;
    const usePlainTextPaste = preferPlainTextPaste;
    preferPlainTextPaste = false;
    if (!clipData) return;

    const imageItem = [...clipData.items].find((item) => item.type.startsWith("image/"));
    if (imageItem && cfg.onImagePaste) {
      const file = imageItem.getAsFile();
      if (file) {
        const bitmap = await createImageBitmap(file);
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        const ctx = canvas.getContext("2d")!;
        ctx.drawImage(bitmap, 0, 0);
        const blob = await canvas.convertToBlob({
          type: "image/webp",
          quality: cfg.imageWebpQuality ?? 0.85,
        });
        bitmap.close();
        const html = await cfg.onImagePaste(blob);
        if (html) {
          const div = htmlToSanitizedContainer(html);
          const imageMarkdown = domToMarkdown(div, { extensions }) || html;
          if (!replaceBlockSelection(imageMarkdown)) {
            if (syncSelectionFromDomMetadata()) {
              commitStructuralTransaction(modelReplaceSelection(state, imageMarkdown));
            } else {
              transactions.replaceSelection(imageMarkdown);
            }
          }
        }
      }
      return;
    }

    const htmlData = clipData.getData("text/html");
    const plainTextData = clipData.getData("text/plain");
    let pastedText: string;
    if (htmlData && !usePlainTextPaste) {
      const div = htmlToSanitizedContainer(htmlData);
      pastedText = domToMarkdown(div, { extensions }) || plainTextData;
    } else {
      pastedText = plainTextData;
    }

    if (pastedText) {
      if (!replaceBlockSelection(pastedText)) {
        const selectionOverride = getBlockPasteSelectionOverride(pastedText);
        if (selectionOverride !== undefined || !syncSelectionFromDomMetadata()) {
          transactions.replaceSelection(pastedText, selectionOverride);
        } else {
          commitStructuralTransaction(modelReplaceSelection(state, pastedText));
        }
      }
    }
  }

  function onBeforeInput(e: InputEvent): void {
    if (state.composing) {
      return;
    }
    if (state.selection.kind === "block") {
      if (e.inputType === "insertText" && e.data !== null) {
        e.preventDefault();
        replaceBlockSelection(e.data);
        return;
      }
      if (e.inputType === "insertParagraph") {
        e.preventDefault();
        replaceBlockSelection("");
        return;
      }
      if (e.inputType === "deleteContentBackward" || e.inputType === "deleteContentForward") {
        e.preventDefault();
        replaceBlockSelection("");
        return;
      }
    }
    if (e.inputType === "insertParagraph") {
      if (suppressNextInsertParagraph) {
        suppressNextInsertParagraph = false;
        e.preventDefault();
        return;
      }
      if (handleHeadingEnter()) {
        e.preventDefault();
        return;
      }
      if (handleEmptyParagraphEnter()) {
        e.preventDefault();
        return;
      }
      if (
        syncSelectionFromDomMetadata() &&
        commitStructuralTransaction(modelInsertListParagraph(state))
      ) {
        e.preventDefault();
        return;
      }
      if (
        syncSelectionFromDomMetadata() &&
        commitStructuralTransaction(modelInsertParagraph(state))
      ) {
        e.preventDefault();
        return;
      }
    }
    if (e.inputType === "deleteContentBackward") {
      if (
        syncSelectionFromDomMetadata() &&
        commitStructuralTransaction(modelDeleteBackward(state))
      ) {
        e.preventDefault();
        return;
      }
    }
    if (e.inputType === "deleteContentForward") {
      if (
        syncSelectionFromDomMetadata() &&
        commitStructuralTransaction(modelDeleteForward(state))
      ) {
        e.preventDefault();
        return;
      }
    }
    if (selectionStartsInBlankLine()) {
      e.preventDefault();
      preferPlainTextPaste = false;
      return;
    }
    if (e.inputType !== "insertFromPaste" && e.inputType !== "insertFromPasteAsQuotation") {
      preferPlainTextPaste = false;
      return;
    }
    const dataTransfer = e.dataTransfer;
    preferPlainTextPaste =
      dataTransfer !== null &&
      hasDataTransferType(dataTransfer, "text/plain") &&
      !hasDataTransferType(dataTransfer, "text/html");
  }

  function onCheckboxEvent(e: Event): void {
    if (e.target instanceof HTMLInputElement && e.target.type === "checkbox") {
      cfg.onChange?.();
    }
  }

  function onContentPaste(e: ClipboardEvent): void {
    void onPaste(e);
  }

  function onContentCopy(e: ClipboardEvent): void {
    copyBlockSelection(e);
  }

  function onContentCut(e: ClipboardEvent): void {
    if (copyBlockSelection(e)) {
      replaceBlockSelection("");
    }
  }

  function onContentSelectionCommit(): void {
    if (_isSourceMode || state.selection.kind === "block") return;
    if (!syncSelectionFromDomMetadata()) {
      setModelSelection(selection.getSelectionOffsets());
    }
  }

  function onCompositionStart(): void {
    state = { ...state, composing: true };
  }

  function onCompositionEnd(): void {
    state = { ...state, composing: false };
    if (!syncActiveLineFromDom()) {
      syncModelFromDom();
    }
    checkInlineTransform();
    if (!syncActiveLineFromDom()) {
      syncModelFromDom();
    }
    cfg.onChange?.();
  }

  function onContentPointerDown(e: PointerEvent): void {
    const handle = getBlockHandle(e.target);
    if (handle) {
      e.preventDefault();
      const blockId = handle.dataset["mdBlockHandle"];
      if (blockId) {
        selectBlock(blockId, e.shiftKey);
      }
      return;
    }
    const blank = getBlankLineBlock(e.target instanceof Node ? e.target : null);
    if (!blank) return;
    e.preventDefault();
    placeCursorNearBlankLine(blank);
  }

  function onSourceInput(): void {
    syncModelFromSource();
    cfg.onChange?.();
  }

  function isWikiImage(el: EventTarget | null): el is HTMLImageElement {
    return el instanceof HTMLImageElement && el.dataset["wikiImage"] !== undefined;
  }

  function imageWidth(image: HTMLImageElement): number {
    const rectWidth = Math.round(image.getBoundingClientRect().width);
    const attrWidth = Number(image.getAttribute("width"));
    const naturalWidth = image.naturalWidth;
    const width = rectWidth || attrWidth || naturalWidth || 320;
    return Math.min(IMAGE_RESIZE_MAX_WIDTH, Math.max(IMAGE_RESIZE_MIN_WIDTH, width));
  }

  function isImageResizePointer(e: PointerEvent, image: HTMLImageElement): boolean {
    const rect = image.getBoundingClientRect();
    return (
      rect.width > 0 &&
      e.clientX >= rect.left &&
      e.clientX <= rect.right &&
      rect.right - e.clientX <= IMAGE_RESIZE_EDGE_PX
    );
  }

  function onImagePointerDown(e: PointerEvent): void {
    if (_isSourceMode || !isWikiImage(e.target) || !isImageResizePointer(e, e.target)) return;
    e.preventDefault();
    e.stopPropagation();
    undoController.checkpoint();
    e.target.classList.add("md-image-resizing");
    imageResizeDrag = {
      image: e.target,
      startX: e.clientX,
      startWidth: imageWidth(e.target),
      changed: false,
    };
  }

  function onDocumentPointerMove(e: PointerEvent): void {
    if (!imageResizeDrag) return;
    e.preventDefault();
    const nextWidth = Math.round(
      Math.min(
        IMAGE_RESIZE_MAX_WIDTH,
        Math.max(
          IMAGE_RESIZE_MIN_WIDTH,
          imageResizeDrag.startWidth + e.clientX - imageResizeDrag.startX,
        ),
      ),
    );
    imageResizeDrag.image.setAttribute("width", String(nextWidth));
    imageResizeDrag.image.style.width = `${nextWidth}px`;
    imageResizeDrag.changed ||= nextWidth !== imageResizeDrag.startWidth;
  }

  function endImageResize(): void {
    if (!imageResizeDrag) return;
    const drag = imageResizeDrag;
    imageResizeDrag = null;
    drag.image.classList.remove("md-image-resizing");
    if (!drag.changed) return;
    syncModelFromDom();
    undoController.checkpoint();
    cfg.onChange?.();
  }

  function onSourceKeyDown(e: KeyboardEvent): void {
    const meta = e.metaKey || e.ctrlKey;
    if (meta && e.key === "s") {
      e.preventDefault();
      e.stopPropagation();
      cfg.onSave?.();
      return;
    }
    if (e.key === "Tab") {
      handleSourceTabKey(e);
    }
  }

  contentEl.addEventListener("keydown", onKeyDown);
  contentEl.addEventListener("beforeinput", onBeforeInput);
  contentEl.addEventListener("input", onInput);
  contentEl.addEventListener("compositionstart", onCompositionStart);
  contentEl.addEventListener("compositionend", onCompositionEnd);
  contentEl.addEventListener("keyup", onContentSelectionCommit);
  contentEl.addEventListener("mouseup", onContentSelectionCommit);
  contentEl.addEventListener("paste", onContentPaste);
  contentEl.addEventListener("copy", onContentCopy);
  contentEl.addEventListener("cut", onContentCut);
  contentEl.addEventListener("change", onCheckboxEvent);
  contentEl.addEventListener("click", onCheckboxEvent);
  contentEl.addEventListener("pointerdown", onContentPointerDown);
  contentEl.addEventListener("pointerdown", onImagePointerDown);
  document.addEventListener("pointermove", onDocumentPointerMove);
  document.addEventListener("pointerup", endImageResize);
  document.addEventListener("pointercancel", endImageResize);
  sourceEl.addEventListener("input", onSourceInput);
  sourceEl.addEventListener("keydown", onSourceKeyDown);

  // ── Source mode ─────────────────────────────────────────────────────────────

  function toggleSourceMode(): void {
    if (_isSourceMode) {
      syncModelFromSource();
      const md = currentMarkdown();
      const selStart = sourceEl.selectionStart;
      const selEnd = sourceEl.selectionEnd;
      renderer.renderWithSelection(md, selStart, selEnd);
      annotateEditorDom(contentEl, state.doc);
      _isSourceMode = false;
      state = { ...state, sourceMode: false };
      sourceEl.style.display = "none";
      contentEl.style.display = "";
      selection.restoreSelectionFromRenderedMarkers();
      updateActiveBlankVisibility();
    } else {
      syncModelFromDom();
      const offsets = currentSelectionOffsets();
      sourceEl.value = currentMarkdown();
      _isSourceMode = true;
      state = { ...state, sourceMode: true };
      contentEl.style.display = "none";
      sourceEl.style.display = "";
      const start = offsets?.start ?? 0;
      const end = offsets?.end ?? start;
      sourceEl.focus();
      sourceEl.setSelectionRange(start, end);
    }
  }

  function setConfig(partial: Partial<EditorConfig>): void {
    cfg = { ...cfg, ...partial };
    if (partial.contentClassName !== undefined) contentEl.className = partial.contentClassName;
    if (partial.sourceClassName !== undefined) sourceEl.className = partial.sourceClassName;
  }

  function destroy(): void {
    undoController.destroy();
    contentEl.removeEventListener("keydown", onKeyDown);
    contentEl.removeEventListener("beforeinput", onBeforeInput);
    contentEl.removeEventListener("input", onInput);
    contentEl.removeEventListener("compositionstart", onCompositionStart);
    contentEl.removeEventListener("compositionend", onCompositionEnd);
    contentEl.removeEventListener("keyup", onContentSelectionCommit);
    contentEl.removeEventListener("mouseup", onContentSelectionCommit);
    contentEl.removeEventListener("paste", onContentPaste);
    contentEl.removeEventListener("copy", onContentCopy);
    contentEl.removeEventListener("cut", onContentCut);
    contentEl.removeEventListener("change", onCheckboxEvent);
    contentEl.removeEventListener("click", onCheckboxEvent);
    contentEl.removeEventListener("pointerdown", onContentPointerDown);
    contentEl.removeEventListener("pointerdown", onImagePointerDown);
    document.removeEventListener("pointermove", onDocumentPointerMove);
    document.removeEventListener("pointerup", endImageResize);
    document.removeEventListener("pointercancel", endImageResize);
    sourceEl.removeEventListener("input", onSourceInput);
    sourceEl.removeEventListener("keydown", onSourceKeyDown);
    contentEl.remove();
    sourceEl.remove();
  }

  return {
    getValue,
    getSnapshot,
    setValue,
    getSelectionOffsets,
    getCursorOffset,
    applyFormat,
    undo,
    redo,
    toggleSourceMode,
    focus: () => contentEl.focus(),
    setConfig,
    get isSourceMode() {
      return _isSourceMode;
    },
    contentEl,
    sourceEl,
    destroy,
  };
}
