# Visual Editor TODO

This file tracks the remaining model-owned editor gaps that were still open
after the initial rewrite. `OPTIMIZATIONS.md` covers the separate post-rewrite
latency roadmap.

## Tranche 1: Browser Acceptance Hardening

Goal: user-visible editor behavior must be covered by browser acceptance tests,
not only saved Markdown, DOM text, or sentinel counts.

- [x] `foo`, Enter, Enter, `bar` shows a real blank line between `foo` and
  `bar`, with saved Markdown `foo\n\nbar`.
- [x] `foo`, Enter, Enter places the visual cursor two rendered line positions
  below `foo`, not one.
- [x] Immediate typing after Enter asserts cursor geometry and saved Markdown,
  not only that `bar` appears somewhere in the DOM.
- [x] Repeated blank lines across autosave assert rendered blank-lane geometry,
  not only visible sentinel counts.
- [x] ArrowUp/ArrowDown through blank lanes assert logical cursor line and
  rendered geometry, not exact wrapper arrays.
- [x] Source-mode round trip around repeated blank lines is covered in the real
  browser harness.

## Tranche 2: Structural Editing Coverage

Goal: structural editing should be model-owned and acceptance-tested across the
Markdown surface the app exposes.

- [ ] Enter at start, middle, and end of a paragraph has model and cursor
  acceptance coverage.
- [ ] Backspace/Delete behavior across normal and blank lines has browser
  acceptance coverage.
- [ ] Block input transforms are complete for headings, unordered/ordered lists,
  tasks, blockquotes, code fences, and horizontal rules.
- [ ] Block transforms have browser acceptance coverage proving model Markdown
  and visible cursor placement.
- [ ] Paste of multiline plain text and sanitized HTML preserves blank lines in
  browser acceptance.

## Tranche 3: Markdown Surface And Extensions

Goal: the supported Markdown constructs should be safe in the visual editor, not
only in standalone render/serialize tests.

- [ ] Lists can be created, split, indented, dedented, exited, undone, and
  redone.
- [ ] Task lists preserve checkbox state and source Markdown.
- [ ] Code fences preserve internal blank lines.
- [ ] Blockquotes and callouts preserve source content and blank lines.
- [ ] Tables are rendered and copied without corrupting Markdown.
- [ ] Regular links, wiki links, regular images, and wiki images preserve source
  offsets or use explicit atomic fallback behavior.
- [ ] Image paste inserts model Markdown and image resize updates model
  Markdown.

## Tranche 4: Block Gutter Selection

Goal: block selection should operate on exact Markdown source spans across the
main block kinds.

- [ ] Gutter selection copies exact Markdown for heading, paragraph, list, code,
  table, blockquote/callout, image, and blank-run blocks.
- [ ] Shift-click selects a contiguous block range and copies exact Markdown.
- [ ] Delete selected block, undo, and redo are covered.
- [ ] Typing while a block is selected replaces the selected source span.
- [ ] Escape from block selection places the cursor at the start of the first
  selected block.
- [ ] Keyboard focus on handles exposes an accessible `Select block` name.

## Tranche 5: Undo, Redo, And Cursor Fidelity

Goal: undo/redo should restore exact Markdown and logical selection after
typing, formatting, and structural edits.

- [ ] Undo after typing restores Markdown and cursor.
- [ ] Undo after Enter/Backspace/Delete restores Markdown and cursor.
- [ ] Redo after structural edits restores Markdown and cursor.
- [ ] Undo/redo around blank cursor hosts preserves visible blank-lane geometry.
- [ ] Source-mode checkpoints do not diverge from visual undo expectations.

## Tranche 6: Documentation Cleanup

Goal: docs should describe the implementation, not the old staged plan.

- [ ] `packages/md-wysiwyg/docs/architecture.md` reflects the final editor
  architecture and current limitations.
- [ ] README wording matches the model-owned visual editor and no longer implies
  DOM-owned transforms.
- [ ] Test names describe behavior rather than implementation details.
- [ ] Any intentionally deferred item links to this TODO or `OPTIMIZATIONS.md`.
