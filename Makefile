NAME := tansu2

dev: types
	pnpm run bundle-dev
	cargo run --bin $(NAME) -- --port 3000

check: types-check
	tsgo --noEmit --pretty false
	tsgo -p packages/md-wysiwyg/tsconfig.json --noEmit --pretty false
	cargo check -q

types:
	cargo run --quiet --bin gen-api-types

types-check:
	cargo run --quiet --bin gen-api-types -- --check

ts: types
	pnpm run bundle-dev
	tsgo --noEmit --pretty false

test: types-check test-pkg test-ts test-rs

test-pkg:
	cd packages/md-wysiwyg && vitest run

test-ts:
	vitest run

test-e2e:
	vitest run --config vitest.e2e.config.ts

test-rs:
	cargo test -q
