NAME := tansu2
DEV_DIR := $(CURDIR)/.dev
DEV_CONFIG_HOME := $(DEV_DIR)/config

dev: types dev-config
	pnpm run bundle-dev
	XDG_CONFIG_HOME="$(DEV_CONFIG_HOME)" cargo run --bin $(NAME) -- --port 3000

dev-config:
	node scripts/test-fixture.mjs "$(DEV_DIR)"

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

.PHONY: dev dev-config check types types-check ts test test-pkg test-ts test-e2e test-rs
