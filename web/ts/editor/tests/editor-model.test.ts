import { expect, describe, it } from 'vitest';
import {
  createTextSelection,
  deleteBackward,
  deleteEmptyListItemBackward,
  deleteForward,
  docToMarkdown,
  insertParagraph,
  insertListParagraph,
  insertText,
  markdownToDoc,
  offsetToPosition,
  offsetsToSelection,
  positionToOffset,
  replaceLineText,
  replaceSelection,
  selectionToOffsets,
  type EditorState,
} from "../editor-model.ts";

describe("editor model", () => {
  it.each([
    ["", [""]],
    ["\n", ["", ""]],
    ["\n\n", ["", "", ""]],
    ["foo", ["foo"]],
    ["foo\n", ["foo", ""]],
    ["foo\n\n", ["foo", "", ""]],
    ["foo\nbar", ["foo", "bar"]],
    ["foo\n\nbar", ["foo", "", "bar"]],
    ["foo\n\n\nbar", ["foo", "", "", "bar"]],
    ["\nfoo", ["", "foo"]],
    ["\n\nfoo", ["", "", "foo"]],
    ["foo\n\nbar\n\n", ["foo", "", "bar", "", ""]],
  ])("preserves markdown lines for %j", (md, expectedLines) => {
    const doc = markdownToDoc(md);
    expect(doc.lines.map((line) => line.text)).toStrictEqual(expectedLines);
    expect(docToMarkdown(doc)).toBe(md);
  });

  it("normalizes CRLF and CR before entering the model", () => {
    const doc = markdownToDoc("a\r\nb\rc");
    expect(doc.lines.map((line) => line.text)).toStrictEqual(["a", "b", "c"]);
    expect(docToMarkdown(doc)).toBe("a\nb\nc");
  });

  it("maps positions and offsets across repeated blank lines", () => {
    const doc = markdownToDoc("foo\n\n\nbar");

    expect(positionToOffset(doc, { line: 0, column: 3 })).toBe(3);
    expect(positionToOffset(doc, { line: 1, column: 0 })).toBe(4);
    expect(positionToOffset(doc, { line: 2, column: 0 })).toBe(5);
    expect(positionToOffset(doc, { line: 3, column: 0 })).toBe(6);

    expect(offsetToPosition(doc, 4)).toStrictEqual({ line: 1, column: 0 });
    expect(offsetToPosition(doc, 5)).toStrictEqual({ line: 2, column: 0 });
    expect(offsetToPosition(doc, 6)).toStrictEqual({ line: 3, column: 0 });
  });

  it("clamps positions and offsets to valid text locations", () => {
    const doc = markdownToDoc("foo\nbar");

    expect(positionToOffset(doc, { line: 0, column: 99 })).toBe(3);
    expect(positionToOffset(doc, { line: 99, column: 99 })).toBe(7);
    expect(offsetToPosition(doc, -10)).toStrictEqual({ line: 0, column: 0 });
    expect(offsetToPosition(doc, 99)).toStrictEqual({ line: 1, column: 3 });
  });

  it("converts text selections to markdown offsets", () => {
    const doc = markdownToDoc("foo\nbar");
    const selection = createTextSelection(doc, 1, 6);

    expect(selectionToOffsets(doc, selection)).toStrictEqual({ start: 1, end: 6 });
    expect(offsetsToSelection(doc, 1, 6)).toStrictEqual({
      kind: "text",
      anchor: { line: 0, column: 1 },
      focus: { line: 1, column: 2 },
    });
  });

  it("derives block kinds and line references", () => {
    const doc = markdownToDoc(
      [
        "# Heading",
        "",
        "paragraph",
        "",
        "",
        "- one",
        "  - nested",
        "- [x] done",
        "",
        "```ts",
        "const x = 1;",
        "```",
        "",
        "| A |",
        "| - |",
        "| B |",
        "",
        "> [!note]",
        "> callout",
        "",
        "[ ] bare task",
      ].join("\n"),
    );

    expect(doc.blocks.blocks.map((block) => block.kind)).toStrictEqual([
      "heading",
      "blank",
      "paragraph",
      "blank",
      "list",
      "blank",
      "code",
      "blank",
      "table",
      "blank",
      "blockquote",
      "blank",
      "list",
    ]);
    expect(doc.blocks.byLine[4]?.role).toBe("blank");
    expect(doc.blocks.byLine[1]?.blankRole).toBe("separator");
    expect(doc.blocks.byLine[3]?.blankRole).toBe("separator");
    expect(doc.blocks.byLine[4]?.blankRole).toBe("editable");
    expect(doc.blocks.byLine[6]?.role).toBe("continuation");
    expect(doc.blocks.byLine[11]?.role).toBe("continuation");
  });

  it("converts block selections to source spans", () => {
    const doc = markdownToDoc("foo\n\nbar\nbaz");
    const first = doc.blocks.blocks[0]!;
    const second = doc.blocks.blocks[1]!;
    const third = doc.blocks.blocks[2]!;

    expect(
      selectionToOffsets(doc, {
        kind: "block",
        anchorBlockId: first.id,
        focusBlockId: second.id,
      }),
    ).toStrictEqual({ start: 0, end: 5 });
    expect(
      selectionToOffsets(doc, {
        kind: "block",
        anchorBlockId: third.id,
        focusBlockId: third.id,
      }),
    ).toStrictEqual({ start: 5, end: 12 });
  });

  it("inserts text through a text selection and preserves pasted blank lines", () => {
    const state = stateFrom("foo\nbar", 3);

    const result = insertText(state, "\n\nx");

    expect(result.changed).toBeTruthy();
    expect(docToMarkdown(result.state.doc)).toBe("foo\n\nx\nbar");
    expect(selectionToOffsets(result.state.doc, result.state.selection)).toStrictEqual({
      start: 6,
      end: 6,
    });
  });

  it("replaces a range selection with inserted text", () => {
    const doc = markdownToDoc("hello world");
    const state = {
      doc,
      selection: createTextSelection(doc, 6, 11),
      revision: 0,
      composing: false,
      sourceMode: false,
    } satisfies EditorState;

    const result = replaceSelection(state, "there");

    expect(docToMarkdown(result.state.doc)).toBe("hello there");
    expect(selectionToOffsets(result.state.doc, result.state.selection)).toStrictEqual({
      start: 11,
      end: 11,
    });
  });

  it("inserts paragraphs as exact line boundaries", () => {
    let state = stateFrom("foo", 3);

    state = insertParagraph(state).state;
    state = insertParagraph(state).state;

    expect(docToMarkdown(state.doc)).toBe("foo\n\n");
    expect(state.doc.lines.map((line) => line.text)).toStrictEqual(["foo", "", ""]);
  });

  it("continues unordered, ordered, and task list lines", () => {
    let state = stateFrom("- foo", 5);
    state = insertListParagraph(state).state;
    expect(docToMarkdown(state.doc)).toBe("- foo\n- ");

    state = stateFrom("1. foo", 6);
    state = insertListParagraph(state).state;
    expect(docToMarkdown(state.doc)).toBe("1. foo\n2. ");

    state = stateFrom("- [x] done", 10);
    state = insertListParagraph(state).state;
    expect(docToMarkdown(state.doc)).toBe("- [x] done\n- [ ] ");
  });

  it("exits an empty top-level list line", () => {
    const state = insertListParagraph(stateFrom("- ", 2)).state;

    expect(docToMarkdown(state.doc)).toBe("");
    expect(state.doc.lines.map((line) => line.text)).toStrictEqual([""]);
  });

  it("deletes an empty list item on Backspace", () => {
    let state = deleteEmptyListItemBackward(stateFrom("- [ ] \nnext", 6)).state;
    expect(docToMarkdown(state.doc)).toBe("next");

    state = deleteEmptyListItemBackward(stateFrom("before\n- ", 9)).state;
    expect(docToMarkdown(state.doc)).toBe("before\n");
  });

  it("deletes backward and forward across repeated blank lines one boundary at a time", () => {
    let state = stateFrom("foo\n\n\nbar", 6);

    state = deleteBackward(state).state;
    expect(docToMarkdown(state.doc)).toBe("foo\n\nbar");

    state = deleteForward(state).state;
    expect(docToMarkdown(state.doc)).toBe("foo\n\nar");
  });

  it("replaces block selections through the same source-span transaction", () => {
    const doc = markdownToDoc("foo\n\nbar");
    const first = doc.blocks.blocks[0]!;
    const second = doc.blocks.blocks[1]!;
    const state = {
      doc,
      selection: { kind: "block", anchorBlockId: first.id, focusBlockId: second.id },
      revision: 0,
      composing: false,
      sourceMode: false,
    } satisfies EditorState;

    const result = replaceSelection(state, "x\n");

    expect(docToMarkdown(result.state.doc)).toBe("x\nbar");
    expect(selectionToOffsets(result.state.doc, result.state.selection)).toStrictEqual({
      start: 2,
      end: 2,
    });
  });

  it("updates a single line while preserving newline structure", () => {
    const state = stateFrom("foo\n\nbar", 0);

    const result = replaceLineText(state, 1, "middle", 6);

    expect(result.renderHint).toStrictEqual({ kind: "lines", startLine: 1, endLine: 2 });
    expect(docToMarkdown(result.state.doc)).toBe("foo\nmiddle\nbar");
    expect(selectionToOffsets(result.state.doc, result.state.selection)).toStrictEqual({
      start: 10,
      end: 10,
    });
  });
});

function stateFrom(md: string, offset: number): EditorState {
  const doc = markdownToDoc(md);
  return {
    doc,
    selection: createTextSelection(doc, offset),
    revision: 0,
    composing: false,
    sourceMode: false,
  };
}
