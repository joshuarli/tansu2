# Tansu2 Agent Guide

Tansu2 is a local Markdown note app. The core constraint is content integrity:
note identity is durable, accepted writes are recoverable, and vaults do not
leak into each other.

## Read First

- [Architecture](docs/architecture.md): invariants, ownership, and change map.
- [API](docs/api.md): generated DTOs, endpoints, and high-risk request examples.
- [Development](docs/development.md): setup, commands, and validation.
- [Fixtures](docs/fixtures.md): shared dev/e2e test vaults.
- [Migration](docs/migration.md): safe first run on an existing Markdown vault.
- [V2](V2.md): deferred work.

## Change Map

- Server route or DTO: `src/api.rs`, `src/api_types.rs`, then `make types`.
- Vault mutation, save, history, assets, search, watcher: `src/vault.rs`.
- Catalog schema/current state/events: `src/catalog.rs`.
- Snapshot/hash/conflict blobs: `src/history.rs`.
- Startup or external file reconciliation: `src/reconcile.rs`.
- Frontend state and editor lifecycle: `web/ts/app.ts`.
- Frontend DOM and visual controls: `web/ts/view.ts`, `web/static/app.css`.
- Markdown editor internals: `packages/md-wysiwyg/`.
- Dev/e2e vault content: `tests/fixtures/test-vaults/`.

## Non-Negotiables

- Use `noteId`, not `path`, for identity.
- Do not let search, SSE, or watcher freshness roll back accepted note writes.
- Keep V1 frontmatter support tags-only.
- Keep Markdown/editor behavior inside `packages/md-wysiwyg`.
- Keep per-vault mutations serialized unless a tested design change says
  otherwise.
- Do not add broad dependencies without updating docs.
- Do not build release binaries, run pre-commit hooks, or push.

## Fast Checks

- `make check`
- `make test`
- `make test-e2e`

`make dev` runs against generated `.dev` test vaults, not the user's real config.
