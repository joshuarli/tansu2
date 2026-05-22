# Performance

Tansu2's performance model is intentionally simple: keep the Rust server
authoritative, keep browser state small, and avoid adding background systems
until measurements show they are needed.

## Current Approach

- Note identity is always `noteId`; paths are display and filesystem metadata.
- The Rust server owns vault scanning, search, history, conflict handling, and
  save acceptance.
- The frontend keeps open tab state in memory and never persists dirty drafts in
  browser storage.
- The editor captures changes on a short delay, uses snapshots for autosave, and
  avoids serializing the document on every keystroke.
- Autosave uses a per-tab follow-up flag when edits happen during an in-flight
  save, so a second save is issued without adding a general save queue.
- Search responses are sequenced on the client so stale responses cannot replace
  newer query results.
- The frontend ships as a single small app bundle. We avoid chunk splitting for
  now because the extra request and build complexity are not justified by the
  current app size.
- Static assets use conservative `Cache-Control: no-cache` headers so generated
  app files are revalidated.

## Clean Note Cache

The browser has a small IndexedDB cache for clean note bodies that have already
been accepted by the server. Entries are keyed by vault, `noteId`, and
`contentHash`.

The cache is only an acceleration path:

- Cached content is used only when its hash matches current server metadata.
- The app still sends `openNote` and treats the server response as authoritative.
- Late server responses do not overwrite dirty drafts.
- Successful opens, saves, revision restores, and conflict restores refresh the
  clean cache.
- Deletes remove cached bodies for the note in that vault.
- IndexedDB failures behave like cache misses.

This helps restored tabs and recently opened notes show content before a slow
`openNote` returns, while preserving the normal save and conflict model.

## Measurements

Use the integrated benchmark for broad app/server checks:

```sh
node bench/integrated-bench.mjs --browser=chromium --warmups=2 --runs=5
```

Use the note-cache benchmark for the cache-specific open paths:

```sh
node bench/note-cache-bench.mjs --runs=9 --delay=200
```

The note-cache benchmark records both normal local-server timings and timings
with a synthetic `openNote` delay. The synthetic delay is useful because local
note opens can be so fast that IndexedDB overhead is larger than the server
round trip.

Recent measurements on a local Chromium run showed:

- Fast local note misses were in the low single-digit milliseconds.
- Cache-hit opens were roughly one frame or less.
- With a synthetic 200 ms `openNote` delay, cache-hit opens stayed near their
  normal cost while cache misses waited on the delayed server response.

These numbers support keeping the cache read-through path, but they do not
justify idle cache warming yet.

## What We Are Not Doing

Tansu2 does not currently use a service worker, CRDT sync engine, client-side
search index, broad state-management dependency, or granular rendering
framework. Those would add durable complexity before the product has measured
need for them.

Idle cache warming is also intentionally skipped for now. The current evidence
shows the local server is usually fast enough that warming likely adds more
background work than user value.

## Open Questions

The current measurements are useful, but they are not the final word. Larger
vaults and larger notes are needed to understand the next limits:

- Thousands or tens of thousands of notes.
- Very large Markdown files with images, links, callouts, and frontmatter.
- Lower-end hardware and CPU throttling.
- Chromium, Firefox, and WebKit comparisons.
- Long editing sessions with repeated autosave, search, and vault watcher
  activity.

Future performance work should start from those measurements, not from a more
complicated architecture by default.
