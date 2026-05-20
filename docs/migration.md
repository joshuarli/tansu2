# Migration

Tansu2 can open an existing Markdown vault by scanning `.md` files and assigning
new hidden `noteId`s in `.tansu/vault.db`.

## Safe First Run

1. Back up the vault.
2. Confirm the vault is not nested inside another configured vault.
3. Confirm note files are UTF-8 Markdown.
4. Keep existing `z-images/` assets where they are.
5. Add the vault to `$XDG_CONFIG_HOME/tansu/config.toml` or
   `~/.config/tansu/config.toml`.
6. Start Tansu2 and let startup reconciliation complete before editing.
7. Inspect any unresolved notes before making app-driven changes.

## Files Created

Tansu2 creates `.tansu/` inside the vault:

```text
.tansu/
  vault.db
  history/
  conflict-drafts/
  search/
```

Markdown files are not modified to add hidden IDs. Existing `z-images/` assets
remain ordinary vault files.

## First Scan Behavior

Each visible Markdown file gets:

- generated `noteId`
- path/title/tags metadata
- baseline history snapshot
- search document if indexing succeeds

Titles come from the first H1 or filename stem. Only tags-only frontmatter is
treated as metadata; unsupported frontmatter stays document content.

## Deferred Migration Work

V1 does not import legacy Tansu revisions or broad legacy settings. See `V2.md`.

## Safety Rules

- path case collisions become unresolved state
- invalid UTF-8 is not rewritten
- corrupt/missing snapshots do not overwrite visible Markdown
- moved-and-edited files become delete plus new note
- exact-hash moves preserve identity only when unambiguous
