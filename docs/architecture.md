# Architecture

Tansu2 is a Rust server, static TypeScript frontend, and in-repo Markdown editor.
Markdown files remain normal files; `.tansu/` holds catalog, history, conflicts,
search, settings, session, pins, recents, and repair state.

## What Must Not Break

- `noteId` is durable identity. `path` is mutable metadata.
- `path_key` is the normalized live-path uniqueness key.
- Every accepted content-changing write has a full recoverable snapshot.
- Stale saves preserve canonical content and create conflict drafts.
- Search is derived state; indexing failure cannot fail an accepted write.
- Watcher events trigger reconciliation, not direct semantic edits.
- Bootstrap returns note metadata, not all note bodies.
- Inactive restored tabs do not fetch content until selected.
- Markdown files never get hidden Tansu IDs.
- `z-images/` assets are vault-local opaque files in V1.

## Ownership

| Area                    | Files                                                     |
| ----------------------- | --------------------------------------------------------- |
| Startup/config/runtime  | `src/main.rs`, `src/app.rs`, `src/config.rs`              |
| HTTP and route dispatch | `src/http.rs`, `src/api.rs`                               |
| Generated API contract  | `src/api_types.rs`, `web/ts/types.generated.ts`           |
| Paths and vault safety  | `src/paths.rs`, `src/config.rs`                           |
| SQLite catalog          | `src/catalog.rs`                                          |
| Snapshots and hashes    | `src/history.rs`                                          |
| Reconciliation          | `src/reconcile.rs`                                        |
| Search                  | `src/search.rs`                                           |
| Tags-only frontmatter   | `src/tags.rs`                                             |
| Vault orchestration     | `src/vault.rs`                                            |
| Frontend state/API      | `web/ts/app.ts`, `web/ts/api.ts`, `web/ts/state.ts`       |
| Frontend DOM/visuals    | `web/ts/view.ts`, `web/ts/dom.ts`, `web/static/app.css`   |
| Editor engine           | `web/ts/editor/`                                          |
| Dev/e2e fixture vaults  | `scripts/test-fixture.mjs`, `tests/fixtures/test-vaults/` |

## Write Path

Accepted writes canonicalize Markdown, compute `sha256:<hex>`, write compressed
history, update catalog state/events, then update the visible Markdown file.
Delta saves are only a transport optimization: the server reconstructs the full
candidate content from an exact base snapshot, verifies the submitted final hash,
and then follows the same full-snapshot write path. Startup repair uses
committed catalog/history state to finish interrupted writes conservatively.

The same identity rule applies to create, save, import, restore, delete, rename,
and conflict recovery: history follows `noteId`, not path.

## Reconciliation

Reconciliation is intentionally conservative:

- same path, changed hash: external edit
- exact hash move, unambiguous: preserve identity
- missing visible file with valid snapshot: tombstone
- moved and edited: delete plus new note
- invalid UTF-8, case collisions, corrupt/missing snapshots, catalog/file
  mismatch: unresolved state

Never use title, mtime, filename similarity, or fuzzy content matching to keep
identity.

## Frontend State

- `notes` is `Map<noteId, NoteMeta>`.
- Tabs store `noteId`; only the active tab mounts an editor.
- Inactive tabs may hold in-memory drafts.
- Dirty draft content is not persisted in session.
- Session stores open tabs, active note, closed tabs, cursor offsets, and source
  mode.
- The mounted editor records its owning note id so tab-switch renders cannot sync
  old editor content into the new active tab.

## Editor Boundary

`web/ts/editor` owns Markdown rendering, DOM serialization, selection, source
mode, undo/redo, formatting, paste handling, and editor extensions. It is an
internal Tansu editor engine, not a reusable package boundary. The app
mounts/configures it and handles persistence. Keep editor internals inside
`web/ts/editor` rather than spreading them through the app shell. See
[Editor](editor.md) for editor-specific invariants and extension behavior.
