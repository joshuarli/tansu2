/// WYSIWYG editor wiring layer. Creates DOM, manages undo stack, routes keyboard
/// events, and handles image paste. All markdown-specific behavior is delegated to
/// model, render, and serialize modules; callers configure extensions and callbacks.

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
  replaceLine,
  replaceLineText,
  replaceSelection as modelReplaceSelection,
  selectionToOffsets as modelSelectionToOffsets,
  type EditorState,
  type RenderHint,
  type LogicalPosition,
  type TransactionResult,
} from "./editor-model.js";
import { normalizeEditableContent } from "./editor-normalize.js";
import { annotateEditorDom, createEditorRenderer, type DomMap } from "./editor-renderer.js";
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
import { matchPattern, patterns as inlineTransformPatterns } from "./inline-patterns.js";
import { domToMarkdown } from "./serialize.js";

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
  const selection = createEditorSelectionController(contentEl);
  let domMap: DomMap = { lineToElement: new Map(), blockToElement: new Map() };
  let suppressNextInsertParagraph = false;
  let arrowNavigationHandled = false;
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

  function annotateCurrentDom(): void {
    domMap = annotateEditorDom(contentEl, state.doc);
  }

  function renderCurrentModel(): void {
    renderer.render(currentMarkdown());
    annotateCurrentDom();
    restoreDomSelectionFromModel();
    updateActiveBlankVisibility();
  }

  function renderModelHint(hint: RenderHint): boolean {
    return hint.kind === "lines" && renderLineRangeFromModel(hint.startLine, hint.endLine);
  }

  function renderLineRangeFromModel(startLine: number, endLine: number): boolean {
    if (endLine !== startLine + 1) {
      return false;
    }
    const line = state.doc.lines[startLine];
    if (!line) {
      return false;
    }
    const blockRef = state.doc.blocks.byLine[startLine];
    const block = blockRef ? state.doc.blocks.byId.get(blockRef.blockId) : null;
    if (!block) {
      return false;
    }
    if (block.kind === "code" || block.kind === "table" || block.kind === "blockquote") {
      return false;
    }
    if (
      block.kind !== "paragraph" &&
      block.kind !== "blank" &&
      block.endLine !== block.startLine + 1
    ) {
      return false;
    }
    const oldLineHost = domMap.lineToElement.get(line.id);
    if (!oldLineHost) {
      return false;
    }
    const oldBlockRoot = oldLineHost.closest("[data-md-block-id]");
    if (!(oldBlockRoot instanceof HTMLElement) || oldBlockRoot.parentElement !== contentEl) {
      return false;
    }
    if (oldBlockRoot.querySelectorAll("[data-md-line-index]").length > 1) {
      return false;
    }
    const replacement = renderer.renderFragment(line.text);
    if (replacement.length !== 1) {
      return false;
    }
    oldBlockRoot.replaceWith(replacement[0]!);
    annotateCurrentDom();
    restoreDomSelectionFromModel();
    updateActiveBlankVisibility();
    return true;
  }

  function renderSelectionAndModel(md: string, selStart: number, selEnd: number): void {
    const normalized = normalizeMarkdownNewlines(md);
    setModelMarkdown(normalized, { start: selStart, end: selEnd });
    renderCurrentModel();
  }

  function commitTransaction(result: TransactionResult, notify = true): boolean {
    if (!result.changed) return false;
    state = result.state;
    if (!renderModelHint(result.renderHint)) {
      renderCurrentModel();
    }
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

  function restoreDomSelectionFromModel(): void {
    renderBlockSelectionClasses();
    if (_isSourceMode || state.selection.kind !== "text") {
      window.getSelection()?.removeAllRanges();
      return;
    }
    const anchorPoint = domPointForPosition(state.selection.anchor);
    const focusPoint = domPointForPosition(state.selection.focus);
    if (!anchorPoint || !focusPoint) {
      selection.placeCursorAtEnd();
      syncSelectionFromDomMetadata();
      return;
    }
    const sel = window.getSelection();
    if (!sel) return;
    try {
      sel.removeAllRanges();
      if (typeof sel.setBaseAndExtent === "function") {
        sel.setBaseAndExtent(
          anchorPoint.node,
          anchorPoint.offset,
          focusPoint.node,
          focusPoint.offset,
        );
      } else {
        const range = document.createRange();
        const ordered = comparePositions(state.selection.anchor, state.selection.focus) <= 0;
        const start = ordered ? anchorPoint : focusPoint;
        const end = ordered ? focusPoint : anchorPoint;
        range.setStart(start.node, start.offset);
        range.setEnd(end.node, end.offset);
        sel.addRange(range);
      }
    } catch {
      selection.placeCursorAtEnd();
    }
    syncSelectionFromDomMetadata();
  }

  function comparePositions(a: LogicalPosition, b: LogicalPosition): number {
    return a.line === b.line ? a.column - b.column : a.line - b.line;
  }

  function domPointForPosition(pos: LogicalPosition): { node: Node; offset: number } | null {
    const line = state.doc.lines[pos.line];
    if (!line) return null;
    const host = domMap.lineToElement.get(line.id);
    if (!host) return null;
    const clampedColumn = Math.min(Math.max(0, pos.column), line.text.length);
    if (line.text === "" || (host.textContent ?? "").replaceAll("​", "") === "") {
      if (isBlankLineElement(host)) {
        showActiveBlankLine(host);
      }
      ensureEmptyParagraphPlaceholder(host);
      return { node: host, offset: 0 };
    }

    const sourcePoint = domPointFromSourceSpan(host, clampedColumn);
    if (sourcePoint) return sourcePoint;

    const lineContentStart = Number(host.dataset["mdLineContentStart"]);
    let visualOffset = Number.isFinite(lineContentStart)
      ? Math.max(0, clampedColumn - lineContentStart)
      : clampedColumn;
    const hostText = hostTextWithoutControls(host);
    if (hostText.startsWith("\u00A0")) {
      visualOffset += 1;
    }
    return domPointFromVisualOffset(host, visualOffset);
  }

  function domPointFromSourceSpan(
    host: HTMLElement,
    column: number,
  ): { node: Node; offset: number } | null {
    const candidates = [...host.querySelectorAll<HTMLElement>("[data-md-content-start]")].filter(
      (el) => {
        const contentStart = sourceBoundary(el, "mdContentStart");
        const contentEnd = sourceBoundary(el, "mdContentEnd");
        const sourceStart = sourceBoundary(el, "mdSourceStart");
        const sourceEnd = sourceBoundary(el, "mdSourceEnd");
        return (
          contentStart !== null &&
          contentEnd !== null &&
          sourceStart !== null &&
          sourceEnd !== null &&
          column >= sourceStart &&
          column <= sourceEnd
        );
      },
    );
    candidates.sort((a, b) => (a.textContent ?? "").length - (b.textContent ?? "").length);
    const el = candidates[0];
    if (!el) return null;
    const contentStart = sourceBoundary(el, "mdContentStart")!;
    const contentEnd = sourceBoundary(el, "mdContentEnd")!;
    if (column <= contentStart) {
      return { node: el.parentNode ?? host, offset: childOffset(el) };
    }
    if (column >= contentEnd) {
      return { node: el.parentNode ?? host, offset: childOffset(el) + 1 };
    }
    return domPointFromVisualOffset(el, column - contentStart);
  }

  function domPointFromVisualOffset(
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

  function hostTextWithoutControls(host: HTMLElement): string {
    const clone = host.cloneNode(true) as HTMLElement;
    for (const control of clone.querySelectorAll("button,input")) {
      control.remove();
    }
    return (clone.textContent ?? "").replaceAll("​", "");
  }

  function hostDirectHandle(host: HTMLElement): HTMLElement | null {
    const handle = host.querySelector(":scope > .md-block-handle");
    return handle instanceof HTMLElement ? handle : null;
  }

  function childOffset(node: Node): number {
    let offset = 0;
    let current = node.previousSibling;
    while (current) {
      offset++;
      current = current.previousSibling;
    }
    return offset;
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
    cfg.onChange?.();
    return true;
  }

  function replaceMarkdownRange(start: number, end: number, text: string): void {
    const md = currentMarkdown();
    const normalized = normalizeMarkdownNewlines(text);
    const cursor = start + normalized.length;
    renderSelectionAndModel(md.slice(0, start) + normalized + md.slice(end), cursor, cursor);
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
    if (
      blockKind !== "paragraph" &&
      blockKind !== "blank" &&
      blockKind !== "heading" &&
      blockKind !== "list" &&
      blockKind !== "blockquote"
    ) {
      return false;
    }
    const hasRichInline = [...host.children].some(
      (child) =>
        child instanceof HTMLElement &&
        child.tagName !== "BR" &&
        child.tagName !== "INPUT" &&
        child.tagName !== "BUTTON" &&
        child.className !== "md-block-handle",
    );
    const lineIndex = Number(host.dataset["mdLineIndex"]);
    if (!Number.isInteger(lineIndex)) return false;
    if (hasRichInline) {
      return syncActiveSourceSpanFromDom(host, lineIndex, range);
    }
    const text = lineTextFromHost(host, lineIndex);
    const pos = logicalPositionFromDom(range.startContainer, range.startOffset);
    const result = replaceLineText(state, lineIndex, text, pos?.column ?? text.length);
    state = result.state;
    return result.changed || result.renderHint.kind === "none";
  }

  function lineTextFromHost(host: HTMLElement, lineIndex: number): string {
    const rawText = (host.textContent ?? "").replaceAll("​", "");
    const lineContentStart = Number(host.dataset["mdLineContentStart"]);
    const contentText =
      Number.isFinite(lineContentStart) && lineContentStart > 0
        ? rawText.replace(/^\u00A0/, "")
        : rawText;
    const visualText = /^\u00A0*$/.test(contentText)
      ? ""
      : contentText.replaceAll("\u00A0", " ");
    if (!Number.isFinite(lineContentStart) || lineContentStart <= 0) {
      return visualText;
    }
    return state.doc.lines[lineIndex]!.text.slice(0, lineContentStart) + visualText;
  }

  function syncActiveSourceSpanFromDom(
    host: HTMLElement,
    lineIndex: number,
    range: Range,
  ): boolean {
    const node =
      range.startContainer instanceof Element
        ? range.startContainer
        : range.startContainer.parentElement;
    const sourceElement = node?.closest("[data-md-content-start]");
    if (
      !(sourceElement instanceof HTMLElement) ||
      !host.contains(sourceElement) ||
      sourceElement.dataset["mdAtomicSource"] === "true"
    ) {
      return false;
    }
    const contentStart = sourceBoundary(sourceElement, "mdContentStart");
    const contentEnd = sourceBoundary(sourceElement, "mdContentEnd");
    if (contentStart === null || contentEnd === null) {
      return false;
    }
    const content = (sourceElement.textContent ?? "").replaceAll("​", "");
    const line = state.doc.lines[lineIndex]!.text;
    const text = line.slice(0, contentStart) + content + line.slice(contentEnd);
    const pos = logicalPositionFromDom(range.startContainer, range.startOffset);
    const result = replaceLineText(
      state,
      lineIndex,
      text,
      pos?.column ?? contentStart + content.length,
    );
    state = result.state;
    return result.changed || result.renderHint.kind === "none";
  }

  function replaceEmptySelectedLineInput(text: string): boolean {
    if (state.selection.kind !== "text") {
      return false;
    }
    const { anchor, focus } = state.selection;
    if (anchor.line !== focus.line || anchor.column !== focus.column) {
      return false;
    }
    if (state.doc.lines[anchor.line]?.text !== "") {
      return false;
    }
    if (shouldKeepMarkerInputPlain(text)) {
      const line = anchor.line;
      const result = replaceLineText(state, line, text);
      state = result.state;
      renderPlainLineHost(line, text);
      undoController.scheduleTypingCheckpoint();
      cfg.onChange?.();
      return true;
    }
    if (text === " " || text === "\u00A0") {
      const line = anchor.line;
      const result = replaceLineText(state, line, " ");
      state = result.state;
      renderPlainLineHost(line, " ");
      undoController.scheduleTypingCheckpoint();
      cfg.onChange?.();
      return true;
    }
    return commitStructuralTransaction(replaceLineText(state, anchor.line, text));
  }

  function plainMarkerPrefixTextAfterInsert(data: string): string | null {
    if (data.length !== 1 || state.selection.kind !== "text") {
      return null;
    }
    const { anchor, focus } = state.selection;
    if (anchor.line !== focus.line || anchor.column !== focus.column) {
      return null;
    }
    const line = state.doc.lines[anchor.line]?.text;
    if (line === undefined || anchor.column !== line.length) {
      return null;
    }
    if (/^(\*|`|~|=)$/.test(line) && data === line) {
      return `${line}${data}`;
    }
    return null;
  }

  function leadingSpaceTextAfterInsert(data: string): { line: number; text: string } | null {
    if (data.length !== 1 || state.selection.kind !== "text") {
      return null;
    }
    const { anchor, focus } = state.selection;
    if (anchor.line !== focus.line || anchor.column !== focus.column) {
      return null;
    }
    const line = state.doc.lines[anchor.line]?.text;
    if (line === undefined || !line.startsWith(" ")) {
      return null;
    }
    return {
      line: anchor.line,
      text: `${line.slice(0, anchor.column)}${data}${line.slice(anchor.column)}`,
    };
  }

  function shouldKeepMarkerInputPlain(text: string): boolean {
    return /^[-*+>]$/.test(text);
  }

  function renderPlainLineHost(lineIndex: number, text: string): void {
    const line = state.doc.lines[lineIndex];
    const host = line ? domMap.lineToElement.get(line.id) : null;
    if (!line || !host) {
      renderCurrentModel();
      return;
    }
    const handle = hostDirectHandle(host);
    for (const child of Array.from(host.childNodes)) {
      if (child !== handle) {
        child.remove();
      }
    }
    const displayText = text.replace(/^ +/, (spaces) => "\u00A0".repeat(spaces.length));
    const textNode = document.createTextNode(displayText);
    if (handle) {
      host.insertBefore(textNode, handle);
    } else {
      host.append(textNode);
    }
    host.hidden = false;
    delete host.dataset["mdBlank"];
    delete host.dataset["mdLineContentStart"];
    host.dataset["mdLineId"] = line.id;
    host.dataset["mdLineIndex"] = String(lineIndex);
    host.dataset["mdBlockKind"] = "paragraph";
    const range = document.createRange();
    range.setStart(textNode, text.length);
    range.collapse(true);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    updateActiveBlankVisibility();
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

  function shouldRenderModelInlineInputTransform(): boolean {
    if (state.selection.kind !== "text") return false;
    const { anchor, focus } = state.selection;
    if (anchor.line !== focus.line || anchor.column !== focus.column) return false;
    const text = state.doc.lines[anchor.line]?.text ?? "";
    return inlineTransformPatterns.some((pattern) => matchPattern(text, anchor.column, pattern));
  }

  function renderModelAfterInputTransform(): boolean {
    if (!shouldRenderModelBlockInputTransform() && !shouldRenderModelInlineInputTransform()) {
      return false;
    }
    const line = state.selection.kind === "text" ? state.selection.anchor.line : -1;
    if (!renderLineRangeFromModel(line, line + 1)) {
      renderCurrentModel();
    }
    return true;
  }

  function blockTransformTextAfterInsert(data: string): string | null {
    if (data !== " " && data !== "\u00A0") {
      return null;
    }
    if (state.selection.kind !== "text") {
      return null;
    }
    const { anchor, focus } = state.selection;
    if (anchor.line !== focus.line || anchor.column !== focus.column) {
      return null;
    }
    const line = state.doc.lines[anchor.line]?.text;
    if (line === undefined || anchor.column !== line.length) {
      return null;
    }
    if (
      /^#{1,6}$/.test(line) ||
      /^[-*]$/.test(line) ||
      /^\d+\.$/.test(line) ||
      /^>$/.test(line) ||
      /^\[([ xX])\]$/.test(line) ||
      /^```[^ \u00A0]*$/.test(line)
    ) {
      return `${line}${data}`;
    }
    return null;
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
    return modelSelectionToOffsets(state.doc, state.selection);
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
    } else {
      renderCurrentModel();
    }
    const sel = syncSelectionFromDomMetadata()
      ? modelSelectionToOffsets(state.doc, state.selection)
      : currentSelectionOffsets();
    setModelSelection(sel);
    undoController.pushUndo(normalized, sel?.start ?? 0, sel?.end ?? 0);
  }

  const undoController = createEditorUndoController({
    getValue,
    getSelectionOffsets,
    renderSelection: renderSelectionAndModel,
    restoreSelection: restoreDomSelectionFromModel,
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
    restoreSelection: restoreDomSelectionFromModel,
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

  function isVisibleContentBlock(el: Element | null): boolean {
    return el instanceof HTMLElement && el.dataset["mdBlank"] !== "true";
  }

  function hideBlankLine(blank: HTMLElement): void {
    blank.hidden = true;
    blank.contentEditable = "false";
  }

  function showBlankLine(blank: HTMLElement): void {
    blank.hidden = false;
    blank.contentEditable = "false";
    if (!blank.querySelector("br") && (blank.textContent ?? "") === "") {
      blank.prepend(document.createElement("br"));
    }
  }

  function showActiveBlankLine(blank: HTMLElement): void {
    const hasAdjacentBlank =
      isBlankLineElement(blank.previousElementSibling) ||
      isBlankLineElement(blank.nextElementSibling);
    if (!hasAdjacentBlank) {
      delete blank.dataset["mdBlank"];
    }
    blank.hidden = false;
    blank.contentEditable = "true";
    if (!blank.querySelector("br") && (blank.textContent ?? "") === "") {
      blank.prepend(document.createElement("br"));
    }
  }

  function showRepeatedBlankRuns(): void {
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
      const visibleBlanks =
        isVisibleContentBlock(children[start - 1] ?? null) &&
        isVisibleContentBlock(children[i] ?? null)
          ? blanks
          : blanks.length > 1
            ? blanks
            : blanks.slice(1);
      for (const blank of visibleBlanks) {
        showBlankLine(blank);
      }
    }
  }

  function updateActiveBlankVisibility(): void {
    for (const blank of contentEl.querySelectorAll(BLANK_LINE_SELECTOR)) {
      if (blank instanceof HTMLElement) {
        hideBlankLine(blank);
      }
    }
    showRepeatedBlankRuns();

    const sel = window.getSelection();
    const anchorNode = sel?.anchorNode;
    const activeBlock = anchorNode ? getIndentableBlock(anchorNode) : null;
    if (!activeBlock) {
      return;
    }

    if (isBlankLineElement(activeBlock)) {
      showActiveBlankLine(activeBlock);
      return;
    }

    if (!isEmptyParagraphBlock(activeBlock)) {
      return;
    }

    const paragraphBlock = activeBlock as HTMLElement;
    let previous = paragraphBlock.previousElementSibling;
    while (isBlankLineElement(previous)) {
      showBlankLine(previous);
      previous = previous.previousElementSibling;
    }
    let next = paragraphBlock.nextElementSibling;
    while (isBlankLineElement(next)) {
      showBlankLine(next);
      next = next.nextElementSibling;
    }
  }

  function selectionStartsInBlankLine(): boolean {
    const sel = window.getSelection();
    const blank = sel?.anchorNode ? getBlankLineBlock(sel.anchorNode) : null;
    return blank !== null && blank.contentEditable !== "true";
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
    const offsets = syncSelectionFromDomMetadata()
      ? modelSelectionToOffsets(state.doc, state.selection)
      : null;
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
      const offsets = syncSelectionFromDomMetadata()
        ? modelSelectionToOffsets(state.doc, state.selection)
        : null;
      if (!offsets) return false;
      undoController.pushUndo(md, offsets.start, offsets.end);
      const { md: newMd, selStart, selEnd } = shiftIndent(md, offsets.start, offsets.end, true);
      renderSelectionAndModel(newMd, selStart, selEnd);
    } else {
      const line = Number(listItem.dataset["mdLineIndex"]);
      if (Number.isInteger(line) && state.doc.lines[line] !== undefined) {
        const column = state.doc.lines[line]!.text.length;
        state = {
          ...state,
          selection: {
            kind: "text",
            anchor: { line, column },
            focus: { line, column },
          },
        };
      } else {
        syncSelectionFromDomMetadata();
      }
      if (commitStructuralTransaction(modelDeleteEmptyListItemBackward(state))) {
        return true;
      }
      return false;
    }
    normalizeEditableContent(contentEl, { preserveActiveEmptyBlock: true });
    syncSelectionFromDomMetadata();
    cfg.onChange?.();
    return true;
  }

  function isEmptyParagraphBlock(block: HTMLElement): boolean {
    if (block.dataset["mdBlank"] === "true" || (block.tagName !== "P" && block.tagName !== "DIV")) {
      return false;
    }
    return (block.textContent ?? "").replaceAll("​", "").trim() === "";
  }

  function handleModelEnter(): boolean {
    if (!syncSelectionFromDomMetadata()) {
      return false;
    }
    return (
      commitStructuralTransaction(modelInsertListParagraph(state)) ||
      commitStructuralTransaction(modelInsertParagraph(state))
    );
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
    if (e.defaultPrevented) {
      return;
    }
    const meta = e.metaKey || e.ctrlKey;
    if (state.selection.kind === "block") {
      if (e.key === "Escape") {
        e.preventDefault();
        const block = state.doc.blocks.byId.get(state.selection.anchorBlockId);
        const offset = block ? state.doc.lineStarts[block.startLine]! : 0;
        state = { ...state, selection: offsetsToSelection(state.doc, offset, offset) };
        renderCurrentModel();
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
    if (e.key === " " || e.key === "\u00A0") {
      const text = blockTransformTextAfterInsert(e.key);
      if (text !== null && state.selection.kind === "text") {
        e.preventDefault();
        const line = state.selection.anchor.line;
        undoController.checkpoint();
        const result = replaceLineText(state, line, text, text.length);
        state = result.state;
        renderModelAfterInputTransform();
        undoController.scheduleTypingCheckpoint();
        cfg.onChange?.();
        return;
      }
    }
    if (handleArrowThroughBlankLines(e)) {
      arrowNavigationHandled = true;
      return;
    }
    if (e.key === "Backspace" && handleEmptyListItemBackspace(e)) return;
    if (e.key === "Backspace") {
      if (
        syncSelectionFromDomMetadata() &&
        (commitStructuralTransaction(modelDeleteEmptyListItemBackward(state)) ||
          commitStructuralTransaction(modelDeleteBackward(state)))
      ) {
        e.preventDefault();
        return;
      }
    }
    if (e.key === "Delete") {
      if (syncSelectionFromDomMetadata() && commitStructuralTransaction(modelDeleteForward(state))) {
        e.preventDefault();
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      if (handleModelEnter()) {
        suppressNextInsertParagraph = true;
        window.setTimeout(() => {
          suppressNextInsertParagraph = false;
        }, 0);
        e.preventDefault();
        return;
      }
    }
  }

  function onDocumentEditingKey(e: KeyboardEvent): void {
    if (e.type === "keydown") {
      arrowNavigationHandled = false;
    } else if (arrowNavigationHandled) {
      arrowNavigationHandled = false;
      return;
    }
    if (e.defaultPrevented || _isSourceMode) {
      return;
    }
    const active = document.activeElement;
    if (
      active instanceof HTMLInputElement ||
      active instanceof HTMLTextAreaElement ||
      active instanceof HTMLSelectElement
    ) {
      return;
    }
    const anchor = window.getSelection()?.anchorNode;
    if (anchor === null || anchor === undefined || !contentEl.contains(anchor)) {
      return;
    }
    if (e.type === "keydown" && (e.key === "Backspace" || e.key === "Delete")) {
      const result =
        e.key === "Backspace"
          ? syncSelectionFromDomMetadata() && commitStructuralTransaction(modelDeleteBackward(state))
          : syncSelectionFromDomMetadata() && commitStructuralTransaction(modelDeleteForward(state));
      if (result) {
        e.preventDefault();
      }
      return;
    }
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") {
      return;
    }
    if (handleArrowThroughBlankLines(e)) {
      arrowNavigationHandled = true;
    }
    if (e.type === "keyup") {
      arrowNavigationHandled = false;
    }
  }

  function onInput(): void {
    if (state.composing) {
      syncActiveLineFromDom();
      undoController.scheduleTypingCheckpoint();
      cfg.onChange?.();
      return;
    }
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
    if (!lineSynced) syncSelectionFromDomMetadata();
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
        if (replaceEmptySelectedLine(pastedText)) {
          return;
        }
        const selectionOverride = getBlockPasteSelectionOverride(pastedText);
        if (selectionOverride !== undefined || !syncSelectionFromDomMetadata()) {
          transactions.replaceSelection(pastedText, selectionOverride);
        } else {
          commitStructuralTransaction(modelReplaceSelection(state, pastedText));
        }
      }
    }
  }

  function replaceEmptySelectedLine(text: string): boolean {
    syncSelectionFromDomMetadata();
    if (state.selection.kind !== "text") {
      return false;
    }
    const { anchor, focus } = state.selection;
    if (anchor.line !== focus.line || anchor.column !== focus.column) {
      return false;
    }
    if (state.doc.lines[anchor.line]?.text !== "") {
      return false;
    }
    return commitStructuralTransaction(replaceLine(state, anchor.line, text));
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
    if (
      e.inputType === "insertText" &&
      e.data !== null &&
      state.selection.kind === "text" &&
      state.selection.anchor.line === state.selection.focus.line &&
      state.selection.anchor.column === state.selection.focus.column &&
      state.doc.lines[state.selection.anchor.line]?.text === ""
    ) {
      e.preventDefault();
      replaceEmptySelectedLineInput(e.data);
      return;
    }
    if (e.inputType === "insertText" && e.data !== null) {
      const leadingSpaceText = leadingSpaceTextAfterInsert(e.data);
      if (leadingSpaceText !== null) {
        e.preventDefault();
        const result = replaceLineText(
          state,
          leadingSpaceText.line,
          leadingSpaceText.text,
          leadingSpaceText.text.length,
        );
        state = result.state;
        renderPlainLineHost(leadingSpaceText.line, leadingSpaceText.text);
        undoController.scheduleTypingCheckpoint();
        cfg.onChange?.();
        return;
      }
      const plainMarkerText = plainMarkerPrefixTextAfterInsert(e.data);
      if (plainMarkerText !== null && state.selection.kind === "text") {
        e.preventDefault();
        const line = state.selection.anchor.line;
        const result = replaceLineText(state, line, plainMarkerText);
        state = result.state;
        renderPlainLineHost(line, plainMarkerText);
        undoController.scheduleTypingCheckpoint();
        cfg.onChange?.();
        return;
      }
      const text = blockTransformTextAfterInsert(e.data);
      if (text !== null && state.selection.kind === "text") {
        e.preventDefault();
        const line = state.selection.anchor.line;
        undoController.checkpoint();
        const result = replaceLineText(state, line, text, text.length);
        state = result.state;
        renderModelAfterInputTransform();
        undoController.scheduleTypingCheckpoint();
        cfg.onChange?.();
        return;
      }
    }
    if (e.inputType === "insertParagraph") {
      if (suppressNextInsertParagraph) {
        suppressNextInsertParagraph = false;
        e.preventDefault();
        return;
      }
      if (handleModelEnter()) {
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
    syncSelectionFromDomMetadata();
  }

  function onCompositionStart(): void {
    state = { ...state, composing: true };
  }

  function onCompositionEnd(): void {
    state = { ...state, composing: false };
    syncActiveLineFromDom();
    renderModelAfterInputTransform();
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
    const sourceElement = drag.image.closest("[data-md-source-start]");
    const sourceStart =
      sourceElement instanceof HTMLElement ? sourceBoundary(sourceElement, "mdSourceStart") : null;
    const sourceEnd =
      sourceElement instanceof HTMLElement ? sourceBoundary(sourceElement, "mdSourceEnd") : null;
    if (sourceStart === null || sourceEnd === null || !drag.image.dataset["wikiImage"]) {
      return;
    }
    replaceMarkdownRange(
      sourceStart,
      sourceEnd,
      `![[${drag.image.dataset["wikiImage"]}|${drag.image.getAttribute("width") ?? imageWidth(drag.image)}]]`,
    );
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
  window.addEventListener("keydown", onDocumentEditingKey, true);
  window.addEventListener("keyup", onDocumentEditingKey, true);
  document.addEventListener("pointermove", onDocumentPointerMove);
  document.addEventListener("pointerup", endImageResize);
  document.addEventListener("pointercancel", endImageResize);
  sourceEl.addEventListener("input", onSourceInput);
  sourceEl.addEventListener("keydown", onSourceKeyDown);

  // ── Source mode ─────────────────────────────────────────────────────────────

  function toggleSourceMode(): void {
    if (_isSourceMode) {
      syncModelFromSource();
      _isSourceMode = false;
      state = { ...state, sourceMode: false };
      sourceEl.style.display = "none";
      contentEl.style.display = "";
      renderCurrentModel();
    } else {
      if (!syncActiveLineFromDom()) {
        syncSelectionFromDomMetadata();
      }
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

  function focus(): void {
    if (_isSourceMode) {
      sourceEl.focus();
      return;
    }
    contentEl.focus();
    restoreDomSelectionFromModel();
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
    window.removeEventListener("keydown", onDocumentEditingKey, true);
    window.removeEventListener("keyup", onDocumentEditingKey, true);
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
    focus,
    setConfig,
    get isSourceMode() {
      return _isSourceMode;
    },
    contentEl,
    sourceEl,
    destroy,
  };
}
