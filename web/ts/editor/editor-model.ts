import { CODE_FENCE_MARKER_LENGTH, MAX_HEADING_LEVEL } from "./constants.js";
import type { BlockKind } from "./extension.js";

export type EditorState = {
  doc: EditorDoc;
  selection: EditorSelection;
  revision: number;
  composing: boolean;
  sourceMode: boolean;
};

export type EditorDoc = {
  lines: EditorLine[];
  lineStarts: number[];
  blocks: BlockIndex;
};

type EditorLine = {
  id: string;
  text: string;
};

export type BlankLineRole = "separator" | "editable";

export type LogicalPosition = {
  line: number;
  column: number;
};

export type TextSelection = {
  kind: "text";
  anchor: LogicalPosition;
  focus: LogicalPosition;
};

type BlockSelection = {
  kind: "block";
  anchorBlockId: string;
  focusBlockId: string;
};

type VoidSelection = {
  kind: "void";
  blockId: string;
  line: number;
};

export type EditorSelection = TextSelection | BlockSelection | VoidSelection;

export type SelectionOffsets = {
  start: number;
  end: number;
};

type BlockIndex = {
  blocks: EditorBlock[];
  byId: Map<string, EditorBlock>;
  byLine: EditorBlockRef[];
};

export type EditorBlock = {
  id: string;
  kind: BlockKind;
  startLine: number;
  endLine: number;
  editable: boolean;
};

type EditorBlockRef = {
  blockId: string;
  role: "content" | "blank" | "continuation";
  blankRole?: BlankLineRole;
};

export type TransactionResult = {
  state: EditorState;
  changed: boolean;
  renderHint: RenderHint;
};

export type RenderHint =
  | { kind: "none" }
  | { kind: "lines"; startLine: number; endLine: number }
  | { kind: "blocks"; blockIds: string[] }
  | { kind: "full" };

let nextId = 1;

function createId(prefix: string): string {
  const id = `${prefix}-${nextId}`;
  nextId += 1;
  return id;
}

export function normalizeMarkdownNewlines(md: string): string {
  return md.replace(/\r\n?/g, "\n");
}

export function markdownToDoc(md: string): EditorDoc {
  const normalized = normalizeMarkdownNewlines(md);
  const rawLines = normalized === "" ? [""] : normalized.split("\n");
  const lines = rawLines.map((text) => ({ id: createId("line"), text }));
  return buildDoc(lines);
}

export function docToMarkdown(doc: EditorDoc): string {
  return doc.lines.map((line) => line.text).join("\n");
}

function buildDoc(lines: EditorLine[]): EditorDoc {
  const safeLines = lines.length === 0 ? [{ id: createId("line"), text: "" }] : lines;
  const lineStarts = deriveLineStarts(safeLines);
  const blocks = deriveBlockIndex(safeLines);
  return { lines: safeLines, lineStarts, blocks };
}

function clampPosition(doc: EditorDoc, pos: LogicalPosition): LogicalPosition {
  const line = Math.min(Math.max(0, pos.line), doc.lines.length - 1);
  const column = Math.min(Math.max(0, pos.column), doc.lines[line]!.text.length);
  return { line, column };
}

export function positionToOffset(doc: EditorDoc, pos: LogicalPosition): number {
  const clamped = clampPosition(doc, pos);
  return doc.lineStarts[clamped.line]! + clamped.column;
}

export function offsetToPosition(doc: EditorDoc, offset: number): LogicalPosition {
  const markdownLength = docToMarkdown(doc).length;
  const clamped = Math.min(Math.max(0, offset), markdownLength);
  let low = 0;
  let high = doc.lineStarts.length - 1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const start = doc.lineStarts[mid]!;
    const next = mid + 1 < doc.lineStarts.length ? doc.lineStarts[mid + 1]! : markdownLength + 1;
    if (clamped < start) {
      high = mid - 1;
    } else if (clamped >= next) {
      low = mid + 1;
    } else {
      return { line: mid, column: Math.min(clamped - start, doc.lines[mid]!.text.length) };
    }
  }
  const lastLine = doc.lines.length - 1;
  return { line: lastLine, column: doc.lines[lastLine]!.text.length };
}

export function selectionToOffsets(
  doc: EditorDoc,
  selection: EditorSelection,
): SelectionOffsets | null {
  if (selection.kind === "void") {
    return null;
  }
  if (selection.kind === "text") {
    const anchor = positionToOffset(doc, selection.anchor);
    const focus = positionToOffset(doc, selection.focus);
    return { start: Math.min(anchor, focus), end: Math.max(anchor, focus) };
  }

  const anchor = doc.blocks.byId.get(selection.anchorBlockId);
  const focus = doc.blocks.byId.get(selection.focusBlockId);
  if (!anchor || !focus) {
    return null;
  }
  const startBlock = anchor.startLine <= focus.startLine ? anchor : focus;
  const endBlock = anchor.startLine <= focus.startLine ? focus : anchor;
  const start = positionToOffset(doc, { line: startBlock.startLine, column: 0 });
  const end =
    endBlock.endLine >= doc.lines.length
      ? docToMarkdown(doc).length
      : positionToOffset(doc, { line: endBlock.endLine, column: 0 });
  return { start, end };
}

export function offsetsToSelection(doc: EditorDoc, start: number, end: number): TextSelection {
  return {
    kind: "text",
    anchor: offsetToPosition(doc, start),
    focus: offsetToPosition(doc, end),
  };
}

export function createTextSelection(
  doc: EditorDoc,
  anchorOffset: number,
  focusOffset = anchorOffset,
): TextSelection {
  return offsetsToSelection(doc, anchorOffset, focusOffset);
}

export function replaceSelection(
  state: EditorState,
  text: string,
  renderHint: RenderHint = { kind: "full" },
): TransactionResult {
  const offsets = selectionToOffsets(state.doc, state.selection);
  if (offsets === null) {
    return unchanged(state);
  }
  return replaceRange(state, offsets.start, offsets.end, text, renderHint);
}

export function insertText(state: EditorState, text: string): TransactionResult {
  return replaceSelection(state, normalizeMarkdownNewlines(text));
}

export function insertParagraph(state: EditorState): TransactionResult {
  return replaceSelection(state, "\n");
}

export function insertListParagraph(state: EditorState): TransactionResult {
  if (state.selection.kind !== "text") {
    return unchanged(state);
  }
  const { anchor, focus } = state.selection;
  if (anchor.line !== focus.line || anchor.column !== focus.column) {
    return unchanged(state);
  }
  const line = state.doc.lines[anchor.line];
  if (!line) {
    return unchanged(state);
  }
  const parsed = parseListLine(line.text);
  if (!parsed) {
    return unchanged(state);
  }
  if (parsed.content === "") {
    const start = positionToOffset(state.doc, { line: anchor.line, column: 0 });
    const end = positionToOffset(state.doc, { line: anchor.line, column: line.text.length });
    return replaceRange(state, start, end, "");
  }
  if (anchor.column !== line.text.length) {
    return unchanged(state);
  }
  const nextMarker = parsed.ordered
    ? `${parsed.indent}${parsed.number + 1}. `
    : parsed.taskMarker === null
      ? `${parsed.indent}${parsed.marker} `
      : `${parsed.indent}${parsed.marker} [ ] `;
  return replaceSelection(state, `\n${nextMarker}`);
}

export function deleteBackward(state: EditorState): TransactionResult {
  const offsets = selectionToOffsets(state.doc, state.selection);
  if (offsets === null) {
    return unchanged(state);
  }
  if (offsets.start !== offsets.end) {
    return replaceRange(state, offsets.start, offsets.end, "");
  }
  if (offsets.start === 0) {
    return unchanged(state);
  }
  return replaceRange(state, offsets.start - 1, offsets.start, "");
}

export function deleteForward(state: EditorState): TransactionResult {
  const offsets = selectionToOffsets(state.doc, state.selection);
  if (offsets === null) {
    return unchanged(state);
  }
  if (offsets.start !== offsets.end) {
    return replaceRange(state, offsets.start, offsets.end, "");
  }
  const md = docToMarkdown(state.doc);
  if (offsets.start >= md.length) {
    return unchanged(state);
  }
  return replaceRange(state, offsets.start, offsets.start + 1, "");
}

export function deleteEmptyListItemBackward(state: EditorState): TransactionResult {
  if (state.selection.kind !== "text") {
    return unchanged(state);
  }
  const { anchor, focus } = state.selection;
  if (anchor.line !== focus.line || anchor.column !== focus.column) {
    return unchanged(state);
  }
  const line = state.doc.lines[anchor.line];
  if (!line) {
    return unchanged(state);
  }
  const parsed = parseListLine(line.text);
  if (!parsed || parsed.content !== "") {
    return unchanged(state);
  }
  const start = positionToOffset(state.doc, { line: anchor.line, column: 0 });
  const end =
    anchor.line + 1 < state.doc.lines.length
      ? positionToOffset(state.doc, { line: anchor.line + 1, column: 0 })
      : docToMarkdown(state.doc).length;
  return replaceRange(state, start, end, "");
}

export function replaceLineText(
  state: EditorState,
  lineIndex: number,
  text: string,
  column = text.length,
): TransactionResult {
  if (lineIndex < 0 || lineIndex >= state.doc.lines.length) {
    return unchanged(state);
  }
  const line = state.doc.lines[lineIndex]!;
  if (line.text === text) {
    const selection = {
      kind: "text",
      anchor: { line: lineIndex, column },
      focus: { line: lineIndex, column },
    } satisfies TextSelection;
    return { state: { ...state, selection }, changed: false, renderHint: { kind: "none" } };
  }
  const lines = state.doc.lines.map((existing, index) =>
    index === lineIndex ? { ...existing, text } : existing,
  );
  const doc = buildDoc(lines);
  const selection = {
    kind: "text",
    anchor: { line: lineIndex, column },
    focus: { line: lineIndex, column },
  } satisfies TextSelection;
  return {
    state: {
      ...state,
      doc,
      selection,
      revision: state.revision + 1,
    },
    changed: true,
    renderHint: { kind: "lines", startLine: lineIndex, endLine: lineIndex + 1 },
  };
}

export function replaceLine(
  state: EditorState,
  lineIndex: number,
  text: string,
): TransactionResult {
  if (lineIndex < 0 || lineIndex >= state.doc.lines.length) {
    return unchanged(state);
  }
  const line = state.doc.lines[lineIndex]!;
  const start = positionToOffset(state.doc, { line: lineIndex, column: 0 });
  const end = positionToOffset(state.doc, { line: lineIndex, column: line.text.length });
  return replaceRange(state, start, end, text);
}

function replaceRange(
  state: EditorState,
  start: number,
  end: number,
  text: string,
  renderHint: RenderHint = { kind: "full" },
): TransactionResult {
  const md = docToMarkdown(state.doc);
  const safeStart = Math.min(Math.max(0, start), md.length);
  const safeEnd = Math.min(Math.max(safeStart, end), md.length);
  const replacement = normalizeMarkdownNewlines(text);
  const nextMd = md.slice(0, safeStart) + replacement + md.slice(safeEnd);
  if (nextMd === md && safeStart === safeEnd) {
    return unchanged(state);
  }
  const doc = markdownToDoc(nextMd);
  const cursor = safeStart + replacement.length;
  return {
    state: {
      ...state,
      doc,
      selection: createTextSelection(doc, cursor),
      revision: state.revision + 1,
    },
    changed: true,
    renderHint,
  };
}

function unchanged(state: EditorState): TransactionResult {
  return { state, changed: false, renderHint: { kind: "none" } };
}

type ParsedListLine = {
  indent: string;
  marker: string;
  ordered: boolean;
  number: number;
  taskMarker: string | null;
  content: string;
};

function parseListLine(line: string): ParsedListLine | null {
  const match = line.match(/^([ \t]*)([-*+]|\d+\.)(?:\s(.*))?$/);
  if (!match) {
    return null;
  }
  const marker = match[2]!;
  if ((marker === "*" || marker === "+") && match[3] === undefined) {
    return null;
  }
  const orderedMatch = marker.match(/^(\d+)\.$/);
  let content = match[3] ?? "";
  let taskMarker: string | null = null;
  const taskMatch = content.match(/^\[([ xX])\](?:\s(.*))?$/);
  if (taskMatch) {
    taskMarker = taskMatch[1]!;
    content = taskMatch[2] ?? "";
  }
  return {
    indent: match[1]!,
    marker,
    ordered: orderedMatch !== null,
    number: orderedMatch ? Number(orderedMatch[1]) : 0,
    taskMarker,
    content,
  };
}

function deriveLineStarts(lines: readonly EditorLine[]): number[] {
  const starts: number[] = [];
  let offset = 0;
  for (const line of lines) {
    starts.push(offset);
    offset += line.text.length + 1;
  }
  return starts;
}

function deriveBlockIndex(lines: readonly EditorLine[]): BlockIndex {
  const blocks: EditorBlock[] = [];
  const byId = new Map<string, EditorBlock>();
  const byLine: EditorBlockRef[] = [];

  function addBlock(
    kind: BlockKind,
    startLine: number,
    endLine: number,
    editable = true,
    blankRoles: readonly BlankLineRole[] = [],
  ): void {
    const block: EditorBlock = {
      id: createId("block"),
      kind,
      startLine,
      endLine,
      editable,
    };
    blocks.push(block);
    byId.set(block.id, block);
    for (let line = startLine; line < endLine; line++) {
      const role = kind === "blank" ? "blank" : line === startLine ? "content" : "continuation";
      const ref: EditorBlockRef = {
        blockId: block.id,
        role,
      };
      if (role === "blank") {
        ref.blankRole = blankRoles[line - startLine] ?? "editable";
      }
      byLine[line] = ref;
    }
  }

  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!.text;
    if (line.trim() === "") {
      const start = i;
      while (i < lines.length && lines[i]!.text.trim() === "") {
        i += 1;
      }
      addBlock("blank", start, i, true, classifyBlankRun(lines, start, i));
      continue;
    }

    const codeFence = line.match(new RegExp(`^([\\\`~]{${CODE_FENCE_MARKER_LENGTH},})`));
    if (codeFence) {
      const start = i;
      const fence = codeFence[1]!;
      i += 1;
      while (i < lines.length && !lines[i]!.text.startsWith(fence.charAt(0).repeat(fence.length))) {
        i += 1;
      }
      if (i < lines.length) {
        i += 1;
      }
      addBlock("code", start, i);
      continue;
    }

    if (new RegExp(`^#{1,${MAX_HEADING_LEVEL}}\\s+`).test(line)) {
      addBlock("heading", i, i + 1);
      i += 1;
      continue;
    }

    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      addBlock("hr", i, i + 1, false);
      i += 1;
      continue;
    }

    if (isTableStart(lines, i)) {
      const start = i;
      i += 2;
      while (i < lines.length && lines[i]!.text.trimStart().startsWith("|")) {
        i += 1;
      }
      addBlock("table", start, i);
      continue;
    }

    if (isListStart(line)) {
      const start = i;
      i += 1;
      while (
        i < lines.length &&
        lines[i]!.text.trim() !== "" &&
        (isListStart(lines[i]!.text) || /^\s+/.test(lines[i]!.text))
      ) {
        i += 1;
      }
      addBlock("list", start, i);
      continue;
    }

    if (line.startsWith(">")) {
      const start = i;
      i += 1;
      while (i < lines.length && lines[i]!.text.startsWith(">")) {
        i += 1;
      }
      addBlock("blockquote", start, i);
      continue;
    }

    const start = i;
    i += 1;
    while (i < lines.length && lines[i]!.text.trim() !== "" && !isSpecialBlockStart(lines, i)) {
      i += 1;
    }
    addBlock("paragraph", start, i);
  }

  return { blocks, byId, byLine };
}

function classifyBlankRun(
  lines: readonly EditorLine[],
  startLine: number,
  endLine: number,
): BlankLineRole[] {
  const roles = new Array<BlankLineRole>(endLine - startLine).fill("editable");
  const betweenContent =
    startLine > 0 &&
    endLine < lines.length &&
    lines[startLine - 1]!.text.trim() !== "" &&
    lines[endLine]!.text.trim() !== "";
  if (betweenContent && roles.length > 0) {
    roles[0] = "separator";
  }
  return roles;
}

function isListStart(line: string): boolean {
  return (
    /^[ \t]*([-+]|\d+\.)(?:\s|$)/.test(line) ||
    /^[ \t]*\*\s/.test(line) ||
    /^[ \t]*\[[ xX]\](?:\s|$)/.test(line)
  );
}

function isTableStart(lines: readonly EditorLine[], index: number): boolean {
  return (
    lines[index]!.text.trimStart().startsWith("|") &&
    index + 1 < lines.length &&
    /^\|?[\s:]*-+[\s:]*(\|[\s:]*-+[\s:]*)*\|?\s*$/.test(lines[index + 1]!.text)
  );
}

function isSpecialBlockStart(lines: readonly EditorLine[], index: number): boolean {
  const line = lines[index]!.text;
  return (
    new RegExp(`^([\\\`~]{${CODE_FENCE_MARKER_LENGTH},}|#{1,${MAX_HEADING_LEVEL}}\\s+)`).test(
      line,
    ) ||
    /^(-{3,}|\*{3,}|_{3,})\s*$/.test(line) ||
    isTableStart(lines, index) ||
    isListStart(line) ||
    line.startsWith(">")
  );
}
