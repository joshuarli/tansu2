# Fixtures

Dev and e2e use the same disk-backed fixtures.

```text
tests/fixtures/test-vaults/
  vault-one/
    one.md
    search.md
    visual.md
    imported clipping notes
    z-images/sample.webp
  vault-two/
    two.md
    z-images/sample.webp
```

Generator: `scripts/test-fixture.mjs`.

## Regenerate Dev State

```sh
make dev-config
```

This writes:

```text
.dev/config/tansu/config.toml
.dev/data/
```

The generated config points at `tests/fixtures/test-vaults/vault-one` and
`vault-two` directly. Runtime state goes under `.dev/data`; fixture Markdown and
assets remain the vault contents. The generator deletes stale generated paths
first, including legacy copied-vault directories from older dev setups.

## Manual Fixture Root

```sh
node scripts/test-fixture.mjs /tmp/tansu2-fixture
```

Use the printed `configHome` as `XDG_CONFIG_HOME`.
Use the printed `dataHome` as `XDG_DATA_HOME`.

By default this writes config/data only and points at the versioned fixture
vaults. Add `--copy-vaults` when a harness needs disposable vault contents:

```sh
node scripts/test-fixture.mjs /tmp/tansu2-fixture --copy-vaults
```

## E2E Harness

`web/ts/e2e/server.test.ts` creates a temp root, runs the fixture generator with
copied vault contents, starts the debug server on a free port, launches
Playwright, and uses isolated `XDG_CONFIG_HOME` and `XDG_DATA_HOME`.

Current coverage includes startup, note body isolation, images, modal/search/note
management UX, SSE, external reconciliation, revisions, and uploaded assets.

Add fixture Markdown/images under `tests/fixtures/test-vaults/`; do not inline
vault content in JS/TS.
