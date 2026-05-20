# Development

## Setup

Requirements:

- Rust from `rust-toolchain.toml`
- Node from `.node-version`
- `pnpm` from `package.json`

Install dependencies:

```sh
pnpm install
```

## Run

```sh
make dev
```

`make dev` regenerates `.dev/` from versioned fixtures, bundles the frontend, and
runs the server on port `3000` with `XDG_CONFIG_HOME=.dev/config`. It does not
read the user's real config.

## Validate

Use these first:

```sh
make check
make test
make coverage
make test-e2e
```

Full focused list:

```sh
pnpm exec tsgo --noEmit --pretty false
pnpm exec tsgo -p packages/md-wysiwyg/tsconfig.json --noEmit --pretty false
pnpm exec oxfmt --check --config oxfmt.config.mjs
pnpm exec oxlint
cargo fmt --check
cargo check -q
cargo test -q
pnpm run test
cd packages/md-wysiwyg && pnpm exec vitest run
pnpm run test-e2e
```

Coverage gates are enforced by `make coverage`: Rust uses `cargo llvm-cov`,
the app TypeScript suite uses Vitest/V8, and the editor package uses
Vitest/V8. App and editor TypeScript are gated at 90% lines and 85% functions.
Rust is currently gated at 87% lines and 80% functions after excluding only
binary entrypoint glue; the remaining gap is concentrated in long-running
server/app wiring and vault internals that need broader behavior tests before
raising the gate to 90%/85%.

Do not run release builds unless explicitly requested.

## Generated Types

```sh
make types
make types-check
```

`src/api_types.rs` generates `web/ts/types.generated.ts`. Do not edit the
generated file.

## Real Vault Config

The server reads `$XDG_CONFIG_HOME/tansu/config.toml`, then
`~/.config/tansu/config.toml`.

```toml
[[vaults]]
name = "Personal"
path = "~/notes"
excluded_folders = ["archive/tmp"]

[[vaults]]
name = "Work"
path = "~/work-notes"
```

Nested vaults are rejected before startup.

## Generated Outputs

- `.dev/`: generated dev/test runtime state
- `web/static/app.js`: generated frontend bundle
- `web/static/app.js.map`: generated source map
- `bindings/`: ignored `ts-rs` output

Do not commit generated runtime state.
