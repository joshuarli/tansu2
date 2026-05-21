# Visual Editor Rewrite Plan

## Executive Summary

The current visual editor has reached the limit of a DOM-owned design. It tries
to preserve Markdown newlines, blank-line visibility, selection offsets,
autosave drafts, undo checkpoints, source-mode toggles, block transforms, and
inline transforms by reading and rewriting the live `contenteditable` DOM. The
recent newline regressions are symptoms of that ownership problem, not isolated
bugs.

The rewrite should make Markdown editor state explicit:

- Markdown text is canonical and LF-normalized in the editor model.
- Blank lines are first-class model lines, never accidental empty DOM nodes.
- Logical selection is model-owned, including text selection, cursor positions,
  blank-line cursor positions, and whole-block selection.
- The DOM is a projection of the model plus a low-latency input surface.
- Autosave, undo, source mode, formatting, paste, and cursor persistence read
  from the same model snapshot.

The design should take inspiration from Notion's block primitives without
abandoning Markdown as the storage format. The editor should expose addressable
logical Markdown blocks and a left-gutter handle that can select a whole block.
Drag, reorder, slash menus, and block action menus are explicitly out of scope
for the first rewrite unless added by a later plan.

The target result is an editor where typing feels native, structural behavior is
deterministic, exact Markdown newlines survive every save path, and the system
has clear invariants that tests can enforce.

## Current Problems To Eliminate

The current implementation distributes core editor truth across several places:

- `contentEl` DOM nodes are treated as both rendered view and source of truth.
- `domToMarkdown(contentEl)` is used by `getValue()`, cursor offset capture,
  selection capture, undo checkpoints, paste normalization, source-mode toggles,
  draft capture, and autosave capture.
- Blank lines are represented by hidden or visible `data-md-blank` DOM
  sentinels, plus temporary editable paragraphs used as cursor hosts.
- Selection is preserved by inserting marker spans into the DOM and serializing
  the entire document to discover where those markers landed.
- Structural behavior is split across native browser `contenteditable`
  mutations, `keydown`, `beforeinput`, `input`, DOM normalization, block
  transforms, inline transforms, and app-level delayed draft capture.
- Re-rendering from Markdown can delete or reshape DOM nodes that the browser
  still considers part of the current selection.
- Performance-sensitive paths can accidentally become O(document) because full
  DOM serialization is the easiest way to get Markdown or cursor offsets.

These are the concrete failure modes the rewrite must remove:

- Repeated blank lines collapsing during save, autosave, source toggle, or after
  additional edits.
- Cursor positions jumping backward or to the end after model-to-DOM refreshes.
- Arrow navigation skipping over visible blank-line lanes.
- Characters being lost when typing immediately after pressing Enter.
- Autosave capturing a stale DOM state or an incomplete editor state.
- Blank lines becoming editable DOM paragraphs when they should be structural
  Markdown newlines.
- Browser-created empty blocks becoming data without an explicit editor
  transaction.
- Tests needing to assert implementation quirks because there is no stable
  model-level contract.

## Non-Goals

The rewrite should not:

- Replace Markdown storage with a proprietary document format.
- Add a large editor framework dependency unless a separate decision explicitly
  approves that cost.
- Move Markdown/editor behavior out of `packages/md-wysiwyg`.
- Change note identity, persistence, catalog, vault, or server write semantics.
- Expand V1 frontmatter support beyond tags-only.
- Introduce drag-and-drop block reordering, slash commands, block menus, or
  collaborative editing in the first implementation.
- Make ordinary typing feel delayed by forcing a full render after every
  character.
- Preserve obsolete DOM structure tests if they conflict with the new model;
  behavior tests should be preserved.

## Design Principles

1. Markdown is canonical.

   The editor model owns the exact Markdown body that will be saved. The DOM is
   never the canonical representation for visual editing.

2. Lines are the lossless storage primitive.

   Markdown newlines, including leading blanks, trailing blanks, and repeated
   blanks, are represented directly. `EditorDoc -> markdown` must preserve them
   exactly.

3. Blocks are addressable editing primitives.

   A derived block index groups canonical lines into logical Markdown blocks.
   This supports block selection, gutter handles, block-level rendering, and
   future block actions without compromising line fidelity.

4. Selection is logical.

   Cursor and selection state live in the model. DOM `Range` objects are
   temporary browser interop details, not durable editor state.

5. Structural edits are transactions.

   Enter, Backspace, Delete, paste, formatting, source toggle, undo, redo, and
   block selection operate through explicit transactions that update model state
   and selection together.

6. Typing stays fast.

   Ordinary text insertion should use the browser's native text input inside the
   active text host, then reconcile only that host into the model. It should not
   serialize or re-render the whole document.

7. Rendering is deterministic.

   Given the same model state and logical selection, rendering produces the same
   DOM shape. Blank-line lanes and cursor hosts are derived from state, not
   patched in by event-specific DOM mutation.

8. Tests define behavior at the model boundary.

   Browser e2e tests should cover real workflows. Most edge cases should be
   asserted in deterministic model and transaction tests.

## Canonical Model

### EditorState

The visual editor should maintain an internal state object:

```ts
type EditorState = {
  doc: EditorDoc;
  selection: EditorSelection;
  revision: number;
  composing: boolean;
  sourceMode: boolean;
};
```

Rules:

- `revision` increments after every accepted model transaction.
- `revision` does not increment for pure DOM selection restoration.
- `composing` is true during IME composition and suppresses structural rerenders.
- `sourceMode` tracks whether the source textarea or visual content surface owns
  current input.
- The app can ask for one coherent snapshot containing Markdown, cursor offset,
  selection offsets, revision, and source-mode state.

### EditorDoc

The simplest correct document representation should be line-first:

```ts
type EditorDoc = {
  lines: EditorLine[];
  lineStarts: number[];
  blocks: BlockIndex;
};

type EditorLine = {
  id: string;
  text: string;
};
```

Rules:

- `text` never contains `\n`.
- Empty lines are represented as `{ text: "" }`.
- LF is the only internal newline representation.
- CRLF from server content is normalized before entering the editor model.
- CRLF conversion back to disk remains the server/persistence layer's
  responsibility.
- `lineStarts` is derived from `lines` and used for O(log n) or O(1) offset
  mapping.
- `blocks` is derived from `lines`, not separately mutated by ordinary editing.

Markdown conversion:

```ts
function markdownToDoc(md: string): EditorDoc {
  // normalize CRLF/CR to LF before split
  // preserve trailing empty lines exactly
}

function docToMarkdown(doc: EditorDoc): string {
  return doc.lines.map((line) => line.text).join("\n");
}
```

Important examples:

| Markdown | Lines |
| --- | --- |
| `""` | `[""]` or a special empty-doc representation, chosen once and tested |
| `"foo"` | `["foo"]` |
| `"foo\n"` | `["foo", ""]` |
| `"foo\n\n"` | `["foo", "", ""]` |
| `"foo\n\nbar"` | `["foo", "", "bar"]` |
| `"foo\n\n\nbar"` | `["foo", "", "", "bar"]` |
| `"\nfoo"` | `["", "foo"]` |
| `"\n\nfoo"` | `["", "", "foo"]` |

The implementation should choose one internal representation for an empty
document and lock it with tests. The recommended default is one empty line,
because it gives the visual editor a natural cursor host.

### Logical Position

Logical cursor positions should be line and column based:

```ts
type LogicalPosition = {
  line: number;
  column: number;
};
```

Rules:

- `line` indexes `doc.lines`.
- `column` is a UTF-16 string offset in `line.text`, matching browser text node
  offsets and TypeScript string indexing.
- `column` is clamped to `[0, line.text.length]`.
- A position at the start of line `n + 1` maps to Markdown offset
  `lineStarts[n + 1]`.
- A position at the end of line `n` maps to `lineStarts[n] + line.length`.
- The newline character between lines is not directly selectable as a text
  character; moving across it is modeled as moving between line positions.

This mirrors how source textareas behave while still giving the visual editor
control over blank-line lanes.

### EditorSelection

The editor should support three selection kinds:

```ts
type TextSelection = {
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

type EditorSelection = TextSelection | BlockSelection | VoidSelection;
```

Recommended usage:

- `text`: normal caret and text range selection.
- `block`: gutter-selected logical Markdown block or contiguous block range.
- `void`: selected non-text object such as an image block if needed; this can be
  deferred until image behavior requires it.

For first implementation, `text` and `block` are required. `void` can be added
only if it simplifies image selection/resizing.

### Offset Mapping

The model should expose pure helpers:

```ts
function positionToOffset(doc: EditorDoc, pos: LogicalPosition): number;
function offsetToPosition(doc: EditorDoc, offset: number): LogicalPosition;
function selectionToOffsets(doc: EditorDoc, selection: EditorSelection): SelectionOffsets | null;
function offsetsToSelection(doc: EditorDoc, start: number, end: number): TextSelection;
```

Rules:

- These helpers must not inspect or mutate DOM.
- Offsets are Markdown body offsets, excluding frontmatter managed by app code.
- Block selection offset conversion returns the exact source span of selected
  blocks, including relevant newline separators.
- Cursor offsets around formatted inline syntax are source offsets, not visual
  text offsets. For example, inside `**bold**`, the cursor before `b` maps after
  the opening `**`.

The current sentinel-in-DOM serialization approach exists because inline DOM
does not naturally expose Markdown source offsets. The rewrite should solve this
by carrying source-span metadata from the Markdown parser/renderer into rendered
text leaves.

## Derived Block Model

### BlockIndex

The editor should derive a block index from lines:

```ts
type BlockIndex = {
  blocks: EditorBlock[];
  byId: Map<string, EditorBlock>;
  byLine: EditorBlockRef[];
};

type EditorBlock = {
  id: string;
  kind: BlockKind;
  startLine: number;
  endLine: number;
  editable: boolean;
};

type EditorBlockRef = {
  blockId: string;
  role: "content" | "blank" | "continuation";
};
```

`endLine` should be exclusive.

Block ids should be stable across small edits when practical:

- If a transaction edits text within a block, preserve that block id.
- If Enter splits a block, keep the original id on the block before the split
  and assign a new id to the block after the split.
- If Backspace merges two blocks, keep the id of the block receiving the cursor.
- If Markdown is replaced wholesale by `setValue`, ids may be regenerated.

### Block Kinds

The block index should use the existing public `BlockKind` vocabulary where it
fits:

- `paragraph`
- `heading`
- `list`
- `blockquote`
- `code`
- `table`
- `hr`
- `blank`
- `other`

Recommended grouping:

- A heading line is one `heading` block.
- Consecutive plain paragraph lines without blank separators may be grouped as
  one `paragraph` block if they are one Markdown paragraph, but visual editing
  can still render individual editable line hosts within it.
- A list and nested list continuation lines form one `list` block.
- A fenced code region, including opening and closing fences, forms one `code`
  block.
- A table header, delimiter, and row lines form one `table` block.
- Consecutive blank lines form one `blank` block with multiple blank model
  lines.
- Extension-provided block structures should be represented as `other` unless
  an extension can declare a more specific block kind.

### Gutter Block Selection

Inspired by Notion, each rendered logical Markdown block should have a gutter
handle:

- The handle is visible on hover or keyboard focus.
- Clicking the handle selects the entire logical Markdown block.
- Shift-clicking another handle extends a block selection range.
- The selected block range gets a visible selection style.
- Copy copies the exact Markdown source span for selected blocks.
- Cut copies then deletes the selected block source span.
- Delete/Backspace deletes the selected block source span and places the cursor
  at the nearest valid logical position.
- Typing while a block is selected replaces the selected block range with typed
  text.

The first rewrite should not add drag/reorder or action menus. The handle should
exist because it validates the block model and provides a useful operation, but
its behavior should stay minimal.

Accessibility:

- Handles should be keyboard focusable.
- Handles should have an accessible label like `Select block`.
- Block selection should be visible without relying only on color.
- Escape should collapse a block selection to a text cursor at the start of the
  first selected block.

## Rendering Model

### DOM Projection

The visual DOM should be rendered from `EditorState`:

```ts
function renderEditorState(state: EditorState, root: HTMLElement): RenderResult;
```

Each rendered block should include metadata:

```html
<div data-md-block-id="..." data-md-block-kind="paragraph">
  ...
</div>
```

Each editable text host should include line/source metadata:

```html
<p data-md-line-id="..." data-md-line-index="3">
  ...
</p>
```

Inline text leaves that correspond to source spans should include enough
metadata to map DOM positions back to Markdown positions:

```html
<span data-md-source-start="12" data-md-source-end="16">text</span>
```

The exact DOM tags can differ from the examples if CSS or semantics require it.
The invariant is that every DOM location that can hold the caret maps to a
logical model position without full DOM serialization.

### Partial Rendering

Rendering should support two modes:

1. Full render:

   Used for `setValue`, source-mode exit, undo/redo, large paste, or wholesale
   document replacement.

2. Range render:

   Used after model transactions that affect known line or block ranges.

Ordinary text input should not trigger either mode unless an inline or block
transform fires. The browser may update the active text node, and the editor
then reconciles that host into the model.

### DOM Mapping

The renderer should maintain a map:

```ts
type DomMap = {
  lineToElement: Map<string, HTMLElement>;
  blockToElement: Map<string, HTMLElement>;
};
```

The map is rebuilt after full render and patched after range render.

Selection restoration should use this map:

- Resolve logical line id and column to a DOM text leaf and DOM offset.
- If the logical line is blank and selected, render or find the active blank
  cursor host.
- If a leading or trailing logical blank line is hidden, create a selected
  cursor host while the cursor is on that line.
- If the target text leaf no longer exists, clamp to the nearest valid logical
  position.

### Inline Rendering And Source Spans

The current inline renderer converts Markdown source text into semantic HTML
without retaining source locations. The rewrite needs source-aware inline
rendering for editor usage.

Recommended approach:

- Keep existing `renderMarkdown` for standalone rendering.
- Add an internal editor render path that tokenizes inline Markdown into
  source-spanned tokens.
- Render tokens to DOM with source-span metadata.
- Reuse existing extension hooks where possible.
- Where an extension cannot provide source spans, treat the extension output as
  an atomic span that maps cursor positions conservatively before or after the
  extension output.

Required source mapping examples:

- `**bold**`: visual text `bold`, source span includes opening and closing
  markers.
- Cursor before `b`: Markdown offset after opening `**`.
- Cursor after `d`: Markdown offset before closing `**`.
- Cursor after the formatted element: Markdown offset after closing `**`.
- Wiki links and wiki images should map to their original Markdown source spans.

This preserves the correctness currently provided by sentinel serialization,
without mutating and serializing the DOM.

## Blank-Line Semantics

Blank lines are the motivating case and need explicit rules.

### Storage Rules

- Every blank Markdown line is an `EditorLine` with `text === ""`.
- Blank lines are serialized by `docToMarkdown`, not by DOM sentinel nodes.
- Leading blank lines, trailing blank lines, and repeated blank lines are
  preserved exactly.
- A blank line is never dropped merely because it is visually collapsed.

### Visual Rules

Use hybrid blank-line lanes:

- Blank separators between content blocks render visible noneditable lanes,
  including the single separator in `foo\n\nbar`.
- A blank line at the active cursor position always renders a cursor host.
- Leading and trailing repeated blank lines render consistently with middle
  repeated blank lines.

For `foo\n\n\nbar`, the model has:

```text
line 0: foo
line 1:
line 2:
line 3: bar
```

Expected visual behavior:

- The editor shows `foo`.
- The blank run is visible as blank-line lanes.
- The editor shows `bar`.
- With the cursor after `bar`, pressing ArrowUp once lands on the blank line
  immediately above `bar`, not after `foo`.
- Saving and autosave preserve `foo\n\n\nbar`.

### Cursor Rules

- A cursor can logically sit on any blank model line at column `0`.
- The selected blank line is represented by an editable cursor host.
- Non-selected blank lanes are `contenteditable=false`.
- Text input on a blank cursor host replaces that blank line with a text line.
- Pressing Enter on a blank cursor host inserts another blank line after it and
  moves the cursor to the new blank line.
- Backspace on a blank cursor host removes the blank line before or merges
  according to source-text behavior.
- Delete on a blank cursor host removes the following blank line or merges with
  following content according to source-text behavior.

### Autosave Rules

- Autosave reads `EditorState`, not DOM.
- Autosave must not alter blank-line visibility or cursor position.
- Autosave must not force a full render.
- Autosave must preserve trailing blank lines, including a final cursor line.

## Input Ownership

Use a hybrid-controlled input model.

### Native Text Input

Allow native browser text insertion only inside the active editable text host.

On `input`:

1. Identify the active line host from DOM metadata.
2. Read only that host's text/source-relevant content.
3. Update the corresponding `EditorLine`.
4. Update `selection` from the browser range using the host mapping.
5. Increment `revision`.
6. Schedule undo checkpoint and app change callback.
7. Run inline transform detection if applicable.

This path must not:

- Call `domToMarkdown(contentEl)`.
- Walk the whole document.
- Re-render the whole document.
- Replace the active DOM node unless a transform fires.

### Structural Input

Intercept structural operations before the browser mutates unpredictable DOM:

- `insertParagraph`
- `deleteContentBackward`
- `deleteContentForward`
- `insertFromPaste`
- `insertFromDrop`
- `formatBold` and similar command events if browser emits them

For intercepted operations:

1. Prevent default.
2. Convert current DOM selection to `EditorSelection`.
3. Apply a model transaction.
4. Render affected range.
5. Restore selection from model.
6. Notify change.

### Composition Input

IME composition must be handled deliberately:

- On `compositionstart`, set `state.composing = true`.
- During composition, do not structurally rerender the active host.
- On `compositionend`, reconcile the active host into the model.
- If composition produced text that triggers an inline transform, defer transform
  until after composition has fully ended.
- Selection capture during composition should use the browser range inside the
  active host, not stale model selection.

## Transactions

Transactions should be pure where possible:

```ts
type EditorTransaction = (state: EditorState) => TransactionResult;

type TransactionResult = {
  state: EditorState;
  changed: boolean;
  renderHint: RenderHint;
};

type RenderHint =
  | { kind: "none" }
  | { kind: "lines"; startLine: number; endLine: number }
  | { kind: "blocks"; blockIds: string[] }
  | { kind: "full" };
```

### Insert Text

For collapsed text selection:

- Insert text at logical position.
- Split inserted text on `\n`.
- Preserve every newline as line boundaries.
- Place cursor after inserted text.

For ranged text selection:

- Delete selected range.
- Insert text at range start.
- Place cursor after inserted text.

For block selection:

- Replace selected block source span with inserted text.
- Rebuild affected blocks.
- Place cursor after inserted text.

### Enter

Cases:

- Cursor in a normal text line: split line at cursor.
- Cursor at end of heading: insert a new empty paragraph line after heading.
- Cursor in empty line: insert a new empty line after it.
- Range selected: delete selection, then split/insert at range start.
- Block selected: replace selected block with an empty line and place cursor
  there.
- List item behavior should match existing tests and Markdown expectations:
  Enter in nonempty item creates a new item; Enter in empty item exits or
  dedents as appropriate.

The important newline invariant:

- Pressing Enter `n` times creates `n` new line boundaries in the model
  immediately, synchronously, and without waiting for browser DOM cleanup.

### Backspace

Cases:

- Non-collapsed text selection: delete selected text.
- Block selection: delete selected blocks.
- Cursor after first character in line: delete previous character.
- Cursor at column `0`:
  - If not first line, merge with previous line or delete intervening blank line
    according to source-text behavior.
  - Cursor lands at the join point.
  - Repeated blank lines are removed one at a time.
- Empty list item: preserve current intended behavior for nested and top-level
  list items, but implement through model transactions.

### Delete

Cases:

- Non-collapsed text selection: delete selected text.
- Block selection: delete selected blocks.
- Cursor before end of line: delete next character.
- Cursor at end of line:
  - If not last line, merge with next line or delete following blank line
    according to source-text behavior.
  - Repeated blank lines are removed one at a time.

### Arrow Navigation

Horizontal movement:

- ArrowLeft and ArrowRight should map through logical positions and inline source
  spans.
- Default browser behavior may be used inside a simple active text host when it
  maps cleanly.

Vertical movement:

- ArrowUp and ArrowDown should be model-owned when moving across block
  boundaries or blank-line lanes.
- Store a desired visual x-coordinate while moving vertically if needed.
- Moving through blank runs must visit each visible blank cursor lane in order.
- `foo\n\n\nbar` with cursor after `bar`, ArrowUp once should land on the blank
  line immediately above `bar`.

### Paste

Plain text paste:

- Replace current selection with pasted text.
- Normalize line endings to LF.
- Preserve all pasted blank lines exactly.
- Place cursor after pasted content.

HTML paste:

- Sanitize existing supported HTML.
- Convert sanitized HTML to Markdown using an import serializer.
- Apply the same replacement transaction as plain text.

Image paste:

- Preserve current `onImagePaste(blob)` API.
- Upload callback may return HTML for compatibility.
- Convert returned image HTML to the corresponding Markdown representation
  before applying the model transaction.
- Image resize changes should update the model Markdown, not only DOM attrs.

### Formatting

Formatting commands should continue to operate on Markdown offsets:

- Bold, italic, strikethrough, highlight, headings, code fences, indent/dedent,
  and clear formatting use model selection converted to source offsets.
- The existing `format-ops.ts` functions can remain if they take Markdown plus
  offsets and return Markdown plus offsets.
- After formatting, replace the full model from returned Markdown or patch the
  affected source span, then restore selection from returned offsets.

### Block Transforms

Block input transforms should become transactions:

- Typing `# ` at the start of a line converts the line to a heading edit state.
- Typing `- ` creates a list item.
- Typing `[ ] ` or `[x] ` creates a task item.
- Typing `> ` creates a blockquote.
- Typing a code fence creates a code block.
- Pressing Enter after markdown block syntax performs the corresponding block
  transform.

Transforms should not use `document.execCommand` or direct DOM replacement as
the source of truth. They update the model, then render the affected block.

## Undo And Redo

Undo should be editor-owned, not browser-owned.

Recommended undo entry:

```ts
type UndoEntry = {
  markdown: string;
  selection: EditorSelection;
  revision: number;
};
```

Rules:

- Push an entry before non-typing structural transactions.
- Debounce typing checkpoints using existing settings.
- Source mode edits should share the same undo stack if practical; otherwise,
  source mode should checkpoint on enter/exit and textarea native undo can remain
  local to source mode.
- Undo restores model state, renders, restores logical selection, and fires
  change.
- Redo restores model state, renders, restores logical selection, and fires
  change.
- Undo checkpoints read from model state only.

The browser's native undo stack should not be relied on for visual editor
correctness. Preventing default for structural operations helps keep native undo
from diverging.

## Source Mode

Source mode remains a raw Markdown textarea.

Entering source mode:

- Flush any active composition.
- Reconcile active visual host.
- Set textarea value to `docToMarkdown(state.doc)`.
- Map logical selection to textarea offsets.
- Focus textarea and set selection range.

Leaving source mode:

- Read textarea value.
- Normalize line endings to LF.
- Build a new `EditorDoc`.
- Map textarea selection offsets back to logical selection.
- Render full visual editor.
- Restore visual selection.

Rules:

- Source mode should not pass through `domToMarkdown`.
- Source mode should preserve every newline exactly.
- Source mode toggle should not add or remove blank lines.

## Autosave And App Integration

Add an optional efficient snapshot API to `EditorHandle`:

```ts
type EditorSnapshot = {
  markdown: string;
  cursorOffset: number;
  selection: { start: number; end: number } | null;
  revision: number;
  sourceMode: boolean;
};

type EditorHandle = {
  getSnapshot(): EditorSnapshot;
};
```

Existing APIs should remain:

- `getValue()`
- `setValue(md, cursorOffset?)`
- `getSelectionOffsets()`
- `getCursorOffset()`
- `applyFormat(op)`
- `undo()`
- `redo()`
- `toggleSourceMode()`
- `focus()`
- `setConfig(partial)`
- `isSourceMode`
- `contentEl`
- `sourceEl`
- `destroy()`

App changes:

- `web/ts/app.ts` should prefer `editor.getSnapshot()` for draft capture.
- Draft content and cursor offset should come from the same snapshot revision.
- Autosave should call `syncActiveDraft()` without causing DOM serialization or
  visual re-render.
- Manual save should use the same snapshot path.
- New note creation should keep placing the cursor after `# Title\n`, which maps
  to logical line `1`, column `0`.
- Frontmatter tag preservation remains app-owned: the editor receives and
  returns Markdown body content, while app code wraps or updates frontmatter as
  it does today.

## Extension Compatibility

The current extension API supports:

- Inline render hooks.
- Blockquote render hooks.
- Inline serialize hooks.
- Block serialize hooks.
- Additional block detection.

The rewrite should preserve public extension behavior for standalone
render/serialize usage.

For the visual editor:

- Extensions that render inline content need a source-span strategy.
- If an extension cannot expose internal source mapping, the editor should treat
  that rendered inline output as atomic.
- Atomic extension spans should allow cursor positions before and after the span,
  but not inside it unless the extension provides mapping.
- Existing wiki links, wiki images, and callouts should be first-class test
  cases because the app relies on them.

Potential internal extension addition:

```ts
type EditorInlineTokenHook = (
  text: string,
  offset: number,
) => {
  token: EditorInlineToken;
  consumed: number;
} | null;
```

This should remain internal until it is proven stable. Do not expand the public
extension API prematurely.

## File And Module Plan

Recommended new modules inside `packages/md-wysiwyg/src/`:

- `editor-model.ts`
  - `EditorState`, `EditorDoc`, `EditorLine`, `EditorSelection` types.
  - Markdown line parsing and serialization.
  - Offset/position/selection conversion.

- `editor-blocks.ts`
  - Block index derivation.
  - Block source spans.
  - Block selection range helpers.

- `editor-transactions-model.ts`
  - Pure model transactions for insert text, Enter, delete, paste, block
    selection replacement, and source replacement.

- `editor-render-model.ts`
  - DOM projection from `EditorState`.
  - DOM map construction.
  - Partial range render hooks.
  - Blank-line lane rendering.

- `editor-dom-selection.ts`
  - Logical selection to DOM range.
  - DOM range to logical selection for active text hosts.
  - Block handle selection mapping.

- `editor-inline-model.ts`
  - Source-spanned inline tokenization and rendering for editor use.
  - Mapping between visual text leaves and Markdown source offsets.

- `editor-gutter.ts`
  - Gutter handle rendering and pointer/keyboard behavior.
  - Block selection UI state.

Existing modules to adapt:

- `editor.ts`
  - Remains the public `createEditor` wiring layer.
  - Owns event listeners, config, source mode, callbacks, image paste, and
    handle methods.
  - Delegates model updates to transaction modules.

- `editor-undo.ts`
  - Move from DOM/Markdown getter callbacks to model snapshot entries.

- `editor-transactions.ts`
  - Either retire or adapt to model transactions.

- Block transforms now live in the model/render pipeline rather than a DOM
  replacement module.

- `inline-patterns.ts`
  - Keep pure inline trigger detection for model-backed input transforms.

- `serialize.ts`
  - Keep for standalone `domToMarkdown` and import/paste fallback.
  - Stop using it as visual editor source of truth.

- `markdown.ts`
  - Keep public rendering helpers.
  - Share parsing/tokenization code only when it does not compromise editor
    source mapping.

- `packages/md-wysiwyg/docs/architecture.md`
  - Update after the rewrite to document model-owned architecture.

App modules:

- `web/ts/app.ts`
  - Use `getSnapshot()` for draft capture.
  - Preserve existing debounce behavior.
  - Keep frontmatter body wrapping logic.

- `web/static/app.css`
  - Add gutter handle, block selection, blank lane, and active blank cursor host
    styles.

## Confidence And Validation Strategy

The design is strongest at the ownership boundary:

- Markdown/model state owns the document.
- The DOM is a rendered view and input surface.
- Blank lines are explicit model lines.
- Selection is logical and model-owned.
- Structural editing is transactional.
- Autosave reads one coherent model snapshot.
- Blocks are derived from Markdown lines rather than stored as a separate note
  format.

The design is intentionally less certain in the detailed mechanics of:

- Source-aware inline cursor mapping.
- Hybrid native typing reconciliation.
- Extension source-span support.
- The exact DOM wrapper shape for block gutters and blank lanes.

Those uncertain pieces should not be implemented on faith. The rewrite should
advance through explicit proof gates. If a gate fails or feels awkward, the
implementation should stop and revise the design before expanding scope.

The two most important proof points are:

1. The pure model and transaction layer can express all newline and cursor
   invariants without DOM help.
2. A small model-rendered editor can handle paragraphs, headings, blank lanes,
   Enter, Backspace, ArrowUp/ArrowDown, native typing reconciliation, and
   snapshot capture without calling `domToMarkdown` on hot paths.

Only after both proof points pass should the rewrite expand into lists, tables,
extensions, image behavior, and gutter block selection.

## Staged Implementation And Gates

Because this is a full editor-core rewrite, the implementation should land in
stages with explicit pass/fail gates. A later stage should not begin until the
previous gate passes, except for exploratory spikes that do not replace current
behavior.

Each gate should record:

- What shipped.
- Which tests were added.
- Which existing tests were preserved or intentionally updated.
- Which known risks remain.
- Whether the design still feels simpler than the current DOM-owned approach.

Recommended validation commands at every gate:

- `pnpm --dir packages/md-wysiwyg test`
- `pnpm exec vitest run`
- `TANSU2_E2E_BROWSER=chromium pnpm run test-e2e` when browser behavior is
  affected
- `make check` before considering an app-integrated gate complete

### Stage 0: Baseline Regression Lock

Purpose:

- Preserve the hard-won expected behavior before replacing internals.
- Separate behavior requirements from current DOM implementation details.

Deliver:

- A named test group or comments identifying the newline/cursor regressions that
  must survive the rewrite.
- Current e2e coverage kept for immediate typing after Enter, repeated blank
  lines, autosave, ArrowUp through blank lanes, and large-note rapid typing.
- Test notes explaining which assertions are behavioral and which are temporary
  DOM-shape assertions.

Gate:

- Existing tests pass before model work starts.
- Any test that asserts obsolete sentinel DOM details is marked for later
  conversion to behavior-level assertions.
- No implementation code changes are required for this stage.

Acceptance tests:

- Create a note, type immediately after Enter, and assert no characters are
  lost.
- Create `foo`, press Enter three times, type `bar`, autosave, and assert exact
  saved Markdown.
- Press Enter after `bar` and assert earlier blank lines remain.
- ArrowUp from after `bar` lands on the blank lane immediately above `bar`.
- Rapid typing in a large visual note remains responsive.

Exit decision:

- Proceed only if the tests clearly describe the user-visible contract the new
  editor must preserve.

### Stage 1: Model Foundation Proof

Purpose:

- Prove that a line-first model can represent the editor's Markdown exactly.
- Prove that structural edits can be modeled without browser DOM state.

Deliver:

- `EditorDoc` line model.
- Markdown parse/serialize helpers.
- Offset/position helpers.
- `EditorSelection` types.
- Block index derivation.
- Pure transactions for insert text, Enter, Backspace, Delete, paste text, and
  selection replacement.

Gate:

- `docToMarkdown(markdownToDoc(md)) === normalizeLineEndings(md)` for all model
  fixtures.
- Offset and position conversion round-trips for all tested line shapes.
- Transactions preserve exact Markdown newlines.
- No model test needs DOM APIs.
- No UI behavior is changed yet.

Acceptance tests:

- Parse/serialize exact cases: `""`, `"\n"`, `"\n\n"`, `"foo"`,
  `"foo\n"`, `"foo\n\n"`, `"foo\nbar"`, `"foo\n\nbar"`,
  `"foo\n\n\nbar"`, `"\nfoo"`, `"\n\nfoo"`, and
  `"foo\n\nbar\n\n"`.
- `foo` plus Enter three times plus `bar` produces `foo\n\n\nbar`.
- Backspace through `foo\n\n\nbar` removes blank lines one at a time.
- Delete through `foo\n\n\nbar` removes blank lines one at a time.
- Pasting text with leading, middle, and trailing blank lines preserves every
  pasted newline.
- Block index identifies heading, paragraph, list, code, table, blockquote, and
  blank-run spans without changing Markdown.

Exit decision:

- Proceed only if the model code is small, direct, and easier to reason about
  than the current DOM sentinel behavior.
- Revise the design if blank-line semantics require special cases that are as
  complex as the current implementation.

### Stage 2: Minimal Model-Rendered Editor Proof

Purpose:

- Prove that the editor can render from model state and restore logical
  selection without DOM serialization.
- Prove the core newline and cursor behaviors in a browser-facing surface before
  supporting the full Markdown feature set.

Deliver:

- Editor-specific renderer for headings, paragraphs, and blank lines.
- Source/span metadata for simple editable text hosts.
- DOM map from model line ids and block ids to rendered elements.
- Logical selection to DOM range restoration.
- DOM range to logical selection capture for active text hosts.
- Hybrid blank-line lane rendering.
- `getSnapshot()` backed by model state.
- A prototype path in `createEditor` or an internal test harness that does not
  yet need to support every block kind.

Gate:

- `setValue(md, offset)` renders and restores cursor without sentinel DOM
  serialization.
- `getValue()`, `getCursorOffset()`, `getSelectionOffsets()`, and
  `getSnapshot()` read model state.
- Rendering `foo\n\n\nbar` produces deterministic visible blank lanes.
- ArrowUp and ArrowDown move through blank lanes by logical line.
- Ordinary text input reconciles only the active host.
- The hot path does not call `domToMarkdown(contentEl)`.

Acceptance tests:

- `setValue("foo\n\n\nbar", offsetAfterBar)` places cursor after `bar`; ArrowUp
  once moves to the blank line immediately above `bar`.
- `setValue("# Title\n", "# Title\n".length)` places cursor at logical line 1,
  column 0.
- Typing into a blank cursor host replaces that blank line with text.
- Pressing Enter repeatedly in the prototype creates repeated blank model lines
  immediately.
- A spy proves ordinary typing, cursor capture, and snapshot capture do not call
  `domToMarkdown`.

Exit decision:

- This is the main design checkpoint.
- Proceed only if the minimal editor feels fast and the code paths are simpler
  than the current blank-line DOM patching.
- If source-aware selection restoration is already brittle at this stage, stop
  and reconsider before adding lists, extensions, or block gutters.

### Stage 3: Full Visual Event Pipeline

Purpose:

- Replace current visual editing internals with the model-owned event pipeline.
- Preserve the public `createEditor` handle.

Deliver:

- `createEditor` routes visual editing through `EditorState`.
- Native input reconciliation for active text hosts.
- Structural `beforeinput` transactions for Enter, Backspace, Delete, and paste.
- Model-owned undo/redo.
- Model-owned formatting commands.
- Model-owned block transforms.
- Source-spanned inline rendering for built-in inline Markdown.

Gate:

- Existing package editor tests pass or are updated from DOM implementation
  details to behavior-level assertions.
- Ordinary typing does not call `domToMarkdown`.
- No structural edit relies on browser-created document structure as source of
  truth.
- Undo and redo restore both Markdown and logical selection.
- Inline formatting preserves source offsets well enough to replace the current
  sentinel cursor-offset tests.

Acceptance tests:

- Immediate typing after Enter never loses characters.
- Enter at start, middle, and end of a text line updates model and cursor
  correctly.
- Backspace/Delete behavior matches source-text expectations across normal and
  blank lines.
- Bold, italic, highlight, code, links, wiki links, and wiki images preserve
  expected cursor offsets.
- Block transforms for headings, lists, tasks, blockquotes, code fences, and HR
  update model state rather than directly replacing DOM.
- Undo after typing and structural edits restores exact Markdown and cursor.

Exit decision:

- Proceed only if the old DOM-owned paths can be disabled for visual mode
  without losing current editor behavior.
- Keep standalone `renderMarkdown` and `domToMarkdown` working independently.

### Stage 4: App Snapshot And Autosave Integration

Purpose:

- Move app draft capture, cursor persistence, and autosave to coherent editor
  snapshots.

Deliver:

- Public `getSnapshot()` API.
- `web/ts/app.ts` uses `getSnapshot()` for draft capture.
- Autosave, manual save, tab switch, editor teardown, and session save use
  snapshot-derived Markdown and cursor state.
- Source mode maps textarea offsets through the model on enter and exit.
- New note cursor starts on the line after the H1.

Gate:

- Autosave never calls visual DOM serialization.
- Autosave does not force a visual re-render.
- Saved Markdown and cursor offset come from the same `revision`.
- Manual save, tab switch, source toggle, reading-mode transition, and reload do
  not alter repeated blank lines.

Acceptance tests:

- Create note, type `foo`, press Enter three times, type `bar`, wait for
  autosave, reload, and assert exact saved content.
- Press Enter after `bar`, wait for autosave, and assert earlier blank lines
  remain.
- Toggle source mode around `foo\n\n\nbar` and assert exact Markdown remains.
- Close and reopen a tab with cursor in a blank lane and assert cursor restores
  to the same logical line.
- App unit tests assert draft and cursor are captured from one snapshot.

Exit decision:

- Proceed only if all newline/cursor regressions are passing in the full app,
  not only in package-level tests.

### Stage 5: Complete Markdown Surface And Extensions

Purpose:

- Expand the model-rendered editor from the proof subset to the full supported
  Markdown surface.

Deliver:

- Lists, nested lists, task lists, code fences, blockquotes, callouts, tables,
  HR, wiki links, wiki images, regular links, regular images, and inline
  formatting supported in the model-rendered editor.
- Source-span support or atomic fallback for extension-rendered inline content.
- Image paste and image resize update model Markdown.

Gate:

- Existing standalone render/serialize behavior remains compatible.
- Visual editor behavior is model-owned for supported Markdown features.
- Unsupported extension internals are atomic rather than partially editable in a
  way that can corrupt Markdown.

Acceptance tests:

- Cursor offsets around `**bold**`, `*italic*`, `==mark==`, `` `code` ``, links,
  wiki links, and wiki images match Markdown source offsets.
- Lists can be created, split, indented, dedented, exited, undone, and redone.
- Code fences preserve internal blank lines.
- Callouts and blockquotes preserve source content and blank lines.
- Image paste inserts model Markdown; image resize changes model Markdown.
- Pasting sanitized HTML converts to Markdown and preserves blank lines.

Exit decision:

- Proceed only if extension fallbacks are explicit and tested. Do not leave
  extension editability dependent on incidental DOM structure.

### Stage 6: Block Gutter Selection

Purpose:

- Add the Notion-inspired block selection primitive on top of the model's block
  index.

Deliver:

- Left-gutter block handles.
- Click to select a block.
- Shift-click to select a block range.
- Copy/cut/delete/replace selected blocks.
- Escape collapses block selection to a text cursor.
- Accessible handle labels and visible selection styling.

Gate:

- Block selection operates on exact Markdown source spans.
- Block selection does not interfere with normal text selection.
- Deleting or replacing selected blocks leaves valid Markdown and stable cursor
  placement.
- No drag, reorder, or block menu scope is introduced.

Acceptance tests:

- Gutter selection copies exact Markdown for heading, paragraph, list, code,
  table, blockquote/callout, image, and blank-run blocks.
- Shift-click selects a contiguous block range and copies exact Markdown.
- Delete selected block, undo, redo.
- Type while a block is selected and assert replacement Markdown.
- Escape from block selection places cursor at the start of the first selected
  block.
- Keyboard focus on handles exposes an accessible `Select block` name.

Exit decision:

- Proceed only if the block model proves useful without forcing storage changes
  or adding block-database semantics.

### Stage 7: Cleanup And Documentation

Purpose:

- Remove old visual editor ownership paths and document the new invariants.

Deliver:

- Remove tactical blank-line DOM mutation helpers.
- Remove visual editor dependency on `domToMarkdown` for state.
- Remove sentinel-based cursor capture from visual editor hot paths.
- Update architecture docs.
- Keep standalone render/serialize docs accurate.
- Rename or rewrite tests that assert obsolete sentinel internals.

Gate:

- No visual editor hot path serializes the whole DOM.
- Docs state the model-owned architecture.
- Test names and assertions describe behavior, not obsolete implementation
  details.
- No broad dependency was added without documented approval.

Acceptance tests:

- Full package, app unit, e2e, and check commands pass.
- Instrumentation proves ordinary typing, snapshot capture, autosave, and cursor
  capture do not call full DOM serialization.
- Architecture docs describe line model, block index, logical selection,
  transactions, blank lanes, snapshots, and gutter selection.

Exit decision:

- The rewrite is complete only after old code paths are removed or clearly
  isolated for standalone non-editor utilities.

## Test Plan

### Model Unit Tests

Add tests for line parsing and serialization:

- `""`
- `"\n"`
- `"\n\n"`
- `"foo"`
- `"foo\n"`
- `"foo\n\n"`
- `"foo\nbar"`
- `"foo\n\nbar"`
- `"foo\n\n\nbar"`
- `"\nfoo"`
- `"\n\nfoo"`
- `"foo\n\nbar\n\n"`

Add tests for offset mapping:

- Start, middle, and end of a single line.
- Start of second line.
- Empty middle line.
- Repeated empty lines.
- Trailing empty line.
- Offset clamping beyond document length.

Add tests for block indexing:

- Heading followed by paragraph.
- Paragraph run.
- Repeated blank run.
- List with nested list.
- Task list.
- Fenced code block containing blank lines.
- Blockquote/callout.
- Table.
- Leading blank block.
- Trailing blank block.

Add transaction tests:

- Insert text into empty doc.
- Insert text into blank line.
- Enter at start, middle, and end of text line.
- Enter repeatedly on a blank line.
- Backspace inside text.
- Backspace at start of line.
- Backspace through repeated blank lines one at a time.
- Delete at end of line.
- Delete through repeated blank lines one at a time.
- Paste text with leading, middle, and trailing blank lines.
- Replace text selection with multiline paste.
- Replace block selection with text.
- Delete block selection.
- Format selected inline range.

### Editor Integration Tests

Use happy-dom or the current package test environment for:

- `setValue("foo\n\n\nbar", offset)` renders visible lanes and restores logical
  cursor.
- `getValue()` returns model Markdown and does not inspect full DOM.
- `getCursorOffset()` returns model offset.
- Native input reconciliation updates only the active line.
- Enter transactions update model before render.
- Blank cursor host typing replaces the blank line.
- Source toggle preserves exact Markdown.
- Undo/redo restore Markdown and selection.
- Gutter click creates block selection.
- Gutter delete removes selected block.

### Browser E2E Tests

Preserve current regressions:

- Immediate typing after Enter in visual editor.
- Repeated blank lines across autosave.
- Blank lines inserted between typed paragraphs.
- Pressing Enter after `bar` does not collapse earlier blank lines.
- Arrow keys move through visible blank lines.
- Rapid typing stays responsive in a large visual note.

Add browser workflows:

- New note creation places cursor on the line after the H1.
- Type `foo`, Enter twice, type `bar`, autosave, reload, content remains
  `# Title\r\nfoo\r\n\r\nbar`.
- Type `foo`, Enter three times, type `bar`, autosave, reload, content remains
  `# Title\r\nfoo\r\n\r\n\r\nbar`.
- Put cursor after `bar`, ArrowUp once, type `x`; `x` appears on the expected
  blank line.
- Source mode round trip preserves `foo\n\n\nbar`.
- Gutter select heading, copy, paste elsewhere.
- Gutter select paragraph, delete, undo.
- Gutter select blank run, delete, undo.
- Gutter select code block containing blank lines, copy preserves fences and
  internal blank lines.

### Performance Tests

Add spies or instrumentation to assert:

- Ordinary typing does not call `domToMarkdown(contentEl)`.
- `getSnapshot()` does not touch DOM serialization.
- Autosave capture does not force visual render.
- Cursor offset capture does not insert marker spans into DOM.
- Large note typing does not full-render per character.

Performance scenarios:

- 5,000-line note, type 100 characters in one paragraph.
- 5,000-line note, press Enter repeatedly.
- 5,000-line note, autosave while cursor is in middle of document.
- Large paste of multiline Markdown.
- Undo/redo after large paste.

Exact timing thresholds should be conservative and environment-aware. Prefer
operation-count assertions over brittle millisecond assertions where possible.

## Acceptance Criteria

The rewrite is complete when:

- `getValue()` returns exact model Markdown without DOM serialization.
- `getSnapshot()` returns Markdown and cursor state from one coherent revision.
- Existing newline and cursor e2e regressions pass.
- Repeated blank lines are preserved through typing, autosave, manual save,
  source toggle, tab switch, undo, redo, and reload.
- Arrow navigation visits visible blank lanes in logical order.
- New notes place the cursor on the line after the H1.
- Ordinary typing in a large note is effectively latency-free.
- Single-line inline and block input transforms range-render only the affected
  modeled line when the surrounding block can be safely isolated.
- Whole-block gutter selection works for the main Markdown block kinds.
- Browser DOM mutations cannot create untracked document state.
- Documentation describes the model-owned architecture.

## Risks And Mitigations

Risk: Source-aware inline rendering is larger than expected.

Mitigation:

- Start with the inline constructs already supported by the renderer.
- Treat unsupported extension output as atomic.
- Preserve old standalone renderer until editor renderer is proven.

Risk: Hybrid native typing and model transactions diverge.

Mitigation:

- Limit native typing to active text hosts with explicit line metadata.
- Reconcile immediately after `input`.
- Prevent default for structural input.
- Add assertions in development tests that active host text matches model line
  after reconciliation.

Risk: Browser selection APIs are inconsistent around noneditable blank lanes.

Mitigation:

- Do not place caret in noneditable lanes.
- Use active blank cursor hosts for selected blank lines.
- Own vertical movement through the model.
- Restore DOM selection only after deciding logical selection.

Risk: Block grouping changes expected Markdown behavior.

Mitigation:

- Keep canonical storage line-based.
- Make block grouping derived and disposable.
- Test exact Markdown spans for every block kind.

Risk: The first rewrite becomes too broad.

Mitigation:

- Keep block handles to selection only.
- Defer drag/reorder/actions.
- Preserve public APIs.
- Avoid dependency changes.
- Land phases behind internal modules with focused tests.

## Open Decisions

These decisions should be made during implementation, not left implicit:

- Empty document representation: one empty line vs zero lines. Recommended:
  one empty line.
- Paragraph block grouping: one visual text line per block vs Markdown paragraph
  run with multiple line hosts. Recommended: Markdown paragraph block with
  line-level hosts.
- Source-span strategy for each extension. Recommended: first-class support for
  built-in wiki links/images/callouts; atomic fallback for unknown extensions.
- Whether `sourceMode` shares the visual undo stack exactly or checkpoints on
  mode boundaries. Recommended: checkpoint on mode boundaries first.
- Whether block selection includes adjacent collapsed blank separators.
  Recommended: selecting a content block selects only that block's source lines;
  selecting a blank run selects the blank lines explicitly.

## Implementation Notes

- Use `beforeinput` where possible for structural operations because it exposes
  the user's intent before the browser mutates DOM.
- Keep `keydown` handling for shortcuts and browser gaps.
- Keep app frontmatter logic outside the editor.
- Do not remove useful existing comments during refactors; update comments when
  their described behavior changes.
- Do not make test assertions depend on exact wrapper tags unless the wrapper is
  part of the public behavior.
- Prefer pure model tests for edge cases and browser e2e tests for real user
  workflows.
- Avoid broad dependencies. If a dependency is proposed, document what precise
  editor invariant it buys and what code it replaces.

## Post-Rewrite Latency Roadmap

After the model-owned editor rewrite is complete, the follow-up work should stay
small. Tansu2 is not a large multi-tenant web app, and a Linear-style rendering
or sync architecture would add more surface area than it removes. The useful
part of the Linear analysis is narrower: when the user already has trustworthy
local data, show it first and reconcile in the background.

The one intentional new subsystem worth considering is an IndexedDB cache for
server-accepted note bodies. Everything else in this section should either
delete work, reduce startup bytes, or remain a simple correctness fix.

### Principles

- Prefer optimizations that also simplify the mental model.
- Keep the Rust server, catalog, history, and conflict logic authoritative.
- Use IndexedDB only for clean, server-accepted data keyed by vault and hash.
- Never persist dirty drafts in browser storage.
- Never make cached content a substitute for server save acceptance.
- Do not split the app into a miniature frontend framework just to reduce
  remounts.
- Avoid service workers, CRDTs, background sync, and broad state-management
  dependencies until the product need clearly exists.

### Removed From The Follow-Up Scope

These ideas are intentionally not part of the next roadmap:

- Granular app rendering. The app is small enough that region-level invalidation
  is likely architectural complexity before it is user value.
- A Linear-style sync engine. Tansu2 already has a durable local server and
  normal Markdown files; browser state should remain a cache.
- Local full-text search in the browser. Tantivy already owns search, and
  duplicating indexing client-side would create more consistency work.
- Service worker precaching. Offline save behavior, vault watching, conflicts,
  and assets need a coherent product design before a service worker is worth
  carrying.
- Broad command-palette restructuring. The palette can stay simple unless a
  measured interaction is slow.
- Large animation audits. Fix obvious expensive transitions opportunistically,
  but do not make this a roadmap pillar.

### Stage 1: Minimal Measurement

Purpose:

- Measure note-open latency before adding IndexedDB.
- Keep instrumentation small enough that it does not become a subsystem.

Deliver:

- Add a few development-only `performance.mark` calls around bootstrap start,
  bootstrap response, active note request start, active note response, editor
  mount, and first editable paint.
- Add cache hit/miss marks when the IndexedDB stage lands.
- Prefer browser Performance panel inspection over app-level counters.

Gate:

- No app behavior changes.
- No test relies on wall-clock thresholds.
- The marks are easy to remove if they stop being useful.

Acceptance tests:

- Unit test only the helper fallback if a wrapper is introduced.
- Otherwise, treat this as a manual measurement aid and keep automated coverage
  focused on behavior.

### Stage 2: Clean Note Body Cache

Purpose:

- Let restored tabs and recently opened notes render from a hash-validated local
  body before `openNote` returns.
- Keep browser storage strictly derived from server-accepted content.

Data model:

```ts
type CachedNoteBody = {
  vault: number;
  noteId: string;
  contentHash: string;
  seq: number;
  content: string;
  cachedAtMs: number;
};
```

Storage:

- Add a small IndexedDB wrapper in `web/ts/note-cache.ts`.
- Use one object store keyed by `[vault, noteId, contentHash]`.
- Add an index by `[vault, noteId]` so stale hashes can be deleted after a new
  clean body is accepted.
- Bound the cache with a simple LRU pass by `cachedAtMs`. Start with a fixed
  entry count limit; add byte-size accounting only if needed.
- Treat every IndexedDB failure as a cache miss.

Read rules:

- Bootstrap metadata provides `noteId`, `contentHash`, and restored session
  tabs.
- For the active restored tab, call `getCachedNoteBody(vault, meta)`.
- Use the cached body only when the cached `contentHash` equals current
  metadata.
- If the cache hits, mount the editor with cached clean content immediately and
  still issue `openNote(noteId)` in the background.
- When `openNote` returns:
  - If the tab is still clean and the content hash matches, refresh metadata and
    keep the visible editor stable.
  - If the tab is clean and server content differs, replace with the server
    document.
  - If the tab became dirty, do not overwrite the draft; preserve current save
    and conflict behavior.
- Do not hydrate every inactive tab during bootstrap. Inactive tabs can read the
  cache when opened.

Write rules:

- After `openNote` succeeds, cache the returned clean document.
- After `saveNote` succeeds with a returned document, cache that clean document
  and remove older cached hashes for the same `{ vault, noteId }`.
- After revision restore or conflict restore succeeds, cache the returned clean
  document.
- After delete succeeds, delete cached entries for that `{ vault, noteId }`.
- On vault switch, ignore all pending cache reads from the old vault.

Failure rules:

- Cache reads never create dirty drafts.
- Cache content is never sent to `saveNote` unless the user actually edits it
  through normal app state.
- Cache misses and IndexedDB errors fall back to the current server path.
- Cache version errors may clear the cache, but must not affect notes on disk.

Gate:

- A valid cache hit makes the active restored note visible before `openNote`
  resolves.
- A stale hash is ignored.
- A late server response cannot overwrite a dirty draft.
- Same `noteId` in another vault cannot be read from the wrong cache entry.

Acceptance tests:

- Seed matching cached content, delay `openNote`, and assert the editor mounts
  with cached body first.
- Seed stale cached content and assert it is ignored.
- Edit after a cache hit but before `openNote` resolves; assert the late server
  response does not replace the draft.
- Save a note and assert the new clean body is cached under the new hash.
- Delete a note and assert its cache entries are removed.
- Switch vaults while a cache read is pending and assert old-vault content is
  ignored.

### Stage 3: Cache-Aware Note Opening

Purpose:

- Make the cache useful beyond first restored boot without expanding app
  architecture.

Deliver:

- When opening a note from search, recent, pinned, or closed tabs, try the clean
  cache before showing the loading state.
- Keep the existing `openNote` request as the authoritative refresh.
- Preserve one code path for mounting cached content and server content so
  frontmatter handling, cursor restore, source mode, and editor configuration
  stay consistent.
- Avoid speculative loading at this stage; this is read-through cache behavior
  only.

Gate:

- Cached note opens feel immediate.
- Cache miss behavior is unchanged.
- There is no new dirty-draft persistence path.

Acceptance tests:

- Open a note with a valid cached body from recent notes and assert it appears
  before the delayed server response.
- Open a note without a valid cache and assert the current loading behavior
  remains.
- Open an already-loaded tab and assert the loaded tab state wins over cache.
- Open from a search result and assert `noteId`, not path, drives the cache
  lookup.

### Stage 4: Optional Idle Cache Warming

Purpose:

- Populate the clean-body cache for likely next notes without making bootstrap
  heavier.

Default:

- Skip this stage unless measurement shows note-open latency is still annoying
  after read-through caching.

If implemented:

- After the active note is loaded and the browser is idle, warm at most a tiny
  set of clean bodies: inactive open tabs first, then pinned or recent notes.
- Limit by count and idle budget.
- Stop when the user types, saves, switches vaults, or opens another note.
- Do not mark tabs loaded because of prewarming; only write clean bodies into
  the cache.
- Ignore results if the vault changed or metadata hash no longer matches.

Gate:

- No extra note-body requests happen before the active note is ready.
- Prewarming never changes visible tab state.
- Prewarming improves second-note open latency in manual measurement.

Acceptance tests:

- With idle callbacks mocked, inactive open tabs are warmed only after active
  note readiness.
- User activity cancels or delays warming.
- Vault switch invalidates pending warm results.
- Warmed content is stored as clean cache data only.

### Stage 5: Small Opportunistic Cleanups

These are deliberately secondary. They should be done only when they are simple
and clearly reduce work.

- Lazy-load HTML import and `defuddle` so rare import code is not part of the
  initial editing path.
- Add request sequencing to search if stale search responses can overwrite a
  newer query's results.
- Fix obvious `transition: all` or layout-property transitions when touching the
  related CSS.
- Add conservative static cache headers if they stay simple with the current
  un-hashed `app.js` and `app.css` outputs.
- Fix autosave follow-up behavior if testing shows edits made during an
  in-flight save can remain dirty longer than expected, but keep it as a small
  per-tab pending flag rather than a general queue.

Do not expand these into separate architecture projects unless measurement
shows they are more important than note-body cache latency.

## Suggested Execution Order

1. Add minimal marks and manually measure boot and active note open.
2. Implement the clean note body cache.
3. Use the cache for restored active tabs.
4. Extend the same read-through path to note opening from recent, pinned,
   search, and closed tabs.
5. Re-measure before adding idle cache warming.
6. Apply small opportunistic cleanups only when they are straightforward.

## Post-Rewrite Acceptance Criteria

This follow-up roadmap is complete when:

- A restored active tab with a valid cached hash can show content before
  `openNote` resolves.
- A cached note opened from recent, pinned, search, or closed tabs can render
  immediately when the hash matches current metadata.
- Stale cached hashes are ignored.
- Dirty drafts are never written to IndexedDB.
- Late server responses never overwrite local dirty drafts.
- Successful saves, revision restores, and conflict restores refresh the clean
  cache.
- Deletes remove cached bodies for the deleted note in that vault.
- Vault switches cannot leak cached content across vaults.
- IndexedDB failure behaves like a cache miss.
- No granular rendering framework, service worker, browser search index, or
  broad sync engine was introduced.
