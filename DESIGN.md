# Tansu2 Design

## Status

This document captures the current intended design for `tansu2`, a clean successor
to the existing `tansu` app. The existing app in `/Users/josh/d/tansu` remains the
reference implementation for behavior, editor package integration, and tests, but
`tansu2` should not inherit its frontend architecture or route shape by default.

The rewrite is intentionally radical in structure and conservative in core data
semantics. The app is a local Markdown note system where note content integrity is
the highest priority. The UI should feel quiet, focused, sparse, and utilitarian,
close in ethos to Codex Desktop and ChatGPT rather than a dense IDE or a decorated
knowledge-base app.

## Design Goals

1. Keep the core small enough to reason about.
2. Make vault isolation explicit everywhere.
3. Give every note a durable hidden identity.
4. Make every accepted content-changing write recoverable.
5. Keep Markdown files clean and directly useful outside the app.
6. Keep the API boundary typed from Rust to TypeScript with `ts-rs`.
7. Minimize frontend HTTP requests, especially during startup.
8. Preserve the good editor package boundary from the current app.
9. Replace Solid with simple imperative DOM and explicit state ownership.
10. Build the integration harness before feature work can drift.

## Non-Goals For V1

These are deliberately excluded from V1 unless this document is revised.

- Offline resilience, IndexedDB caching, offline write queues, and offline session
  replay.
- Encryption UI, WebAuthn PRF flows, locked vault screens, encrypted search
  indexes, and crypto migration. Storage abstractions should leave room for this,
  but the V1 app should not implement it.
- Wiki links, backlinks, wiki-link autocomplete, automatic link rewrite on rename,
  or link identity tracking.
- Automatic file renaming based on the first Markdown heading.
- Floating format toolbar.
- Score-breakdown UI.
- Broad settings parity with the current app.
- Automatic server-side filename suffix allocation for create or rename.
- Revision pruning or compaction.

HTML import is not deferred. It is part of V1.

## What To Preserve From Current Tansu

### Rust Server Direction

The current Rust server is worth preserving in spirit:

- A small local HTTP server.
- Plain request/response JSON APIs.
- `httparse` based HTTP parsing is acceptable.
- `notify` based filesystem watching is acceptable.
- `tantivy` based search is acceptable.
- `pulldown-cmark` based Markdown stripping is acceptable.
- `serde` and `serde_json` remain the serialization foundation.
- `ts-rs` remains the source of frontend API type generation.

The current `src/main.rs` has grown too large. `tansu2` should keep the small
server philosophy but split responsibilities into explicit modules.

### Editor Package

`packages/md-wysiwyg` is copied into `tansu2` and maintained as an in-repo
workspace package. It should start from the current package implementation, but
it should be freely modified to serve `tansu2`. Preserving a reusable public
package API is not a priority for V1.

The package boundary exists because editor internals are complex and deserve a
clear owner. It is not a compatibility promise. Exports, filenames, internal
types, tests, and extension APIs may change whenever that makes the app simpler
or more correct.

The package owns:

- Markdown to HTML rendering.
- DOM to Markdown serialization.
- `contenteditable` behavior.
- Selection and cursor preservation.
- Source mode.
- Undo/redo in browser memory.
- Markdown formatting operations.
- Image paste conversion hooks.
- Callout and image extensions.

The app must not become a second editor engine. The app integrates the editor,
but Markdown rendering and contenteditable internals stay in the package.

Required package adjustments:

- Keep the package framework-neutral unless a future decision intentionally
  folds it fully into the app.
- Keep useful package tests with the copied package and adjust them as behavior
  changes.
- Preserve the Markdown render/serialize round-trip invariants.
- Preserve source mode and browser-memory undo/redo.
- Preserve the wiki-image extension for `![[image.webp]]`.
- Preserve the callout extension if it remains stable.
- Keep the wiki-link extension available in the package only if it is cheap to
  retain, but do not enable it in the app.
- Remove or simplify package exports that exist only for the old Solid app if
  they are no longer used.
- Do not import from `web/ts` or app-owned modules.

### Search Concepts

The existing search model is good enough for V1:

- Indexed fields: title, headings, tags, stripped content.
- Search weights are configurable.
- Recency boost is configurable.
- Excluded folders are configurable and trigger reindex.
- Snippets are generated from stripped Markdown content.

V1 can drop score-breakdown UI even if the backend keeps enough internal data to
support it later.

### Tags

Tags remain a first-class V1 feature. They are stored in note frontmatter and are
indexed for search. The UI should keep full tag editing, including a small tag row
and autocomplete.

### Images

Image upload and rendering remain V1 features. The app should keep the practical
current behavior:

- Pasted images are converted client-side to WebP.
- Server stores image blobs inside the active vault.
- Markdown embeds are generated by the editor package.
- Images are served from the active vault only.

Images are opaque assets in V1. They are not revisioned, content-addressed, or
garbage collected by the core history system.

### HTML Import

HTML import remains V1. The current feature is client-side and should stay that
way:

- The command palette exposes an import action.
- A hidden file input accepts `.html`, `.htm`, and `text/html`.
- The client uses Defuddle to parse the document and produce Markdown.
- Import must fail rather than save raw HTML if Markdown conversion is unavailable.
- Article metadata becomes frontmatter.
- The result is created through the normal note creation API.

Server storage and history should treat imported notes exactly like any other note.
The import feature may choose a non-colliding candidate path in the UI, but the
server create endpoint must still fail explicitly on a path collision.

## Dependency Policy

Dependencies are acceptable when they remove real custom infrastructure.

Likely Rust runtime dependencies:

- `httparse`
- `notify`
- `serde`
- `serde_json`
- `tantivy`
- `pulldown-cmark`
- `ts-rs`
- `rusqlite`
- `lz4_flex`
- `sha2`
- a random-byte source for durable note IDs

Likely frontend runtime dependencies:

- local workspace package `packages/md-wysiwyg`
- `defuddle`

Likely dev dependencies:

- `esbuild`
- `vitest`
- `happy-dom`
- `playwright`
- TypeScript tooling and lint/format tooling as chosen by the repo

Solid should not be a runtime dependency.

## Repository Shape

The exact layout can evolve, but ownership should be visible from paths.

Suggested high-level layout:

```text
Cargo.toml
package.json
pnpm-workspace.yaml
src/
  main.rs
  lib.rs
  app.rs
  api.rs
  api_types.rs
  bootstrap.rs
  catalog.rs
  config.rs
  history.rs
  html.rs
  http.rs
  images.rs
  notes.rs
  paths.rs
  reconcile.rs
  search.rs
  settings.rs
  tags.rs
  vault.rs
  watcher.rs
web/
  index.html
  static/
    app.css
    app.js
  ts/
    main.ts
    api.ts
    app-state.ts
    dom.ts
    editor.ts
    import-html.ts
    palette.ts
    revisions.ts
    search.ts
    settings.ts
    sidebar.ts
    tabs.ts
    tags.ts
    types.generated.ts
packages/
  md-wysiwyg/
tests/
  fixtures/
```

Module names are not final, but the design requires these ownership boundaries:

- HTTP parsing and response writing are infrastructure.
- API route dispatch is not storage logic.
- Vault runtime owns all per-vault state.
- SQLite catalog owns metadata and transactions.
- History store owns compressed snapshots and conflict drafts.
- Search owns Tantivy indexing and query behavior.
- Frontend app state is not mixed into DOM helpers.
- Editor integration is not mixed into app routing or storage APIs.

## Load-Bearing Data Structures And Algorithms

These are the decisions most likely to cause complexity or data loss if they are
left vague. They should be implemented early, named directly in code, and covered
by focused tests.

### `NoteId` And `path_key`

`NoteId` is the durable identity. `path` is display and filesystem placement.
`path_key` is the normalized case-folded uniqueness key for live notes.

This trio is load-bearing because almost every other structure depends on it:
tabs, pins, recent notes, history, search hits, conflict drafts, deletes, and
renames all need to survive path changes. Server code should almost never pass a
path where it can pass a `NoteId`.

Decisions to nail down:

- `NoteId` is generated once from random bytes and never derived from path or
  content.
- `path` preserves user-facing casing and `/` separators.
- `path_key` is stored in SQLite and is the only live-path uniqueness key.
- `path_key` construction must be one shared helper used by create, rename,
  startup scan, watcher reconciliation, and tests.
- Case-fold collisions are integrity issues, not UI prompts hidden inside create
  or scan code.

### Catalog Current State And Event Log

The catalog deliberately has both current-state rows and an event log:

- `notes` is the current queryable state.
- `note_events` is the durable audit/history index.
- history blobs are the recoverable content payloads.

This is not a pure event-sourced system. Normal reads should not replay every
event. The event log exists for recovery, revisions, grouping, and audit.

Decisions to nail down:

- `notes.seq` equals the latest committed event sequence for that note.
- `note_events.seq` is monotonic per note.
- `note_events.event_id` is monotonic per vault.
- `vault_meta.sync_version` advances for any frontend-visible state change.
- Event kinds are a closed enum generated to TypeScript.
- Event source is also a closed enum generated to TypeScript.
- Pure rename events may omit a content blob only when the content hash is
  unchanged and an earlier valid snapshot for that hash already exists.
- `notes.content_hash` must match the visible Markdown file after successful
  startup repair and after every accepted save.

The test suite should include direct catalog tests for sequence increments,
event ordering, sync version changes, and current-state/event-log consistency.

### Snapshot And Hash Format

History snapshots are full compressed Markdown payloads. Deltas are deferred.

Decisions to nail down:

- Snapshot bytes are the exact UTF-8 Markdown bytes accepted by the server.
- Hashes are serialized as `sha256:<lowercase-hex>`.
- Every content-changing event has a recoverable full snapshot.
- Snapshot reads verify uncompressed length and content hash.
- Corrupt or missing snapshots produce typed errors and never trigger blind
  overwrites of visible Markdown.

This format should be boring. Its value is that repair code can trust a single
blob without reconstructing a chain.

### Save Ordering And Startup Repair

The save algorithm is one of the most important parts of the rewrite. It defines
what content is recoverable after a crash.

The core decision is that accepted server writes become durable in catalog and
history before the visible Markdown projection is replaced. Startup repair then
uses the latest committed snapshot to finish interrupted accepted writes.

This requires shared helpers for:

- atomic temp-file writes
- snapshot write and verification
- Markdown temp-file write
- SQLite transaction boundaries
- startup invariant checks
- repair classification

The implementation should avoid scattering save variants. Create, save, restore,
delete, import, and conflict recovery should share the same content-event write
path wherever possible.

### Reconciliation Matching

External filesystem reconciliation should be conservative and deterministic.

Recommended scan algorithm:

1. Walk visible Markdown files and build file records containing `path`,
   `path_key`, hash, title, tags, and mtime.
2. Split duplicate `path_key` groups before identity matching.
3. Match catalog rows whose current path still exists.
4. For matched paths, compare hashes and append external edit events when needed.
5. For missing catalog paths, match by exact hash only when exactly one new file
   has that hash.
6. Treat unmatched missing catalog rows as external deletes when their latest
   snapshot is valid.
7. Treat unmatched new files as new notes with new IDs.
8. Mark ambiguous or unsafe cases unresolved.

Do not use filename similarity, title similarity, mtime proximity, or content
similarity to preserve identity. Those heuristics are attractive but they create
wrong-note risks that are worse than losing identity continuity.

### Conflict Drafts

A conflict draft is the user's rejected attempted content, not a hidden second
version of the note.

Decisions to nail down:

- Conflict drafts are compressed blobs with catalog metadata.
- Creating a conflict draft does not change `notes.seq`.
- Creating a conflict draft does not append a note revision event.
- The `save_conflict` API error returns the current canonical document and draft
  metadata in the typed error payload.
- Accepting or merging a draft creates a normal `conflict_recovery` event.

This keeps conflicts recoverable without making every rejected save look like an
accepted revision.

### Session State, Tabs, And Closed Tabs

Session state is per vault and stored in SQLite. It is product state, not note
content.

V1 session state should include:

- open tabs by `NoteId`
- active tab
- cursor positions
- source/content mode if preserving it stays simple
- closed-tab reopen stack

Dirty draft content is not persisted. If the browser closes before a dirty draft
is accepted by the server, the app can warn but cannot recover that draft in V1.

Closed tabs should be a small V1 feature:

- The stack is bounded, with `20` as a reasonable default.
- Entries are keyed by `NoteId`.
- Entries may cache path/title at close time for display.
- Reopening a closed tab resolves the current note by ID.
- If the note is deleted, unresolved, or missing, the entry is dropped and the UI
  shows a quiet notification.
- If the note is already open, reopen switches to that tab instead of duplicating
  it.

### Frontend App State

The imperative frontend still needs a disciplined state model.

Load-bearing choices:

- `notes` is a `Map<NoteId, NoteMeta>` hydrated from bootstrap and SSE.
- tabs use app-generated tab IDs for UI identity and `NoteId` for note identity.
- only the active tab is mounted into `md-wysiwyg`.
- inactive tabs may hold draft Markdown in memory.
- every state transition that affects session persistence goes through one
  session writer.
- DOM helpers render from state; they do not own durable app data.

This prevents the imperative UI from becoming implicit global state spread across
event handlers.

### API Error Union

API errors are part of the server/UI contract, not incidental fetch failures.

The exact `ApiErrorResponse`, `ApiErrorKind`, and code-specific detail enums are
defined in Rust with the rest of `api_types.rs` and exported through `ts-rs`.
The frontend imports these generated types and switches on `error.code`.

Handwritten TypeScript string unions for server error codes are not allowed. If
the UI needs to distinguish a new error reason, the Rust type grows first and the
generated TypeScript follows.

### Search Index

Search is derived state. The catalog and Markdown files are canonical.

Load-bearing choices:

- Search documents are keyed by `NoteId`.
- Tombstoned notes are removed from search.
- Unresolved notes are removed from search.
- Reindexing excluded folders is a vault-local operation.
- Search results return current catalog metadata, not stale metadata copied into
  the index when avoidable.

Search can be rebuilt. It should not become a second metadata database.

## Vault Model

### Vault Configuration

The server reads vaults from `~/.config/tansu/config.toml` or
`$XDG_CONFIG_HOME/tansu/config.toml`.

Example:

```toml
[vault.personal]
dir = "~/notes"

[vault.work]
dir = "~/work-notes"
```

Each configured vault receives a stable numeric index based on config order for
the current server run. This index is transport selection, not durable identity.

The server must reject nested vaults before opening databases or watchers.

### Vault Isolation

Every vault has an independent runtime:

- root directory
- SQLite catalog
- history blobs
- image assets
- search index
- settings
- session state
- pinned notes
- recent notes
- file watcher
- SSE clients

No per-vault data structure should be shared across vaults except immutable app
configuration and static assets.

Every vault-scoped HTTP request must carry explicit vault selection:

- `X-Tansu-Vault: <index>` for normal fetch requests.
- `/events?vault=<index>` for SSE.

The frontend stores the selected vault index in `sessionStorage`, preserving
tab-scoped vault selection. This prevents two browser tabs from accidentally
switching each other between vaults.

### Vault Disk Layout

Suggested V1 layout:

```text
<vault>/
  *.md
  subdir/*.md
  z-images/
    <uploaded-image>.webp
  .tansu/
    vault.db
    history/
      <note-id>/
        <seq>.lz4
    conflict-drafts/
      <draft-id>.lz4
    search-index/
    tmp/
```

Notes stay as regular Markdown files at user-visible paths. `.tansu/vault.db`
stores metadata and history indexes. `.tansu/history` stores compressed full
snapshots. `z-images` remains visible and compatible with the existing image
model.

## Durable Note Identity

### Note IDs

Every note has a durable hidden `NoteId`. The recommended representation is a
lowercase 128-bit hex string generated from OS randomness without adding a UUID
crate.

Example:

```text
4f7d2fcd23fb4f8dbb4e88c0c2df1019
```

The ID is stored in SQLite only. It is not inserted into Markdown frontmatter.

### Path Is Not Identity

The current path is mutable metadata. Rename changes path, not identity.

Consequences:

- Tabs should track `NoteId`, not path.
- Pinned notes should track `NoteId`, not path.
- Recent notes should track `NoteId`, not path.
- Revision history is keyed by `NoteId`, not path.
- Search hits return `NoteId` plus current path/title metadata.
- A restore operation restores content to the current path of the same note ID.

### Markdown Cleanliness

Markdown files should remain useful outside Tansu:

- No hidden IDs in frontmatter.
- No Tansu-specific link syntax.
- No embedded history markers.
- Tags remain normal frontmatter because they are user-visible metadata.

## Note Content Model

### Content

Canonical user content is Markdown text stored in the visible `.md` file. The
history system stores compressed snapshots of accepted content for recovery and
audit.

The app should avoid modifying content unless the user performs an action that
clearly changes content:

- edit in editor
- edit tags
- import HTML
- restore revision
- create note with seed content

### Tags

Tags are parsed from frontmatter:

```markdown
---
tags: [alpha, beta]
---

# Note title
```

The editor UI should show tags separately but save them back into frontmatter.

Tag normalization is intentionally simple:

- trim whitespace
- reject empty tags
- lowercase tags
- avoid complex tag query syntax in V1

Tag editing must preserve non-tag frontmatter fields. This matters for imported
HTML notes, which may contain `title`, `date`, `author`, and `description`
frontmatter. The tag UI is allowed to add, replace, or remove only the `tags`
field; it must not rebuild the entire frontmatter block from scratch and discard
unknown keys.

### Titles

Display title rule:

1. First Markdown H1 in the note body.
2. Filename stem if no H1 exists.

Create may seed a new note with an H1 derived from the requested filename. Future
saves never rename the file when the H1 changes.

HTML import should seed an H1 from the article title when Defuddle produces
metadata but the imported Markdown body does not already start with an H1. The
frontmatter `title` field is preserved as imported metadata, but display title
still follows the H1-then-path rule.

### Create And Rename

Create fails if the requested path already exists.

Rename fails if the target path already exists.

The server must not silently suffix paths for normal create or rename. A UI flow
may offer another path and retry, but path choice remains explicit at the UI level.

### Path Policy

All note paths are vault-relative UTF-8 paths using `/` as the separator.

Rules:

- Paths must be non-empty.
- Paths must end in `.md`.
- Absolute paths are rejected.
- `.` and `..` segments are rejected.
- Paths under `.tansu/` are rejected.
- Parent directories may be created by create and rename operations.
- Backslashes are rejected before storage; the catalog stores `/` separators only.
- Path display preserves user casing.
- Path uniqueness uses a case-folded `path_key` so `Note.md` and `note.md` are
  treated as the same live path even on case-sensitive filesystems. This avoids
  cross-platform vault surprises.
- Tombstoned notes retain their last path for history display, but do not reserve
  that path for new live notes.
- If first scan finds multiple existing files with the same `path_key`, Tansu
  imports the lexicographically first path as live and records the other files as
  unresolved `path_case_collision` notes without modifying or deleting them.

## SQLite Catalog

SQLite is used because the rewrite needs transactional metadata, durable IDs,
rename-safe history, and simple startup repair without hand-writing a database out
of JSON manifests.

The database is per vault, not global.

### Suggested Tables

The exact schema can be adjusted during implementation, but the model should cover
these records.

```sql
CREATE TABLE schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at INTEGER NOT NULL
);

CREATE TABLE vault_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE notes (
  id TEXT PRIMARY KEY,
  path TEXT NOT NULL,
  path_key TEXT NOT NULL,
  title TEXT NOT NULL,
  tags_json TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  seq INTEGER NOT NULL,
  mtime INTEGER NOT NULL,
  deleted_at INTEGER,
  unresolved_reason TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX live_notes_path_key_unique
  ON notes(path_key)
  WHERE deleted_at IS NULL;

CREATE TABLE note_events (
  event_id INTEGER NOT NULL UNIQUE,
  note_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  kind TEXT NOT NULL,
  path TEXT NOT NULL,
  previous_path TEXT,
  content_hash TEXT NOT NULL,
  parent_hash TEXT,
  blob_path TEXT,
  uncompressed_len INTEGER,
  created_at INTEGER NOT NULL,
  is_checkpoint INTEGER NOT NULL,
  group_id TEXT,
  source TEXT NOT NULL,
  PRIMARY KEY (note_id, seq),
  FOREIGN KEY (note_id) REFERENCES notes(id)
);

CREATE TABLE conflict_drafts (
  id TEXT PRIMARY KEY,
  note_id TEXT NOT NULL,
  base_seq INTEGER NOT NULL,
  base_hash TEXT NOT NULL,
  attempted_hash TEXT NOT NULL,
  blob_path TEXT NOT NULL,
  uncompressed_len INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (note_id) REFERENCES notes(id)
);

CREATE TABLE pinned_notes (
  note_id TEXT PRIMARY KEY,
  position INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (note_id) REFERENCES notes(id)
);

CREATE TABLE recent_notes (
  note_id TEXT PRIMARY KEY,
  last_opened_at INTEGER NOT NULL,
  FOREIGN KEY (note_id) REFERENCES notes(id)
);

CREATE TABLE session_state (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
```

### Notes On The Schema

- `content_hash` should be a stable hash of the exact UTF-8 Markdown bytes.
- `seq` is monotonic per note.
- `event_id` is monotonic per vault and is used to derive `sync_version`.
- `path_key` is normalized/case-folded for live path uniqueness.
- `deleted_at` marks a tombstoned note.
- `unresolved_reason` marks a catalog/file/history inconsistency that startup
  repair could not resolve automatically. Unresolved notes are excluded from
  ordinary lists and search until a later recovery action handles them.
- `note_events.kind` values include baseline, autosave, manual_save, restore,
  rename, delete, external_edit, external_rename, import, and conflict_recovery.
- `is_checkpoint` marks events that should be prominent in the UI.
- `group_id` lets the UI group autosave bursts without losing individual events.
- `blob_path` may be null for pure rename events if content did not change.
- `vault_meta.sync_version` increments for any change that should cause bootstrap
  consumers to refresh: note metadata, settings, pins, recent notes, and session
  state.

SQLite setup should use `rusqlite` with the `bundled` feature for predictable
developer and release builds. Each connection should enable
`PRAGMA foreign_keys = ON` and a reasonable `busy_timeout`. V1 should avoid
clever WAL tuning until there is evidence it is needed.

### Settings Storage

Settings live in SQLite rather than `.tansu/settings.json` in `tansu2`.

Essential V1 settings:

- search title weight
- search heading weight
- search tag weight
- search content weight
- fuzzy distance
- recency boost
- result limit
- excluded folders
- autosave delay
- editor undo stack size
- image WebP quality

V1 does not expose theme or appearance settings. The minimalist visual language is
implemented as fixed CSS tokens first. Appearance customization can be revisited
after the core workflows are stable.

Default values should start close to the current app:

- title search weight: `10`
- heading search weight: `5`
- tag search weight: `25`
- content search weight: `1`
- fuzzy distance: `1`
- recency boost: `7 days`
- result limit: `20`
- autosave delay: `1500ms`
- editor undo stack size: `200`
- image WebP quality: `0.85`

Do not carry over the full current settings surface in V1.

## History Store

### Purpose

The history store exists for integrity, recovery, and restore. It is not the live
editor undo stack.

The server records every accepted content-changing write as a durable event. This
includes debounced autosaves. UI should group autosave bursts so history remains
usable.

### Snapshot Format

V1 stores full compressed snapshots, not deltas.

Recommended file path:

```text
.tansu/history/<note-id>/<seq>.lz4
```

Snapshot payload is the exact Markdown content bytes after the accepted write.

Compression uses `lz4_flex`. This favors speed and simplicity over maximum
compression ratio. Restore is rare, so simplicity is more important than storage
optimization.

Content hashes use SHA-256 over the exact UTF-8 Markdown bytes and are serialized
with an algorithm prefix:

```text
sha256:<lowercase-hex>
```

The prefix makes a future hash migration possible without guessing which
algorithm produced existing rows.

### Event Kinds

Baseline:

- Created during first catalog scan for existing files.
- Created during note creation.
- Represents the first known state for a note ID.

Autosave:

- Created by debounced editor save.
- Durable and recoverable.
- Usually not individually emphasized in the UI.
- Consecutive autosaves for the same note are assigned the same `group_id` until
  a checkpoint event occurs or the group is idle for more than 10 minutes.

Manual save:

- Created by explicit save command.
- Marked as checkpoint.

Restore:

- Created when restoring an older revision.
- The current content before restore remains recoverable as its previous event.
- Marked as checkpoint.

Rename:

- Preserves note ID.
- Records previous path and new path.
- May have no content blob if content did not change.
- Marked as checkpoint.

Delete:

- Removes visible Markdown file.
- Records final content snapshot and tombstone.
- Marked as checkpoint.

External edit:

- Created when watcher or startup reconciliation detects content changed on disk
  outside a server self-write.
- Marked as checkpoint. External edits should be easy to see in history because
  they happened outside the app's normal save loop.

Conflict recovery:

- Created when user accepts or merges a conflict draft.
- Marked as checkpoint.

Import:

- Created when HTML import creates a note.
- Marked as checkpoint.

### Retention

V1 keeps history forever. No automatic pruning. No compaction. No manual pruning
unless explicitly added later.

This is deliberate. Deleting history before the write format and repair behavior
are proven would undermine the integrity goal.

## Save Protocol

### Client Contract

The client saves a note by ID:

```json
{
  "content": "...",
  "expected_seq": 17,
  "expected_hash": "sha256...",
  "source": "autosave",
  "cursor": 1234
}
```

`expected_seq` and `expected_hash` protect against stale writes. Both are needed:

- `seq` catches normal ordering conflicts.
- `hash` catches catalog/file repair edge cases and accidental sequence mistakes.

### Accepted Save

An accepted save:

1. Validates vault selection.
2. Resolves note ID to current catalog row.
3. Rejects deleted notes unless this is an allowed restore/recovery action.
4. Validates `expected_seq` and `expected_hash`.
5. Computes new content hash.
6. If content is unchanged, returns current metadata without writing a new event.
7. Executes the write-ordering protocol for the event kind.
8. Updates search index.
9. Updates recent metadata when appropriate.
10. Emits a vault-scoped SSE event.
11. Returns updated note metadata.

If the submitted content hash already equals the current canonical content hash,
the server returns the current document metadata as an idempotent success even
when `expected_seq` or `expected_hash` are stale. This prevents a client retry
after a timeout from creating a false conflict draft.

### Conflict Save

If `expected_seq` or `expected_hash` do not match:

1. The server must not overwrite canonical content.
2. The server writes the attempted content as a compressed conflict draft.
3. The server records a `conflict_drafts` row.
4. The server returns `409` with the standard API error envelope using
   `code: "save_conflict"`. The error includes current canonical metadata,
   current canonical content, and conflict draft metadata.

The client then offers a simple conflict UI:

- keep server version
- restore attempted draft
- manually copy/merge using diff view

Choosing the attempted draft or a merged result becomes a new accepted
content-changing event with kind `conflict_recovery`.

### Atomic Repairable Durability

V1 should use atomic repairable writes rather than strict fsync on every save.

Required:

- Temporary files for snapshots and Markdown writes.
- Rename into place.
- SQLite transactions for catalog changes.
- Content hashes in catalog and events.
- Startup repair that can detect and repair interrupted writes.

Not required in V1:

- fsync every file and directory around each save.
- WAL tuning beyond reasonable SQLite defaults.
- Treating SQLite as the sole canonical content store.

The normal invariant after a successful save:

- note row `content_hash` equals the hash of the visible Markdown file
- note row `seq` equals latest committed event seq
- latest content event has a snapshot blob with the same hash
- search index eventually reflects the latest note row and content

If a crash violates this invariant, startup repair must choose a conservative
recoverable path and avoid data loss.

### Write Ordering And Repair

Tansu has two canonical sources depending on context:

- For normal server-accepted writes, the latest committed catalog event plus its
  snapshot is the recovery source.
- For external edits made while Tansu is stopped or outside a server self-write,
  the visible Markdown file becomes canonical after reconciliation records it.

The visible Markdown file is always the user-facing projection. The catalog and
history exist so interrupted server writes can be repaired without losing accepted
content.

Content save ordering:

1. Validate request and compute hashes.
2. Write compressed snapshot to a temp file and rename it into final history path.
3. Write the new Markdown file contents to a temp file in the target directory.
4. Commit SQLite transaction inserting the event, updating the note row, and
   incrementing `sync_version`.
5. Rename the Markdown temp file over the visible file.
6. Update search and emit SSE.

If the server crashes after the SQLite transaction but before the visible file
rename, startup repair rewrites the visible Markdown file from the latest snapshot.

Create ordering is the same as save, except the visible file is missing before the
final rename. If startup finds a live catalog row with a missing file and a valid
latest snapshot, it recreates the file.

Delete ordering:

1. Read current visible content.
2. Write final compressed snapshot.
3. Commit SQLite transaction inserting the delete event, tombstoning the note,
   removing it from live pins/recent where appropriate, and incrementing
   `sync_version`.
4. Remove the visible Markdown file.

If startup finds a tombstoned note whose visible file still exists at the old
path, it removes the file only when the file hash matches the delete event hash.
If the file differs, startup treats it as a new external file and assigns a new
note ID rather than deleting user content.

Rename ordering:

1. Validate target path and collision policy.
2. Commit SQLite transaction updating the live path and inserting a rename event.
3. Rename the visible file.

If startup finds a live catalog path missing after an interrupted rename and finds
the old path with the expected hash, it completes the rename. If the new path now
exists with unrelated content, reconciliation preserves content by treating the
old path as a new note and keeping the catalog note unresolved until the user or a
future repair policy handles it.

## Delete And Restore

Delete is a tombstone, not history destruction.

Delete behavior:

1. Resolve note ID.
2. Read current Markdown content.
3. Write final snapshot.
4. Insert delete event.
5. Set `deleted_at` on note row.
6. Remove visible Markdown file.
7. Remove from search results.
8. Remove from pinned and recent visible lists.
9. Emit SSE.

Restore from history:

1. Resolve tombstoned or live note ID.
2. Read selected snapshot.
3. Choose current path or requested restore path.
4. Fail explicitly if restoring to a path collision.
5. Write visible Markdown file.
6. Clear tombstone if needed.
7. Append restore event with full snapshot.
8. Reindex.

## Rename

Rename preserves note ID.

Rename behavior:

1. Resolve note ID.
2. Validate target path is inside vault.
3. Fail if target path exists.
4. Insert rename event and update note row path/title in SQLite.
5. Rename visible file.
6. Reindex.
7. Emit SSE.

Rename does not rewrite note content and does not update links because wiki links
are not part of V1.

## External Filesystem Reconciliation

External edits are expected. Users can edit Markdown files outside Tansu.

The reconciliation policy is intentionally conservative.

### Startup Scan

On startup each vault is scanned before serving normal requests.

For each Markdown file:

- compute path
- read content
- compute hash
- parse title and tags
- compare with catalog

For each catalog note:

- check whether current path still exists
- check whether content hash still matches
- check whether exact hash appears at a different path

### Exact Rules

Same path, same hash:

- No event needed.

Same path, different hash:

- Append external edit event with full snapshot.
- Update note row.
- Reindex.

Catalog path missing, exact same hash found at one new path:

- Treat as external rename.
- Preserve note ID.
- Append external rename event.
- Update path.

Catalog path missing, no exact hash found:

- Treat as external delete.
- Tombstone the note only if the latest snapshot is still available. If history
  is missing or corrupt, mark the note unresolved and exclude it from normal
  lists until the user resolves it. Do not silently discard the catalog record.

New path not known to catalog:

- Assign new note ID.
- Append baseline event.
- Index note.

Multiple new paths with the same `path_key`:

- Import the lexicographically first path as live.
- Record the others as unresolved `path_case_collision`.
- Do not rename, delete, or modify any of the files automatically.

Ambiguous moved-and-edited cases:

- Do not guess identity.
- Treat old note as deleted and new file as a new note.

This means a user who moves and edits a file outside Tansu may lose identity
continuity, but not content. That tradeoff is preferable to incorrect identity
matches.

### Watcher Events

Watcher events follow the same rules but can operate incrementally. The watcher
must ignore server self-writes to avoid duplicate external edit events.

If a watcher event is ambiguous, it can schedule a small vault reconciliation pass
rather than deciding from the raw event alone.

### Unresolved Notes

An unresolved note is a catalog record that Tansu refuses to expose as a normal
note because automatic repair would require guessing or could destroy user
content. It is a quarantine state for integrity problems, not a normal editing
state.

Examples:

- Multiple existing files have the same case-folded `path_key`.
- A live catalog row has no visible file and its latest snapshot is missing or
  corrupt.
- An interrupted rename leaves the expected old path, expected new path, and an
  unrelated file in conflict.
- A tombstoned note still has a visible file at its old path, but the visible file
  hash no longer matches the delete event snapshot.

Behavior:

- The visible files are not renamed, deleted, or modified automatically.
- The catalog record keeps its note ID, last known path, sequence, and history
  metadata.
- `notes.unresolved_reason` records a short stable snake_case reason value such
  as `path_case_collision`, `missing_snapshot`, `corrupt_snapshot`, or
  `interrupted_rename_conflict`. The API exposes these values through generated
  `ts-rs` enums, not handwritten frontend strings.
- Unresolved notes are excluded from normal bootstrap note lists, pinned/recent
  lists, and search.
- Bootstrap may include a `repair_issues` list so the frontend can show a quiet
  diagnostic banner or settings panel entry.
- V1 does not need a full repair UI. The safe V1 action is to tell the user which
  vault paths need manual attention.

No unresolved-note path should block the rest of the vault from loading. The
point of the unresolved state is to keep the vault usable while preserving every
piece of content the server is unsure about.

## Search

Search is per vault.

Index fields:

- note ID
- path
- title
- tags
- headings
- stripped content
- mtime or updated timestamp

Search should exclude tombstoned notes.
Search should also exclude unresolved notes.

Search results return current note metadata:

```json
{
  "id": "note-id",
  "path": "folder/note.md",
  "title": "Note title",
  "tags": ["tag"],
  "excerpt": "...",
  "score": 12.3
}
```

V1 should keep query behavior simple:

- split query text similarly to Tantivy tokenization
- exact and prefix matching first
- optional fuzzy fallback
- optional recency boost
- no tag query language

## Images

Images are opaque assets.

Recommended layout:

```text
<vault>/z-images/<filename>.webp
```

Upload behavior:

1. Client converts pasted image to WebP.
2. Client sends blob to active vault.
3. Server validates filename and keeps it inside `z-images`.
4. Server allocates a unique image filename if needed for upload only.
5. Server returns image filename.
6. Editor inserts image Markdown through the editor package.

Image serving:

- Only serve from active vault.
- Normalize paths to prevent traversal.
- Use correct MIME type.

Image history:

- Not versioned.
- Not garbage-collected in V1.
- Not checked in the note revision integrity model.

This means an old revision may reference an image file that later changes or is
deleted outside Tansu. That is acceptable in V1.

HTML import does not fetch or rewrite remote article assets in V1. If Defuddle
emits remote image URLs, they remain ordinary Markdown image URLs. Only images
pasted or uploaded through the editor become vault-local `z-images` assets.

## HTML Import

HTML import is a frontend feature that creates ordinary notes.

### Flow

1. User triggers command palette action or shortcut.
2. Hidden file input opens.
3. Client reads selected HTML file as text.
4. Client creates a temporary object URL for base URL resolution.
5. Client parses the document with `DOMParser`.
6. Client runs Defuddle with Markdown output enabled.
7. If Defuddle does not return Markdown, import fails with an alert.
8. Client builds Markdown frontmatter from article metadata.
9. Client ensures the imported Markdown body starts with an H1 when article title
   metadata exists and the body has no leading H1.
10. Client chooses an initial path based on sanitized filename stem.
11. Client calls normal create API.
12. If create returns collision, client may choose a new explicit candidate path
    such as `stem-1.md` and retry.
13. Imported note opens as a normal tab.

### Frontmatter

HTML import may write:

```markdown
---
title: "Article title"
date: "Published date"
author: "Author"
description: "Description"
---

Imported Markdown...
```

This frontmatter is user content. The server does not need a special import path.

### Tests

HTML import needs both unit and end-to-end coverage:

- conversion saves Markdown, not raw HTML
- missing Markdown conversion cancels import
- metadata frontmatter is present
- create collision retry is explicit and tested
- imported note receives normal note ID and baseline/import history event

## API Boundary

Rust owns DTOs. TypeScript must not redefine API shapes that come from Rust.

Generated types live in frontend source, but are never manually edited.
API error types are generated with the same mechanism as successful response
types. `ApiErrorResponse`, `ApiErrorKind`, stable error codes, and code-specific
reason enums live in `src/api_types.rs`, derive `ts-rs`, and are imported by the
frontend from generated output.

The frontend API wrapper may define a small runtime `ApiError` class, but it
must carry generated payload types rather than recreating server error unions in
TypeScript.

### Core Types

Representative DTOs:

```rust
pub struct NoteId(pub String);

pub struct VaultEntry {
    pub index: usize,
    pub name: String,
    pub active: bool,
    pub status: VaultStatus,
}

pub struct NoteMeta {
    pub id: NoteId,
    pub path: String,
    pub title: String,
    pub tags: Vec<String>,
    pub hash: String,
    pub seq: u64,
    pub mtime: u64,
    pub status: NoteStatus,
}

pub struct NoteDocument {
    pub meta: NoteMeta,
    pub content: String,
}

pub struct RepairIssue {
    pub note_id: Option<NoteId>,
    pub path: Option<String>,
    pub reason: RepairIssueReason,
    pub message: String,
}

pub struct BootstrapResponse {
    pub vaults: Vec<VaultEntry>,
    pub active_vault: usize,
    pub sync_version: u64,
    pub session: SessionState,
    pub settings: Settings,
    pub notes: Vec<NoteMeta>,
    pub pinned: Vec<NoteId>,
    pub recent: Vec<NoteId>,
    pub repair_issues: Vec<RepairIssue>,
}

pub struct SaveNoteRequest {
    pub content: String,
    pub expected_seq: u64,
    pub expected_hash: String,
    pub source: SaveSource,
    pub cursor: Option<usize>,
}

pub struct SaveNoteResponse {
    pub document: NoteDocument,
    pub event: RevisionMeta,
}

pub struct SessionState {
    pub open_tabs: Vec<SessionTab>,
    pub active_tab_id: Option<String>,
    pub closed_tabs: Vec<ClosedTabEntry>,
}

pub struct SessionTab {
    pub tab_id: String,
    pub note_id: NoteId,
    pub cursor: Option<usize>,
}

pub struct ClosedTabEntry {
    pub note_id: NoteId,
    pub path: String,
    pub title: String,
    pub closed_at: u64,
}

pub struct ApiErrorResponse {
    pub request_id: String,
    pub error: ApiErrorKind,
}

#[serde(rename_all = "snake_case")]
pub enum InvalidPathReason {
    Empty,
    MissingMarkdownExtension,
    Absolute,
    ParentSegment,
    ReservedTansuDir,
    Backslash,
    OutsideVault,
}

#[serde(rename_all = "snake_case")]
pub enum RepairIssueReason {
    PathCaseCollision,
    MissingSnapshot,
    CorruptSnapshot,
    InterruptedRenameConflict,
    DeleteConflict,
}

#[serde(tag = "code", rename_all = "snake_case")]
pub enum ApiErrorKind {
    InvalidRequest { message: String },
    MissingVault { message: String, vault: usize },
    InvalidPath { message: String, path: Option<String>, reason: InvalidPathReason },
    NoteNotFound { message: String, id: NoteId },
    RevisionNotFound { message: String, id: NoteId, seq: u64 },
    ConflictDraftNotFound { message: String, draft_id: String },
    PathCollision { message: String, path: String },
    SaveConflict {
        message: String,
        current: NoteDocument,
        draft: ConflictDraftMeta,
    },
    DeletedNote { message: String, id: NoteId },
    UnresolvedNote { message: String, id: NoteId, reason: RepairIssueReason },
    InvalidSettings { message: String, field: Option<String> },
    PayloadTooLarge { message: String, limit_bytes: u64 },
    UnsupportedMediaType { message: String, expected: String },
    MethodNotAllowed { message: String, method: String },
    Internal { message: String },
}
```

Exact Rust representation can differ, but the semantics should not.

### API Error Envelope

Every non-2xx `/api/*` response returns the same JSON envelope:

```json
{
  "request_id": "r-42",
  "error": {
    "code": "path_collision",
    "message": "A note already exists at that path.",
    "path": "notes/example.md"
  }
}
```

Rules:

- `request_id` is always present on API errors. It only needs to be unique within
  the server process and useful in logs.
- `error.code` is a stable snake_case machine code.
- `error.message` is a short human-readable fallback. The frontend may show it,
  but must not parse it.
- Additional fields are code-specific and live directly inside `error`.
- The envelope is used for malformed JSON, validation errors, domain conflicts,
  not-found cases, and server errors.
- Successful responses never include an `error` key.
- HTML/static-file errors may use plain HTTP responses; this envelope is required
  for `/api/*`.

Canonical examples:

```http
HTTP/1.1 400 Bad Request
Content-Type: application/json

{
  "request_id": "r-43",
  "error": {
    "code": "invalid_path",
    "message": "Path is outside the vault.",
    "path": "../x.md",
    "reason": "path_traversal"
  }
}
```

```http
HTTP/1.1 409 Conflict
Content-Type: application/json

{
  "request_id": "r-44",
  "error": {
    "code": "save_conflict",
    "message": "The note changed after this draft was based on it.",
    "current": { "meta": {}, "content": "..." },
    "draft": { "id": "draft-id", "note_id": "note-id", "created_at": 1710000000 }
  }
}
```

Recommended status mapping:

| Code | HTTP status |
| --- | --- |
| `invalid_request` | 400 |
| `missing_vault` | 400 |
| `invalid_path` | 400 |
| `invalid_settings` | 400 |
| `note_not_found` | 404 |
| `revision_not_found` | 404 |
| `conflict_draft_not_found` | 404 |
| `method_not_allowed` | 405 |
| `deleted_note` | 410 |
| `payload_too_large` | 413 |
| `unsupported_media_type` | 415 |
| `path_collision` | 409 |
| `save_conflict` | 409 |
| `unresolved_note` | 409 |
| `internal` | 500 |

The TypeScript API wrapper should throw one `ApiError` class carrying:

- `status`
- `requestId`
- `code`
- the full typed `ApiErrorKind`
- the raw response body for diagnostics

The UI should switch on `error.code`, not status text or message text.

### Endpoint Shape

Primary routes:

```text
GET    /api/bootstrap
GET    /api/notes/:id
POST   /api/notes
PUT    /api/notes/:id
DELETE /api/notes/:id
POST   /api/notes/:id/rename
GET    /api/notes/:id/revisions
GET    /api/notes/:id/revisions/:seq
POST   /api/notes/:id/revisions/:seq/restore
GET    /api/conflict-drafts/:id
POST   /api/conflict-drafts/:id/restore
GET    /api/search?q=
POST   /api/images
GET    /api/settings
PUT    /api/settings
PUT    /api/session
POST   /api/pins/:id
DELETE /api/pins/:id
GET    /events?vault=
```

`GET /api/bootstrap` is the key request-count reducer. It should include enough
metadata for the initial UI without fetching every note body.

### Startup Request Budget

Target startup sequence:

1. Browser loads `index.html`.
2. Browser loads bundled `app.css`.
3. Browser loads bundled `app.js`.
4. App calls `GET /api/bootstrap`.
5. App opens content for the active tab only with `GET /api/notes/:id`.
6. App starts one SSE connection for the active vault.

Inactive restored tabs should not fetch content until selected.

Session state is stored per vault in SQLite. It persists open tabs, active tab,
cursor positions, and the closed-tab reopen stack. It does not persist unsaved
draft content. The frontend must warn on page unload when any tab has unsaved
in-memory changes that have not been accepted by the server.

### Server Startup Happy Path

Server startup is blocking. V1 does not serve partial startup states.

Startup order:

1. Parse CLI flags.
2. Load vault config.
3. Expand and canonicalize vault directories.
4. Reject nested vaults.
5. For each configured vault, synchronously:
   - create `.tansu/` directories as needed
   - open SQLite with migrations
   - run startup repair
   - run full filesystem reconciliation
   - build or rebuild search indexes needed for normal queries
   - load settings, session, pinned, and recent metadata
   - start the file watcher after reconciliation is complete
6. Bind the HTTP listener only after all configured vaults are ready.
7. Serve static assets and API requests.

If any configured vault fails to initialize, the server exits with a clear stderr
message. Serving a subset of configured vaults is deferred.

Because startup blocks until each vault is ready, the frontend does not need a
`vault_not_ready` API state in V1.

### Frontend Startup Happy Path

The frontend has one clear boot path.

1. `main.ts` finds `#app`.
2. It creates the API client, reading the active vault index from
   `sessionStorage` and defaulting to `0`.
3. It calls `GET /api/bootstrap` with `X-Tansu-Vault`.
4. It initializes app state from the bootstrap response.
5. It renders the root shell: sidebar, tab bar, editor area, overlay hosts, and
   empty notification/status regions.
6. If bootstrap session has an active tab, it fetches only that note body with
   `GET /api/notes/:id` and mounts it into `packages/md-wysiwyg`.
7. If there is no active tab, it renders the editor empty state without fetching
   note bodies.
8. It opens one SSE connection for the active vault.
9. It registers global keyboard commands and command palette entries.
10. It shows a quiet repair indicator if `repair_issues` is non-empty.

Bootstrap failure renders a fatal startup panel with a retry action. Individual
active-note open failure leaves the app shell mounted and shows an empty/error
editor state, because the bootstrap metadata may still be usable.

## Frontend Architecture

### No Framework Runtime

The V1 frontend uses imperative DOM and TypeScript.

The point is not to hand-write a framework. The point is to keep the UI small and
state ownership obvious.

Allowed frontend patterns:

- Plain modules with explicit dependencies.
- A small app state store with subscriptions.
- DOM builders for stable UI regions.
- Explicit `mount()` and `destroy()` functions.
- Event delegation for repeated rows when useful.
- Small reusable helpers for modals, listbox behavior, focus restoration, and
  command registration.

Avoid:

- JSX.
- Solid signals.
- Hidden module-level state when ownership is unclear.
- Component trees that require a reconciler.
- Multiple roots for ordinary app UI.

### App State

Suggested top-level state:

```ts
type AppState = {
  vaults: VaultEntry[];
  activeVault: number;
  notes: Map<NoteId, NoteMeta>;
  tabs: TabState[];
  activeTabId: string | null;
  closedTabs: ClosedTabEntry[];
  pinned: NoteId[];
  recent: NoteId[];
  settings: Settings;
  connection: ConnectionState;
  modals: ModalState;
};
```

Tabs track note ID and in-memory draft content:

```ts
type TabState = {
  id: string;
  noteId: NoteId;
  title: string;
  path: string;
  hash: string;
  seq: number;
  eventId: number;
  cleanContent: string | null;
  draftContent: string | null;
  tags: string[];
  dirty: boolean;
  cursor: number | null;
  autosaveTimer: number | null;
};
```

The active tab is the only tab mounted into the editor. Inactive dirty tabs keep
draft Markdown in memory and may still autosave using that stored draft.

### Tabs

V1 keeps multi-tab editing.

Rules:

- Tabs are restored from per-vault session state.
- Bootstrap returns tab metadata, not all tab bodies.
- Active tab content loads at startup.
- Inactive tab content loads when selected.
- Switching away captures current editor content and cursor into tab state.
- Dirty tabs can be switched away from.
- Autosave is debounced per tab.
- Closing a dirty tab asks for confirmation unless content has already autosaved.
- Closing a tab after any required dirty confirmation pushes a closed-tab entry
  onto a bounded reopen stack.
- Reopening a closed tab resolves by note ID, not by stale path.
- Reopening a closed tab that is already open focuses the existing tab.
- Reopening a deleted, unresolved, or missing note drops that stack entry and
  shows a quiet notification.
- The closed-tab stack is persisted with session state.

### Autosave

Autosave is enabled in V1.

Rules:

- Debounced per dirty tab.
- Skip or retry while an active editor selection is non-collapsed if needed to
  avoid disrupting selection behavior.
- Uses the normal save API.
- Every accepted autosave is durable.
- Autosave bursts are grouped in history UI.
- Manual save is marked as a visible checkpoint.

### SSE And Dirty Tabs

SSE updates must never overwrite unsaved editor content.

Rules:

- If a changed note is open and clean, update its metadata and reload content when
  it is active.
- If a changed note is open and dirty, mark the tab as having a remote update and
  let the next save produce a conflict draft if the user keeps editing.
- If a deleted note is open and clean, close the tab or show a deleted state.
- If a deleted note is open and dirty, keep the draft in memory and offer recovery
  actions rather than closing it immediately.
- If a renamed note is open, update tab path/title by note ID without reloading
  content unless the content hash changed.

### Editor Integration

The app creates one editor handle for the active note area.

The editor package owns:

- contenteditable DOM
- Markdown render/serialize
- source mode internals
- undo/redo
- selection restore
- formatting transforms

The app owns:

- active note loading
- save scheduling
- conflict UI
- tags/frontmatter integration
- image upload callback
- revision inspector
- tiny toolbar commands
- image resize handles

Enabled editor extensions:

- wiki image extension for `![[image.webp]]`
- callout extension

Disabled editor extensions:

- wiki link extension

### Toolbar

V1 has a tiny fixed toolbar, not a floating selection toolbar.

Controls:

- bold
- italic
- strikethrough
- highlight if already supported cleanly
- heading level selector or simple heading commands
- list/task controls if available through editor operations
- source mode toggle
- image import/paste affordance if useful
- overflow menu for revisions/settings/rename/delete if needed

Buttons should use icons where appropriate. Toolbar should be visually quiet.

### Image Resize Handles

Image resize handles remain V1.

Rules:

- Only active in editor content mode.
- Update Markdown image width through the editor serialization path.
- Do not mutate renderer-owned HTML in a way that fails round-trip.
- Keep tests for width persistence.

### Command Palette

V1 keeps command palette.

The palette should cover:

- open/search note
- create note
- save
- rename
- delete
- pin/unpin
- reopen closed tab
- import HTML
- open settings
- show revisions
- switch vault if multiple vaults exist
- source mode toggle

The palette is ordinary app UI, not editor internals.

### Sidebar

The sidebar is restrained and information-dense.

It shows:

- vault switcher if multiple vaults exist
- search/filter input
- pinned notes
- recent notes

It should not become a full file tree in V1 unless the core needs it.

### Search UI

Search should use the server search endpoint.

Search overlay:

- query input
- keyboard navigation
- results with title, path, tags, excerpt
- create note from query if no result and no collision

No score breakdown in V1.

### Settings UI

Settings UI should cover only essential V1 settings.

Keep it quiet:

- one modal
- grouped sections
- no excessive sliders
- no implementation-detail wording

### Revisions UI

V1 uses a simple revision inspector:

- list visible checkpoint groups and autosave groups
- preview diff against current editor content
- restore selected revision
- show conflict drafts when relevant
- recover conflict draft into current note

The UI does not need a rich timeline.

## Server Runtime

### App

`App` owns global server state:

- config
- static asset serving
- vault runtimes
- route dispatch
- shutdown behavior if implemented

It should not own note storage logic.

### VaultRuntime

Each `VaultRuntime` owns:

- name
- index
- root path
- catalog connection
- search index
- watcher
- self-write filter
- settings
- SSE clients

The runtime exposes narrow operations:

- bootstrap
- open note
- create note
- save note
- rename note
- delete note
- search
- list revisions
- restore revision
- upload image
- update settings
- update session
- pin/unpin
- reconcile

### Threading

V1 can keep a simple blocking server model if it remains reliable.

Acceptable:

- single-threaded request handling initially
- watcher thread per vault or shared watcher thread
- blocking startup reconciliation and indexing before the HTTP listener binds

Avoid introducing async runtime unless there is a concrete need.

### SSE

SSE is per vault.

Event types:

- `connected`
- `note_changed`
- `note_deleted`
- `note_renamed`
- `vault_reindexed`
- `settings_changed`

Payloads should use note IDs where possible.

The frontend should keep one EventSource for the active vault.

## Security And Path Safety

Even as a local app, path safety is mandatory.

Rules:

- Normalize every user path into the selected vault root.
- Reject path traversal.
- Reject empty paths.
- Reject paths under `.tansu`.
- Only allow Markdown note paths for note APIs.
- Only serve images from the selected vault image directory.
- Do not expose another vault's images through a stale path.

Encrypted vault auth is deferred, but route design should keep vault selection
explicit so auth can later be attached per vault.

## Error Model

The API error envelope above is the only error shape for `/api/*`.
The error envelope and all error-kind enums are first-class `ts-rs` exports, not
handwritten TypeScript types.

Additional notes:

- `locked_vault` and auth-related errors are reserved for the future encryption
  lifecycle, but are not needed in V1.
- HTML import conversion failure is client-side because import conversion happens
  in the browser before note creation.
- The client should avoid string matching. UI behavior switches on
  `error.code`.

## Testing Requirements

The integration harness is a core feature, not an afterthought.

### Harness Shape

The harness should:

- create a temp root
- create an isolated `XDG_CONFIG_HOME`
- create two vault directories
- seed real Markdown files
- seed real images
- start the debug server on a free port
- wait for bootstrap readiness
- run Playwright/Vitest tests
- clean up server, browsers, and temp directories

The user will later populate richer mock vault data. The harness should make that
easy by keeping fixtures under versioned test directories.

### Required Integration Coverage

- bootstrap returns active vault state and does not fetch all note bodies
- same relative path in two vaults maps to different note IDs
- vault switching does not leak tabs, pins, recent notes, settings, images, or SSE
- create assigns note ID and baseline/import history event
- save validates `expected_seq` and `expected_hash`
- stale save writes conflict draft and preserves canonical content
- autosave creates durable events and groups them in UI
- manual save creates checkpoint
- explicit rename preserves note ID and history
- rename path collision fails
- delete tombstones and can restore
- restore appends a new event
- external same-path edit becomes external edit event
- exact-hash external move preserves identity
- ambiguous external move+edit becomes delete plus new note
- image upload and serving are vault-scoped
- HTML import writes Markdown, not raw HTML
- settings are per vault
- pinned and recent are per vault
- closed-tab reopen stack is per vault and reopens by note ID
- API error payloads use generated error kinds and reason enums in the frontend

### Rust Unit Coverage

- path normalization
- note ID generation
- SQLite migrations
- catalog CRUD
- content hash consistency
- history snapshot write/read
- conflict draft write/read
- save conflict classification
- tombstone delete/restore
- startup repair
- external reconciliation
- search scanning and indexing
- frontmatter tag parsing
- image path safety

### Editor Package Coverage

`packages/md-wysiwyg` keeps its own tests. App tests should verify integration,
not re-test the editor package internals.

## Migration From Existing Vaults

V1 supports opening existing Markdown vaults by scanning them and assigning hidden
IDs in the catalog.

V1 does not need to import old `.tansu/revisions` from current Tansu unless a
later decision adds that work. On first scan, each existing Markdown file receives
a baseline snapshot in the new history store.

Current `z-images` assets can remain where they are.

Current settings may not map exactly because V1 intentionally narrows settings.

## Key Invariants

These invariants should be treated as testable design constraints.

1. A note ID never changes for app-driven rename.
2. A path collision never silently chooses a different note path on the server.
3. Saving content never renames a file.
4. Every accepted content-changing save has a recoverable snapshot.
5. A stale save never overwrites canonical note content.
6. A rejected stale save can be recovered from a conflict draft.
7. Delete keeps final content recoverable.
8. Vault-scoped APIs never read or write another vault.
9. Bootstrap fetches metadata, not every note body.
10. Inactive restored tabs do not fetch content until selected.
11. Markdown files do not contain hidden Tansu IDs.
12. Wiki links and backlinks are not app features in V1.
13. HTML import creates ordinary notes and never bypasses save/history semantics.
14. Images are vault-local opaque assets in V1.
15. Startup reconciliation never guesses identity for ambiguous move+edit cases.
16. API error codes and reason enums are generated from Rust through `ts-rs`.
17. Closed-tab restore uses note IDs and never reopens by stale path alone.
