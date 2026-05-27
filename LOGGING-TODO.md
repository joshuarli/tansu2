# Unified Logging TODO

This document describes where Tansu2's unified dev/test logging should go next.
For the current implementation and APIs, see [docs/logging.md](docs/logging.md).

The goal is not production telemetry in the SaaS sense. Tansu2 is a local app.
The goal is production-grade usefulness for debugging: when a real-server e2e
test fails, or when `make dev` hits a bad state, the logs should explain what
the user did, what the client requested, what the server accepted, what the
vault changed, and what error or stale state caused the failure.

## Current Baseline

The current system has the right foundation:

- One server-owned ordered stream across server, browser client, and e2e
  harness.
- Server-assigned `seq` and `ts`.
- Structured payloads with stable objects such as `http`, `note`, `command`,
  `editor`, `search`, `error`, and `system`.
- Client-to-server log ingestion.
- Request correlation via `X-Tansu-Request-Id`.
- E2E failure dumps from `/api/dev/logs`.
- Dev modes through `TANSU2_LOGS`.

The main weakness is that the stream is still mostly chronological. A useful
debugging system should expose causality: this command caused these API calls,
which caused these server operations, which caused these client state changes.

## Priority 1: Trace IDs Rooted In User Intent

Impact: very high. Effort: medium.

Today, `requestId` correlates one browser API call to one server HTTP request.
That is useful but too narrow. The most important missing field is a `traceId`
created at the start of a user intent.

Examples of trace roots:

- command palette action,
- sidebar note click,
- editor save,
- autosave timer,
- search input,
- settings submit,
- import flow,
- revision restore,
- conflict recovery.

Every log caused by that intent should carry the same `traceId`: client command,
client API calls, server request logs, server vault operations, resulting SSE,
client state application, and eventual notice/error.

Target envelope:

```ts
type LogEvent = {
  seq: number;
  ts: number;
  source: "server" | "client" | "harness";
  level: "debug" | "info" | "warn" | "error";
  kind: string;
  traceId?: string;
  spanId?: string;
  parentSpanId?: string;
  requestId?: string;
} & Record<string, unknown>;
```

The first implementation does not need a full tracing framework. A small client
trace context is enough:

- `startTrace("command.create")`,
- `withTrace(trace, () => api.createNote(...))`,
- send `X-Tansu-Trace-Id` and `X-Tansu-Parent-Span-Id` on API calls,
- server request logs copy trace headers,
- vault/domain logs emitted during that request inherit the request context.

This is the highest-impact improvement because it turns the unified stream from
a timeline into a cause-and-effect story.

## Priority 2: Operation Spans And Durations

Impact: high. Effort: medium.

Wide events are good, but some work benefits from explicit spans:

- app boot,
- note open,
- save/delta construction,
- server request handling,
- vault mutation lock wait and hold time,
- search query,
- watcher reconciliation,
- import,
- e2e test case.

A span should produce one completion event, not noisy start/stop lines, unless a
failure happens before completion. The completion payload should include:

```json
{
  "span": {
    "name": "vault.save_delta",
    "durationMs": 18,
    "ok": true
  }
}
```

Useful span conventions:

- log `ok: false` with normalized error fields when the operation fails,
- include `waitMs` and `holdMs` for serialized vault mutations,
- include `stale: true` when an operation is intentionally ignored due to a
  newer request or vault switch,
- include `attempt` for retries or conflict recovery.

This would make performance and race-condition failures much easier to read.

## Priority 3: Failure Snapshots

Impact: high. Effort: low to medium.

On e2e failure, logs should include a small diagnostic snapshot of the client
and harness state at failure time. This is not the full app state; it is the
minimum context needed to understand what the test saw.

Client snapshot fields:

- current URL,
- active vault,
- active note id/path/title,
- open tab ids and dirty/saving/conflict flags,
- mounted editor note id,
- source mode/read mode,
- current notice,
- open overlay/dialog,
- focused element selector and text role when practical,
- pending client API requests by `requestId`.

Harness snapshot fields:

- test name,
- browser engine,
- page URL,
- last failed request,
- page errors,
- screenshot path if a screenshot was captured.

These should be emitted as `client.snapshot` and `harness.snapshot` events at
failure time. They should stay body-free: no note contents, no DOM dump.

## Priority 4: Event Schema Registry

Impact: high. Effort: medium.

Structured logs are only useful if field names stay stable. The current system
has useful conventions but no registry. A production-grade dev logger should
define event constructors and document required fields for each `kind`.

Examples:

```ts
logCommand({ id: "rename", noteId, vault });
logEditor({ action: "toggle_source", noteId, sourceMode });
logApi({ method, path, status, durationMs, requestId });
```

```rust
logs.note_mutation(action, &meta, content_bytes);
logs.search_query(vault, query_len, hit_count);
logs.http_request(summary);
```

Benefits:

- fewer ad hoc payload shapes,
- easier filtering,
- safer refactors,
- useful docs generated from code or kept beside constructors,
- cleaner pretty summaries because each event kind has a known shape.

This is the best way to avoid the current risk of "structured but still
stringly typed" logs.

## Priority 5: Query And Filtering

Impact: medium to high. Effort: medium.

Current snapshots return the whole retained buffer. That is acceptable for
failure dumps but clumsy for humans. Add query parameters:

- `source=client|server|harness`,
- `level=warn,error`,
- `kind=client.command,http.request`,
- `traceId=...`,
- `requestId=...`,
- `noteId=...`,
- `vault=0`,
- `sinceSeq=...`,
- `limit=...`,
- `format=json|ndjson|pretty`.

Most value comes from `traceId`, `requestId`, `level`, and `kind`.

For machine tools, NDJSON is more practical than a JSON array:

```sh
curl 'http://127.0.0.1:3000/api/dev/logs?format=ndjson&level=warn,error'
```

This also gives e2e failure output a path to print only relevant traces while
still keeping full-buffer fallback available.

## Priority 6: Local Log Viewer

Impact: medium. Effort: medium to high.

A browser-based local viewer would make the unified stream much more usable
during `make dev`.

Useful viewer features:

- live stream from `/api/dev/logs/stream`,
- source/level/kind filters,
- trace tree view,
- request/domain/client grouping by `traceId`,
- note/vault filters,
- expand/collapse payloads,
- copy event JSON,
- pause/resume,
- "show errors only",
- "show current trace".

The viewer should be private dev UI, probably under `/dev/logs`, and not part of
the main app surface. This is less urgent than trace IDs because a viewer over a
weak event model is just a prettier timeline.

## Priority 7: Noise Controls

Impact: medium. Effort: low to medium.

Going all in on logs creates noise. We need explicit controls:

- per-kind enable/disable,
- minimum level,
- source filters,
- suppress high-frequency events by default,
- sample or coalesce repetitive session saves,
- demote expected stale responses to debug,
- keep `warn` and `error` rare and meaningful.

Suggested environment format:

```sh
TANSU2_LOGS=pretty
TANSU2_LOG_FILTER='level>=info,kind!=session.save'
```

This can start simpler:

- `TANSU2_LOG_LEVEL=debug|info|warn|error`,
- `TANSU2_LOG_SKIP=session.save,client.editor`.

Noise control matters because useful logs are the ones people leave enabled.

## Priority 8: Error Normalization

Impact: medium. Effort: low.

Errors should look the same everywhere. Normalize to:

```ts
type LogError = {
  name?: string;
  message: string;
  stack?: string;
  code?: string;
  cause?: LogError;
  api?: unknown;
};
```

Server errors should include stable API `code` where available. Client errors
should include stack and URL. Harness errors should include Playwright failure
text and request URL.

This improves failure dumps immediately and makes filtering by `error.code`
possible.

## Priority 9: E2E Trace Attachments

Impact: medium. Effort: medium.

On failure, the harness should print the relevant trace first, then the broader
buffer. It should also attach or print:

- full log snapshot path,
- filtered trace snapshot path,
- screenshot path,
- browser console errors if any are still outside unified logging,
- active page URL,
- seed and browser engine.

This keeps terminal output readable while preserving the full details for deeper
inspection.

## Priority 10: Retention And Privacy Polish

Impact: medium. Effort: low.

Retention currently bounds event count and approximate bytes. More polish:

- expose dropped event count,
- log a `system.event` when retention drops old events,
- show current buffer size in snapshot metadata,
- mark truncated payloads clearly,
- add redaction helpers for future sensitive fields.

Even though Tansu2 is local, logs should stay conservative. Do not log note
bodies or imported HTML content by default.

## Suggested Implementation Order

1. Add `traceId` propagation from client command roots through API headers and
   server request/domain logs.
2. Add span completion helpers for app boot, note open, save, server requests,
   vault mutations, search, watcher reconcile, and e2e tests.
3. Add e2e failure snapshots for client/harness state.
4. Create typed event constructors in Rust and TypeScript; migrate existing log
   call sites to them.
5. Add `/api/dev/logs` filters and `format=ndjson`.
6. Add noise controls with minimum level and skip-list support.
7. Add normalized error shape and cause chains.
8. Build a `/dev/logs` viewer once traces and filters exist.
9. Add retention metadata and dropped-event reporting.

## Practical Definition Of Done

The logging system is useful enough when a failed test or dev bug lets someone
answer these questions without reproducing the bug:

- What user action or timer started the work?
- What trace did it create?
- Which client API requests did it make?
- Which server requests handled them?
- Which vault operation accepted or rejected the change?
- Did watcher/search/SSE change state afterward?
- Did the client ignore stale data or apply it?
- What exact error code/message/stack occurred?
- What note, vault, tab, and overlay were active at failure time?

If the logs answer those questions, the system is doing real debugging work. If
they only say that a request happened, they are still just instrumentation.
