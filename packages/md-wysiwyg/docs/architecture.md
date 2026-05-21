# Architecture

## Model Ownership

The visual editor keeps Markdown body text in an explicit editor model. The DOM is
a projection of that model plus the active browser input surface; it is not the
canonical document state for normal editing, snapshots, autosave, or cursor
persistence.

The model uses lines as the lossless storage primitive:

| Markdown | Model lines |
| --- | --- |
| `""` | `[""]` |
| `"foo"` | `["foo"]` |
| `"foo\n"` | `["foo", ""]` |
| `"foo\n\nbar"` | `["foo", "", "bar"]` |
| `"\n\nfoo"` | `["", "", "foo"]` |

Line endings are normalized to LF before entering the editor model. Converting
back to a platform-specific on-disk newline format is outside this package.

`docToMarkdown(markdownToDoc(md))` must preserve normalized Markdown exactly,
including leading blank lines, trailing blank lines, and repeated blank lines.

## Blocks

Blocks are derived from model lines. They are addressable editing primitives, not
a replacement storage format.

The block index groups headings, paragraphs, lists, task lists, code fences,
tables, blockquotes or callouts, horizontal rules, and blank runs. Each rendered
block receives `data-md-block-id` and `data-md-block-kind`, and each editable line
host receives `data-md-line-id` and `data-md-line-index`.

Block ids may be regenerated after wholesale Markdown replacement. Editing logic
must treat block grouping as derived and disposable; Markdown lines remain the
source of truth.

## Selection

Durable selection is logical:

- Text selection is stored as line and UTF-16 column positions.
- Block selection stores anchor and focus block ids.
- Snapshot offsets are computed from the model, not from full DOM serialization.

The editor renderer adds source-span metadata to inline leaves in visual editor
mode. For example, a rendered `strong` element from `**bold**` exposes the source
span for the whole Markdown construct and the content span for `bold`. This lets
DOM selections inside formatted text map back to Markdown source offsets without
inserting marker elements and serializing the whole editor.

Extension inline output that cannot expose internal source positions is treated
as atomic. Cursor mapping supports positions before and after the atomic source
span.

## Rendering

Rendering is deterministic from Markdown plus logical selection. The editor uses
the editor render path for visual editing and keeps the standalone
`renderMarkdown`/`domToMarkdown` pair for non-editor rendering, import, paste,
and compatibility paths.

Full renders are used for document-wide state changes such as source-mode
transitions, undo/redo, formatting, paste, block selection replacement, and
structural edits that add/remove lines or need surrounding block context.
Single-line inline and block input transforms use a line-range render: the
renderer replaces the affected modeled line and then rebuilds metadata from the
new DOM. Ordinary typing does not render the document: the browser mutates the
active line host and the editor reconciles that one host back into the model.

Blank Markdown lines render as `data-md-blank="true"` lanes. Blank separators
between content blocks are visible so `foo\n\nbar` has a real editable visual
gap. Leading/trailing single blank cursor lines may be hidden until active, and
hidden blank lanes are still model lines that serialize through `docToMarkdown`.

## Input

Ordinary native text input is limited to the active editable line host. On input,
the editor reads that host, updates the corresponding model line, updates logical
selection from line metadata, and schedules change handling.

Structural editing is intercepted before the browser creates untracked document
state. Enter, Backspace, Delete, paste, and block-selection replacement apply
model transactions, render from the model, restore logical selection from line
and source-span metadata, and notify callers.

Composition input keeps structural rerenders away from the active host until
composition ends, then reconciles the host back into the model.

## Undo And Redo

Undo entries store Markdown and selection offsets. Undo and redo restore the
model, render from Markdown, restore selection through line/source metadata, and
fire the editor change callback.

Typing checkpoints are debounced. Structural transactions checkpoint
synchronously before applying the model change.

## Source Mode

Source mode is a raw Markdown textarea over the same model. Entering source mode
syncs the visual host, writes `docToMarkdown(state.doc)` into the textarea, and
maps logical selection to textarea offsets. Leaving source mode reads the
textarea, normalizes line endings, rebuilds the model, renders the visual editor,
and restores selection.

Source mode must not add, remove, or collapse blank lines.

## Snapshots

`getSnapshot()` returns one coherent view of the editor state:

- Markdown from the model.
- Cursor and selection offsets from the same model revision.
- The current revision number.
- Current source-mode state.

App autosave and draft capture should prefer this snapshot over separate
`getValue()` and cursor reads, so saved content and cursor offsets cannot come
from different revisions.

## Gutter Selection

Each rendered block receives a focusable gutter handle with the accessible label
`Select block`. Clicking a handle creates a block selection; shift-click extends
the block range.

Copy, cut, Delete, Backspace, and typing while a block is selected operate on the
exact Markdown source span for the selected block range. Escape collapses the
selection to a text cursor at the start of the first selected block.

Drag, reorder, slash commands, and block action menus are intentionally outside
this editor core.

## Compatibility Boundaries

`domToMarkdown` remains part of the public standalone serialize API and is still
used for HTML import/paste compatibility and other fallback paths. It must not be
the source of truth for visual editor snapshots, autosave, ordinary typing, or
cursor capture.

Legacy DOM mutation transform helpers have been removed. Visual editing uses
model transactions, inline pattern matching, renderer output, and DOM metadata
instead of direct DOM rewrites as source of truth.

Frontmatter remains app-owned. This package receives and returns Markdown body
content only.
