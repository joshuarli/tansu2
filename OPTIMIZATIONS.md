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
