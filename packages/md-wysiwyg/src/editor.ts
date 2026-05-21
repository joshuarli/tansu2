/// WYSIWYG editor wiring layer. Creates DOM, manages undo stack, routes keyboard
/// events, and handles image paste. All markdown-specific behavior is delegated to
/// the render/serialize/transform modules; callers configure extensions and callbacks.

import { LIST_INDENT_SPACES } from "./constants.js";
import { normalizeEditableContent } from "./editor-normalize.js";
import { createEditorRenderer } from "./editor-renderer.js";
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

  // ── getValue / setValue ─────────────────────────────────────────────────────

  function getValue(): string {
    return _isSourceMode ? sourceEl.value : domToMarkdown(contentEl, { extensions });
  }

  function setValue(md: string, cursorOffset?: number): void {
    if (_isSourceMode) {
      sourceEl.value = md;
    } else if (cursorOffset !== undefined) {
      renderer.renderWithCursor(md, cursorOffset);
      selection.restoreCursorMarker();
      const activeBlock = getIndentableBlock(window.getSelection()?.anchorNode ?? contentEl);
      if (activeBlock && isEmptyParagraphBlock(activeBlock)) {
        ensureEmptyParagraphPlaceholder(activeBlock);
        placeCursorAtBlockStart(activeBlock);
      }
      updateActiveBlankVisibility();
    } else {
      renderer.render(md);
    }
    const sel = selection.getSelectionOffsets();
    undoController.pushUndo(md, sel?.start ?? 0, sel?.end ?? 0);
  }

  const undoController = createEditorUndoController({
    getValue,
    getSelectionOffsets: selection.getSelectionOffsets,
    renderSelection: renderer.renderWithSelection,
    restoreSelection: selection.restoreSelectionFromRenderedMarkers,
    getUndoStackMax: () => cfg.undoStackMax ?? 200,
    getTypingCheckpointMs: () => cfg.typingCheckpointMs ?? 1000,
    ...(cfg.onChange ? { onChange: cfg.onChange } : {}),
  });

  const transactions = createSelectionTransactionController({
    getValue,
    getSelectionOffsets: selection.getSelectionOffsets,
    pushUndo: undoController.pushUndo,
    checkpoint: undoController.checkpoint,
    renderSelection: renderer.renderWithSelection,
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
    if (parentList.children.length === 0) {
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
      renderer.renderWithSelection(newMd, selStart, selEnd);
      selection.restoreSelectionFromRenderedMarkers();
    } else {
      removeEmptyTopLevelListItem(listItem);
    }
    normalizeEditableContent(contentEl, { preserveActiveEmptyBlock: true });
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
      moveCursorIntoBlankLine(previous, isEmptyParagraphBlock(activeBlock) ? activeBlock : undefined);
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
    if (checkBlockInputTransform(contentEl)) {
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
          document.execCommand("insertHTML", false, html);
          cfg.onChange?.();
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
      transactions.replaceSelection(pastedText, getBlockPasteSelectionOverride(pastedText));
    }
  }

  function onBeforeInput(e: InputEvent): void {
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

  function onContentPointerDown(e: PointerEvent): void {
    const blank = getBlankLineBlock(e.target instanceof Node ? e.target : null);
    if (!blank) return;
    e.preventDefault();
    placeCursorNearBlankLine(blank);
  }

  function onSourceInput(): void {
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
  contentEl.addEventListener("paste", onContentPaste);
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
      const md = sourceEl.value;
      renderer.render(md);
      _isSourceMode = false;
      sourceEl.style.display = "none";
      contentEl.style.display = "";
    } else {
      sourceEl.value = getValue();
      _isSourceMode = true;
      contentEl.style.display = "none";
      sourceEl.style.display = "";
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
    contentEl.removeEventListener("paste", onContentPaste);
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
    setValue,
    getSelectionOffsets: selection.getSelectionOffsets,
    getCursorOffset: selection.getCursorOffset,
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
