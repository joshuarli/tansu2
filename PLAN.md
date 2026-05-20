# Tansu2 Implementation Plan

## Execution Rules

This plan is ordered. Later stages may reveal small adjustments, but implementation
should not skip ahead past core integrity work.

General rules:

- Build the integration harness early.
- Keep commits and changes scoped by stage.
- Do not run release builds.
- Do not add broad dependencies without revisiting `DESIGN.md`.
- Keep `ts-rs` generated types as the only frontend source of API DTO truth.
- Preserve the editor package boundary.
- Favor tests that prove data integrity over UI polish tests.

## Stage 0: Repository Skeleton And Tooling

Goal: create the minimal project shape without implementing product behavior.

Deliverables:

- Rust crate with `src/main.rs` and `src/lib.rs`.
- TypeScript frontend entrypoint under `web/ts/main.ts`.
- Static HTML and CSS bundle path under `web/`.
- `package.json`, workspace config, TypeScript config, Vitest config, and build script.
- Basic `Makefile` or equivalent commands for type generation, checks, tests, and dev run.
- Empty or minimal `packages/md-wysiwyg` integration path.

Tests:

- `cargo check`
- frontend type check
- frontend bundle in development mode

Exit criteria:

- A browser can load a blank app shell from the Rust server.
- Static assets are served without product APIs.

## Stage 1: Integration Harness First

Goal: establish the server plus browser test environment before the architecture
becomes complex.

Deliverables:

- Temp-directory test harness.
- Isolated `XDG_CONFIG_HOME`.
- Two mock vaults in every test run.
- Fixture helper for Markdown files and real image files.
- Free-port server startup.
- Server readiness wait.
- Browser setup and teardown.
- Shared helpers for vault headers and bootstrap calls.

Tests:

- Server starts with two empty seeded vaults.
- `GET /api/bootstrap` placeholder or health endpoint responds.
- Static app loads in Playwright.
- Vault headers are passed by helper functions.

Exit criteria:

- One e2e test can start the real debug server, load the app, and shut down cleanly.

## Stage 2: Config, HTTP, Paths, And App Runtime

Goal: build safe infrastructure before storage.

Deliverables:

- Config loader for `~/.config/tansu/config.toml` and `XDG_CONFIG_HOME`.
- Vault nesting validation.
- HTTP request parsing and response helpers.
- JSON response helpers.
- Path normalization helpers.
- Static asset serving.
- `App` struct with vault runtime placeholders.

Tests:

- config parsing
- tilde expansion
- missing config errors
- nested vault rejection
- path traversal rejection
- static file serving

Exit criteria:

- Server can load two vault configs and route requests to the selected vault index.

## Stage 3: SQLite Catalog And Migrations

Goal: create the durable metadata foundation.

Deliverables:

- `rusqlite` dependency.
- `.tansu/vault.db` creation per vault.
- Migration system.
- Initial schema for notes, note events, conflict drafts, pins, recent, session,
  settings, and schema migrations.
- Catalog API with explicit transactions.
- `NoteId` generation.

Tests:

- fresh DB creation
- idempotent migrations
- migration version recording
- note insert/update/read
- unique path enforcement
- tombstone field behavior
- settings/session basic read/write

Exit criteria:

- Catalog operations work without scanning real Markdown yet.

## Stage 4: History Blob Store

Goal: implement compressed full snapshots and conflict drafts.

Deliverables:

- `lz4_flex` dependency.
- Snapshot write/read helpers.
- Conflict draft write/read helpers.
- Hash computation helper for exact Markdown bytes.
- Temporary-file and rename helper for blob writes.
- History metadata helpers in catalog.

Tests:

- snapshot round trip
- conflict draft round trip
- hash matches exact bytes
- missing blob error behavior
- corrupt blob error behavior
- temp write cleanup behavior where feasible

Exit criteria:

- A note snapshot can be written, cataloged, read, and hash-verified.

## Stage 5: Vault Scan And Reconciliation

Goal: populate and repair a vault from real files.

Deliverables:

- Markdown file walker that excludes `.tansu` and excluded folders.
- Frontmatter tag parser.
- title extraction from first H1 or filename stem.
- Baseline event creation for new files.
- Same-path external edit detection.
- Exact-hash external rename detection.
- External delete tombstone handling.
- Ambiguous move+edit policy as delete plus new note.
- Startup repair for catalog/file/hash mismatches.

Tests:

- first scan assigns IDs and baseline snapshots
- same relative path in two vaults produces distinct IDs
- same-path edit appends external edit
- exact-hash move preserves ID
- moved-and-edited file does not guess identity
- deleted file tombstones note
- `.tansu` files ignored
- excluded folders ignored

Exit criteria:

- Starting the server over real fixture vaults produces stable catalog metadata.

## Stage 6: API Types And Generation

Goal: lock the server/UI contract before building UI behavior.

Deliverables:

- `src/api_types.rs` with `ts-rs` types.
- Type generation binary.
- Generated TypeScript output.
- Type drift check command.
- API error shape for typed frontend handling.

Core DTOs:

- vault entry
- note ID
- note metadata
- note document
- bootstrap response
- create note request/response
- save note request/response
- rename/delete responses
- revision metadata
- conflict draft metadata
- settings
- session state
- search hit

Tests:

- generation succeeds
- check mode fails on drift
- representative optional fields serialize as expected

Exit criteria:

- TypeScript can import generated API types without handwritten duplicates.

## Stage 7: Bootstrap, Note Open, Create, Save, Rename, Delete

Goal: implement the minimum useful typed API on top of catalog and history.

Deliverables:

- `GET /api/bootstrap`.
- `GET /api/notes/:id`.
- `POST /api/notes`.
- `PUT /api/notes/:id`.
- `POST /api/notes/:id/rename`.
- `DELETE /api/notes/:id`.
- Session update endpoint if needed by bootstrap tests.
- Path collision errors.
- Save conflict response with conflict draft.
- Tombstone delete.

Tests:

- bootstrap returns metadata only
- open note returns content
- create writes file, note row, and baseline/import event
- create collision fails
- save with correct seq/hash succeeds
- unchanged save does not create redundant event
- stale save creates conflict draft
- rename preserves note ID
- rename collision fails
- delete removes file and tombstones note

Exit criteria:

- The API can support a primitive app with create/open/save/rename/delete.

## Stage 8: Search, Recent, Pinned, Settings

Goal: restore core navigation data with per-vault isolation.

Deliverables:

- Tantivy search index per vault.
- Search endpoint.
- Settings endpoint.
- Pin/unpin endpoints.
- Recent update on note open and save where appropriate.
- Reindex on excluded folder changes.

Tests:

- search finds title, tags, headings, and content
- search excludes tombstones
- settings are per vault
- excluded folder update reindexes
- pinned notes are note ID based
- recent notes are note ID based
- pinned/recent do not leak across vaults

Exit criteria:

- Bootstrap plus search can drive sidebar, palette, and search overlay metadata.

## Stage 9: SSE And Watcher Integration

Goal: keep browser views fresh and reconcile external changes.

Deliverables:

- Per-vault watcher.
- Server self-write filter.
- `/events?vault=` endpoint.
- SSE event payloads using note IDs.
- Incremental reconcile on watcher events.
- Full reconcile fallback for ambiguous watcher sequences.

Tests:

- SSE connects per vault
- save emits note changed event only to active vault clients
- external edit emits change event
- external delete emits delete event
- exact external rename emits rename event
- server self-write does not duplicate external edit event
- two browser tabs on different vaults receive isolated events

Exit criteria:

- External filesystem edits are reflected without cross-vault leakage.

## Stage 10: Frontend Shell Without Solid

Goal: establish the imperative UI foundation.

Deliverables:

- `main.ts` boot entrypoint.
- API wrapper using generated types.
- App state store with subscriptions.
- DOM helpers for mounting and cleanup.
- Root layout: sidebar, tabs, editor area, overlays host.
- Bootstrap loading flow.
- Vault selection via `sessionStorage`.
- SSE lifecycle.

Tests:

- bootstrap called once on load
- generated types compile in API wrapper
- app renders vault/sidebar/tabs placeholders
- switching vault updates session storage and fetches new bootstrap
- no Solid dependency in production bundle

Exit criteria:

- App loads metadata from real server and renders a minimal shell.

## Stage 11: Editor Integration, Tabs, Autosave

Goal: make real note editing work against the new API.

Deliverables:

- `md-wysiwyg` package integration.
- Active editor mount and destroy behavior.
- Tab state by note ID.
- Lazy content load for inactive tabs.
- Cursor capture and restore.
- Tag row and frontmatter sync.
- Debounced per-tab autosave.
- Manual save command.
- Save conflict UI entry point.
- Tiny toolbar.
- Source mode.

Tests:

- opening a note loads content into editor
- switching tabs captures draft and cursor
- inactive tab content is lazy-loaded
- dirty tab can be switched away from
- autosave sends expected seq/hash
- manual save creates checkpoint
- stale save surfaces conflict draft
- tag changes update frontmatter and save
- toolbar formatting persists through save

Exit criteria:

- The app can edit multiple tabs reliably with durable saves.

## Stage 12: Sidebar, Search Overlay, Command Palette

Goal: make navigation ergonomic without adding architectural complexity.

Deliverables:

- Sidebar with vault switcher, search/filter, pinned, and recent.
- Search overlay for full-text search.
- Command palette.
- Commands for open, create, save, rename, delete, pin/unpin, import HTML,
  revisions, settings, and source mode.
- Keyboard navigation and focus restore.

Tests:

- pinned list opens notes by ID
- recent list updates after open/save
- search opens result by ID
- command palette can create and open notes
- rename command handles collision
- delete command tombstones note
- keyboard shortcuts do not interfere with editor text input

Exit criteria:

- Core workflows are available without relying on hidden test-only paths.

## Stage 13: Revisions And Conflict Recovery UI

Goal: expose the durable history model simply.

Deliverables:

- Revision list endpoint consumption.
- Group autosave bursts in UI.
- Diff preview against current editor content.
- Restore revision.
- Conflict draft fetch and recovery.
- Simple conflict banner/modal.

Tests:

- autosave events are grouped in revision UI
- manual save appears as checkpoint
- restore appends new event
- current content before restore remains recoverable
- conflict draft can be viewed and restored
- conflict recovery creates checkpoint event

Exit criteria:

- A user can recover from accidental edits, deletes, restores, and stale-save conflicts.

## Stage 14: Images And Image Resize

Goal: keep image workflows from the current app without making assets part of note
history.

Deliverables:

- Image upload endpoint.
- Vault-scoped image serving.
- Editor image paste callback.
- WebP quality setting.
- Wiki-image extension enabled.
- Image resize handles.

Tests:

- pasted image uploads to active vault
- image is served from active vault
- same filename in another vault does not leak
- image resize persists Markdown width
- old note revision can still restore content containing image Markdown

Exit criteria:

- Image paste, display, and resize work in normal editing.

## Stage 15: HTML Import

Goal: keep HTML import as an intentional V1 feature.

Deliverables:

- `defuddle` dependency.
- Import command in palette.
- Hidden file input.
- HTML to Markdown conversion.
- Frontmatter from article metadata.
- Markdown-only safety check.
- Explicit collision retry in client.
- Imported note opens after creation.
- Import history event or baseline event source marked as import.

Tests:

- fixture HTML imports as Markdown
- raw HTML is not saved
- missing Markdown conversion shows error and creates no note
- frontmatter contains title/author/date/description when provided
- collision retry chooses explicit candidate and server still rejects direct collision
- imported note is vault-scoped

Exit criteria:

- Cmd or palette import creates a normal recoverable note from HTML.

## Stage 16: Settings And Minimalist Visual Polish

Goal: make the app feel focused without expanding scope.

Deliverables:

- Essential settings modal.
- Quiet light theme tokens.
- Responsive layout for sidebar, tabs, editor, overlays.
- Notification/status surface.
- Empty states.
- Focus outlines and keyboard accessibility.

Tests:

- settings persist per vault
- changing autosave delay affects scheduler
- changing undo stack max updates editor config
- changing excluded folders reindexes
- mobile/narrow viewport does not overlap text
- Playwright screenshot sanity checks for main states

Exit criteria:

- UI is usable and visually coherent without adding non-core features.

## Stage 17: Integrity Hardening

Goal: stress the model before declaring V1 architecture stable.

Deliverables:

- Startup repair tests with interrupted write fixtures.
- Corrupt history blob behavior.
- Missing visible Markdown behavior.
- Missing history blob behavior.
- Reconcile after server was stopped during external changes.
- Larger note save/search test.
- Request-count assertions for startup.

Tests:

- DB committed but Markdown file old repairs from latest snapshot or records safe state
- snapshot exists but event incomplete is handled conservatively
- corrupt blob never overwrites visible note
- stale save never destroys canonical content
- delete restore works after restart
- exact-hash move after restart preserves note ID

Exit criteria:

- The data model has explicit behavior for likely crash and external edit cases.

## Stage 18: Documentation And Cutover Readiness

Goal: make the project maintainable after the first build.

Deliverables:

- Update `DESIGN.md` with implementation deviations.
- Add API documentation generated or written from DTOs.
- Add developer setup instructions.
- Add test fixture instructions for populating mock vaults.
- Add migration notes for opening an existing Markdown vault.
- Add known V2 list.

Tests:

- setup instructions run on a clean checkout
- all checks pass in normal development mode

Exit criteria:

- Another engineer can follow the docs and run, test, and extend the app without
  rediscovering the architecture.

## V2 Backlog

Do not implement these until V1 integrity and UI basics are stable:

- encrypted vault unlock and lock lifecycle
- encrypted search indexes or in-memory encrypted search policy
- offline cache and write queue
- history pruning and compaction
- imported legacy Tansu revisions
- richer file tree
- richer revision timeline
- score breakdown UI
- advanced settings
- wiki links and backlinks if ever needed again
- asset cataloging, integrity checks, garbage collection, or asset versioning

