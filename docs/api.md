# API

Rust DTOs in `src/api_types.rs` are the source of truth. Generate TypeScript with
`make types`; never edit `web/ts/types.generated.ts` by hand.

Vault selection is explicit:

- Fetch requests: `X-Tansu-Vault: <index>`
- Assets: `/api/assets?name=z-images/...&vault=<index>`
- SSE: `/events?vault=<index>`

The frontend stores the active vault index in `sessionStorage` as
`tansu2.activeVault`.

## Endpoints

| Method   | Path                                            | Purpose                                     |
| -------- | ----------------------------------------------- | ------------------------------------------- |
| `GET`    | `/api/health`                                   | health                                      |
| `GET`    | `/api/bootstrap`                                | initial vault metadata                      |
| `GET`    | `/api/notes/:noteId`                            | open one note                               |
| `POST`   | `/api/notes`                                    | create note                                 |
| `PUT`    | `/api/notes/:noteId`                            | save full content with `baseSeq`/`baseHash` |
| `PATCH`  | `/api/notes/:noteId`                            | save exact deltas with `baseSeq`/`baseHash` |
| `DELETE` | `/api/notes/:noteId`                            | tombstone note                              |
| `POST`   | `/api/notes/:noteId/rename`                     | rename path                                 |
| `GET`    | `/api/notes/:noteId/revisions`                  | list revisions                              |
| `GET`    | `/api/notes/:noteId/revisions/:eventId`         | read revision                               |
| `POST`   | `/api/notes/:noteId/revisions/:eventId/restore` | restore revision                            |
| `GET`    | `/api/notes/:noteId/conflicts/:draftId`         | read conflict draft                         |
| `POST`   | `/api/notes/:noteId/conflicts/:draftId/restore` | restore conflict draft                      |
| `POST`   | `/api/notes/:noteId/pin`                        | pin                                         |
| `DELETE` | `/api/notes/:noteId/pin`                        | unpin                                       |
| `GET`    | `/api/search?q=...`                             | search                                      |
| `GET`    | `/api/settings`                                 | read settings                               |
| `PUT`    | `/api/settings`                                 | write settings                              |
| `PUT`    | `/api/session`                                  | write session                               |
| `POST`   | `/api/images`                                   | upload active-vault WebP                    |
| `GET`    | `/api/assets?name=...&vault=...`                | read active-vault image                     |
| `GET`    | `/events?vault=...`                             | SSE                                         |

## High-Risk Flows

Create:

```json
POST /api/notes
{ "path": "meeting-notes.md", "content": "# Meeting Notes\n", "source": null }
```

Full save:

```json
PUT /api/notes/<noteId>
{
  "content": "# Title\n\nbody\n",
  "baseSeq": 3,
  "baseHash": "sha256:...",
  "checkpoint": false
}
```

Delta save:

```json
PATCH /api/notes/<noteId>
{
  "baseSeq": 3,
  "baseHash": "sha256:...",
  "contentHash": "sha256:...",
  "edits": [
    {
      "start": { "line": 2, "character": 0 },
      "end": { "line": 2, "character": 4 },
      "text": "changed"
    }
  ],
  "checkpoint": false
}
```

Delta edit positions are zero-based line and UTF-16 character offsets in the
LF-normalized base snapshot. Edits must be sorted, non-overlapping, and exact;
the server rejects malformed edits and final hash mismatches before mutating the
vault. Accepted delta saves still write full recoverable snapshots.

Stale save response:

```json
{
  "error": {
    "code": "save_conflict",
    "current": { "meta": {}, "content": "canonical content" },
    "draft": {
      "draftId": 12,
      "noteId": "note-id",
      "baseSeq": 3,
      "baseHash": "sha256:...",
      "contentHash": "sha256:...",
      "createdAtMs": 1710000000000
    }
  }
}
```

Rename:

```json
POST /api/notes/<noteId>/rename
{ "path": "renamed-note.md" }
```

Image upload:

```http
POST /api/images
Content-Type: image/webp
X-Tansu-Vault: 0

<webp bytes>
```

The response includes `name` under `z-images/` and wiki-image `markdown`.

## Errors

All API errors use:

```json
{ "error": { "code": "..." } }
```

Current codes:

- `path_invalid`
- `path_collision`
- `note_not_found`
- `save_conflict`
- `unresolved_note`
- `bad_request`
- `internal`

Frontend code catches `ApiError` from `web/ts/api.ts` and switches on
`response.error.code`.

## Search And SSE

Search returns current `NoteMeta`, a highlighted snippet, total score, and field
scores for title, headings, tags, and content. Dirty/degraded search state is in
bootstrap and SSE.

SSE events carry kind, vault index, current note metadata, deleted note ids, and
search status. Ignore events for non-active vaults.
