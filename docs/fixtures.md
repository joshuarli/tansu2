# Fixtures

Dev and e2e use the same disk-backed fixtures.

```text
tests/fixtures/test-vaults/
  vault-one/
    one.md
    search.md
    visual.md
    z-images/sample.webp
  vault-two/
    two.md
    z-images/sample.webp
```

Generator: `scripts/test-fixture.mjs`.

## Regenerate `.dev`

```sh
make dev-config
```

This writes:

```text
.dev/config/tansu/config.toml
.dev/vault-one/
.dev/vault-two/
```

The generator deletes the known generated runtime paths first, including stale
`.tansu` catalogs and the old `.dev/vault` path. This keeps manual dev and e2e on
the same fixture state.

## Manual Fixture Root

```sh
node scripts/test-fixture.mjs /tmp/tansu2-fixture
```

Use the printed `configHome` as `XDG_CONFIG_HOME`.

## E2E Harness

`web/ts/e2e/server.test.ts` creates a temp root, runs the fixture generator,
starts the debug server on a free port, launches Playwright, and uses isolated
`XDG_CONFIG_HOME`.

Current coverage includes startup, note body isolation, images, modal/search/note
management UX, SSE, external reconciliation, revisions, and uploaded assets.

Add fixture Markdown/images under `tests/fixtures/test-vaults/`; do not inline
vault content in JS/TS.
