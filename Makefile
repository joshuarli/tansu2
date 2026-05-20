NAME := tansu2
DEV_DIR := $(CURDIR)/.dev
DEV_CONFIG_HOME := $(DEV_DIR)/config

dev: types dev-config
	pnpm run bundle-dev
	XDG_CONFIG_HOME="$(DEV_CONFIG_HOME)" cargo run --bin $(NAME) -- --port 3000

dev-config:
	node scripts/test-fixture.mjs "$(DEV_DIR)"

check: types-check
	pnpm exec tsgo --noEmit --pretty false
	pnpm exec tsgo -p packages/md-wysiwyg/tsconfig.json --noEmit --pretty false
	cargo check -q

lint: types-check
	pnpm exec oxfmt --check --config oxfmt.config.mjs
	pnpm exec oxlint
	pnpm exec knip --reporter compact
	cargo fmt --check
	cargo clippy --all-targets -- -D warnings

coverage: types-check
	pnpm exec vitest run --coverage
	cd packages/md-wysiwyg && pnpm exec vitest run --coverage

audit:
	pnpm audit --prod --audit-level=high
	cargo deny check

ci: lint test test-e2e audit

types:
	cargo run --quiet --bin gen-api-types

types-check:
	cargo run --quiet --bin gen-api-types -- --check

ts: types
	pnpm run bundle-dev
	pnpm exec tsgo --noEmit --pretty false

test: types-check test-pkg test-ts test-rs

test-pkg:
	cd packages/md-wysiwyg && pnpm exec vitest run

test-ts:
	pnpm exec vitest run

test-e2e:
	TANSU2_E2E_BROWSER=chromium pnpm run test-e2e
	TANSU2_E2E_BROWSER=firefox pnpm run test-e2e
	TANSU2_E2E_BROWSER=webkit pnpm run test-e2e

test-rs:
	cargo test -q

bench:
	cd packages/md-wysiwyg && MD_WYSIWYG_BENCH=1 pnpm exec vitest run tests/large-note-bench.test.ts

bench-full: bench

.PHONY: audit bench bench-full ci coverage dev dev-config check lint types types-check ts test test-pkg test-ts test-e2e test-rs
