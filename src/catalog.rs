use std::time::{SystemTime, UNIX_EPOCH};

use rand::RngCore;
use rusqlite::{Connection, OptionalExtension, Transaction, params};

use crate::api_types::{
    ConflictDraftMeta, NoteEventKind, NoteEventSource, NoteMeta, RevisionMeta, SearchStatus,
    SessionState, Settings, UnresolvedReason,
};
use crate::{Error, Result};

#[derive(Debug, Clone)]
pub struct NoteRow {
    pub meta: NoteMeta,
    pub visible_hash: String,
    pub tombstoned: bool,
    pub unresolved_reason: Option<String>,
}

pub struct Catalog {
    conn: Connection,
}

pub struct InsertNote<'a> {
    pub path: &'a str,
    pub path_key: &'a str,
    pub title: &'a str,
    pub tags: &'a [String],
    pub content_hash: &'a str,
    pub kind: NoteEventKind,
    pub source: NoteEventSource,
    pub unresolved: Option<UnresolvedReason>,
}

impl Catalog {
    pub fn open(path: &std::path::Path) -> Result<Self> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let conn = Connection::open(path)?;
        conn.execute_batch(
            "
            PRAGMA foreign_keys = ON;
            PRAGMA journal_mode = WAL;
            PRAGMA synchronous = FULL;
            PRAGMA busy_timeout = 5000;
            ",
        )?;
        let mut catalog = Self { conn };
        catalog.migrate()?;
        Ok(catalog)
    }

    fn migrate(&mut self) -> Result<()> {
        self.conn.execute_batch(
            "
            PRAGMA foreign_keys = ON;
            CREATE TABLE IF NOT EXISTS schema_migrations (
              version INTEGER PRIMARY KEY,
              applied_at_ms INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS vault_meta (
              key TEXT PRIMARY KEY,
              value TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS notes (
              note_id TEXT PRIMARY KEY,
              path TEXT NOT NULL,
              path_key TEXT NOT NULL,
              title TEXT NOT NULL,
              tags_json TEXT NOT NULL,
              seq INTEGER NOT NULL,
              content_hash TEXT NOT NULL,
              visible_hash TEXT NOT NULL DEFAULT '',
              updated_at_ms INTEGER NOT NULL,
              tombstoned INTEGER NOT NULL DEFAULT 0,
              unresolved_reason TEXT
            );
            CREATE UNIQUE INDEX IF NOT EXISTS notes_live_path_key_unique
              ON notes(path_key)
              WHERE tombstoned = 0 AND unresolved_reason IS NULL;
            CREATE TABLE IF NOT EXISTS note_events (
              event_id INTEGER PRIMARY KEY AUTOINCREMENT,
              note_id TEXT NOT NULL,
              seq INTEGER NOT NULL,
              kind TEXT NOT NULL,
              source TEXT NOT NULL,
              path TEXT NOT NULL,
              content_hash TEXT,
              created_at_ms INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS conflict_drafts (
              draft_id INTEGER PRIMARY KEY AUTOINCREMENT,
              note_id TEXT NOT NULL,
              base_seq INTEGER NOT NULL,
              base_hash TEXT NOT NULL,
              content_hash TEXT NOT NULL,
              created_at_ms INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS pins (
              note_id TEXT PRIMARY KEY,
              pinned_at_ms INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS recent (
              note_id TEXT PRIMARY KEY,
              touched_at_ms INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS session (
              key TEXT PRIMARY KEY,
              value TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS settings (
              key TEXT PRIMARY KEY,
              value TEXT NOT NULL
            );
            ",
        )?;
        ensure_column(
            &self.conn,
            "notes",
            "visible_hash",
            "TEXT NOT NULL DEFAULT ''",
        )?;
        self.conn.execute(
            "UPDATE notes SET visible_hash=content_hash WHERE visible_hash=''",
            [],
        )?;
        self.conn.execute(
            "INSERT OR IGNORE INTO schema_migrations(version, applied_at_ms) VALUES(1, ?1)",
            params![now_ms()],
        )?;
        self.conn.execute(
            "INSERT OR IGNORE INTO vault_meta(key, value) VALUES('sync_version', '0')",
            [],
        )?;
        self.conn.execute(
            "INSERT OR IGNORE INTO vault_meta(key, value) VALUES('search_dirty', 'false')",
            [],
        )?;
        self.conn.execute(
            "INSERT OR IGNORE INTO vault_meta(key, value) VALUES('search_degraded', 'false')",
            [],
        )?;
        Ok(())
    }

    pub fn insert_note(&mut self, note: InsertNote<'_>) -> Result<String> {
        let note_id = generate_note_id();
        let tx = self.conn.transaction()?;
        insert_note_tx(&tx, &note_id, note)?;
        advance_sync_tx(&tx)?;
        tx.commit()?;
        Ok(note_id)
    }

    pub fn update_note_content(
        &mut self,
        note_id: &str,
        title: &str,
        tags: &[String],
        content_hash: &str,
        kind: NoteEventKind,
        source: NoteEventSource,
    ) -> Result<NoteMeta> {
        let tx = self.conn.transaction()?;
        let current =
            note_by_id_tx(&tx, note_id)?.ok_or_else(|| Error::NotFound(note_id.to_string()))?;
        let seq = current.meta.seq + 1;
        let now = now_ms();
        tx.execute(
            "UPDATE notes SET title=?2, tags_json=?3, seq=?4, content_hash=?5, updated_at_ms=?6, tombstoned=0, unresolved_reason=NULL WHERE note_id=?1",
            params![note_id, title, serde_json::to_string(tags)?, seq, content_hash, now],
        )?;
        tx.execute(
            "INSERT INTO note_events(note_id, seq, kind, source, path, content_hash, created_at_ms) VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![note_id, seq, event_kind(kind), event_source(source), current.meta.path, content_hash, now],
        )?;
        advance_sync_tx(&tx)?;
        tx.commit()?;
        self.note_row_by_id(note_id)?
            .map(|row| row.meta)
            .ok_or_else(|| Error::NotFound(note_id.to_string()))
    }

    pub fn rename_note(&mut self, note_id: &str, path: &str, path_key: &str) -> Result<NoteMeta> {
        let tx = self.conn.transaction()?;
        let current =
            note_by_id_tx(&tx, note_id)?.ok_or_else(|| Error::NotFound(note_id.to_string()))?;
        let seq = current.meta.seq + 1;
        let now = now_ms();
        tx.execute(
            "UPDATE notes SET path=?2, path_key=?3, seq=?4, updated_at_ms=?5 WHERE note_id=?1 AND tombstoned=0 AND unresolved_reason IS NULL",
            params![note_id, path, path_key, seq, now],
        )?;
        tx.execute(
            "INSERT INTO note_events(note_id, seq, kind, source, path, content_hash, created_at_ms) VALUES(?1, ?2, 'rename', 'user', ?3, NULL, ?4)",
            params![note_id, seq, path, now],
        )?;
        advance_sync_tx(&tx)?;
        tx.commit()?;
        self.note_row_by_id(note_id)?
            .map(|row| row.meta)
            .ok_or_else(|| Error::NotFound(note_id.to_string()))
    }

    pub fn tombstone_note(
        &mut self,
        note_id: &str,
        kind: NoteEventKind,
        source: NoteEventSource,
    ) -> Result<NoteMeta> {
        let tx = self.conn.transaction()?;
        let current =
            note_by_id_tx(&tx, note_id)?.ok_or_else(|| Error::NotFound(note_id.to_string()))?;
        let seq = current.meta.seq + 1;
        let now = now_ms();
        tx.execute(
            "UPDATE notes SET tombstoned=1, seq=?2, updated_at_ms=?3 WHERE note_id=?1",
            params![note_id, seq, now],
        )?;
        tx.execute(
            "INSERT INTO note_events(note_id, seq, kind, source, path, content_hash, created_at_ms) VALUES(?1, ?2, ?3, ?4, ?5, NULL, ?6)",
            params![note_id, seq, event_kind(kind), event_source(source), current.meta.path, now],
        )?;
        advance_sync_tx(&tx)?;
        tx.commit()?;
        self.note_row_by_id(note_id)?
            .map(|row| row.meta)
            .ok_or_else(|| Error::NotFound(note_id.to_string()))
    }

    pub fn mark_unresolved(&mut self, note_id: &str, reason: UnresolvedReason) -> Result<()> {
        self.conn.execute(
            "UPDATE notes SET unresolved_reason=?2 WHERE note_id=?1",
            params![note_id, unresolved_reason(reason)],
        )?;
        self.advance_sync()?;
        Ok(())
    }

    pub fn record_visible_hash(&mut self, note_id: &str, visible_hash: &str) -> Result<()> {
        self.conn.execute(
            "UPDATE notes SET visible_hash=?2 WHERE note_id=?1",
            params![note_id, visible_hash],
        )?;
        Ok(())
    }

    pub fn note_by_id(&self, note_id: &str) -> Result<Option<NoteMeta>> {
        Ok(self.note_row_by_id(note_id)?.and_then(|row| {
            if row.tombstoned || row.unresolved_reason.is_some() {
                None
            } else {
                Some(row.meta)
            }
        }))
    }

    pub fn note_row_by_id(&self, note_id: &str) -> Result<Option<NoteRow>> {
        let mut stmt = self.conn.prepare(
            "SELECT note_id, path, title, tags_json, seq, content_hash, visible_hash, updated_at_ms, tombstoned, unresolved_reason FROM notes WHERE note_id=?1",
        )?;
        stmt.query_row(params![note_id], row_from_sql)
            .optional()
            .map_err(Into::into)
    }

    pub fn note_by_path_key(&self, path_key: &str) -> Result<Option<NoteMeta>> {
        let mut stmt = self.conn.prepare(
            "SELECT note_id, path, title, tags_json, seq, content_hash, visible_hash, updated_at_ms, tombstoned, unresolved_reason FROM notes WHERE path_key=?1 AND tombstoned=0 AND unresolved_reason IS NULL",
        )?;
        let row: Option<NoteRow> = stmt.query_row(params![path_key], row_from_sql).optional()?;
        Ok(row.map(|row| row.meta))
    }

    pub fn live_notes(&self) -> Result<Vec<NoteMeta>> {
        let mut stmt = self.conn.prepare(
            "SELECT note_id, path, title, tags_json, seq, content_hash, visible_hash, updated_at_ms, tombstoned, unresolved_reason FROM notes WHERE tombstoned=0 AND unresolved_reason IS NULL ORDER BY path COLLATE NOCASE",
        )?;
        let rows = stmt.query_map([], row_from_sql)?;
        let mut notes = Vec::new();
        for row in rows {
            notes.push(row?.meta);
        }
        Ok(notes)
    }

    pub fn all_rows(&self) -> Result<Vec<NoteRow>> {
        let mut stmt = self.conn.prepare(
            "SELECT note_id, path, title, tags_json, seq, content_hash, visible_hash, updated_at_ms, tombstoned, unresolved_reason FROM notes ORDER BY path COLLATE NOCASE",
        )?;
        let rows = stmt.query_map([], row_from_sql)?;
        let mut notes = Vec::new();
        for row in rows {
            notes.push(row?);
        }
        Ok(notes)
    }

    pub fn latest_event(&self, note_id: &str) -> Result<Option<(String, String)>> {
        self.conn
            .query_row(
                "SELECT kind, source FROM note_events WHERE note_id=?1 ORDER BY event_id DESC LIMIT 1",
                params![note_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()
            .map_err(Into::into)
    }

    pub fn revisions(&self, note_id: &str) -> Result<Vec<RevisionMeta>> {
        let mut stmt = self.conn.prepare(
            "SELECT event_id, note_id, seq, kind, source, content_hash, created_at_ms FROM note_events WHERE note_id=?1 AND content_hash IS NOT NULL ORDER BY event_id DESC",
        )?;
        let rows = stmt.query_map(params![note_id], revision_from_sql)?;
        let mut revisions = Vec::new();
        for row in rows {
            revisions.push(row?);
        }
        Ok(revisions)
    }

    pub fn revision(&self, note_id: &str, event_id: i64) -> Result<Option<RevisionMeta>> {
        self.conn
            .query_row(
                "SELECT event_id, note_id, seq, kind, source, content_hash, created_at_ms FROM note_events WHERE note_id=?1 AND event_id=?2 AND content_hash IS NOT NULL",
                params![note_id, event_id],
                revision_from_sql,
            )
            .optional()
            .map_err(Into::into)
    }

    pub fn create_conflict_draft(
        &mut self,
        note_id: &str,
        base_seq: i64,
        base_hash: &str,
        content_hash: &str,
    ) -> Result<ConflictDraftMeta> {
        let now = now_ms();
        self.conn.execute(
            "INSERT INTO conflict_drafts(note_id, base_seq, base_hash, content_hash, created_at_ms) VALUES(?1, ?2, ?3, ?4, ?5)",
            params![note_id, base_seq, base_hash, content_hash, now],
        )?;
        let draft_id = self.conn.last_insert_rowid();
        Ok(ConflictDraftMeta {
            draft_id,
            note_id: note_id.to_string(),
            base_seq,
            base_hash: base_hash.to_string(),
            content_hash: content_hash.to_string(),
            created_at_ms: now,
        })
    }

    pub fn conflict_draft(
        &self,
        note_id: &str,
        draft_id: i64,
    ) -> Result<Option<ConflictDraftMeta>> {
        self.conn
            .query_row(
                "SELECT draft_id, note_id, base_seq, base_hash, content_hash, created_at_ms FROM conflict_drafts WHERE note_id=?1 AND draft_id=?2",
                params![note_id, draft_id],
                |row| {
                    Ok(ConflictDraftMeta {
                        draft_id: row.get(0)?,
                        note_id: row.get(1)?,
                        base_seq: row.get(2)?,
                        base_hash: row.get(3)?,
                        content_hash: row.get(4)?,
                        created_at_ms: row.get(5)?,
                    })
                },
            )
            .optional()
            .map_err(Into::into)
    }

    pub fn touch_recent(&mut self, note_id: &str) -> Result<()> {
        self.conn.execute(
            "INSERT INTO recent(note_id, touched_at_ms) VALUES(?1, ?2) ON CONFLICT(note_id) DO UPDATE SET touched_at_ms=excluded.touched_at_ms",
            params![note_id, now_ms()],
        )?;
        self.advance_sync()
    }

    pub fn recent(&self) -> Result<Vec<String>> {
        let mut stmt = self
            .conn
            .prepare("SELECT note_id FROM recent ORDER BY touched_at_ms DESC LIMIT 50")?;
        collect_strings(stmt.query_map([], |row| row.get(0))?)
    }

    pub fn set_pin(&mut self, note_id: &str, pinned: bool) -> Result<()> {
        if pinned {
            self.conn.execute(
                "INSERT OR REPLACE INTO pins(note_id, pinned_at_ms) VALUES(?1, ?2)",
                params![note_id, now_ms()],
            )?;
        } else {
            self.conn
                .execute("DELETE FROM pins WHERE note_id=?1", params![note_id])?;
        }
        self.advance_sync()
    }

    pub fn pinned(&self) -> Result<Vec<String>> {
        let mut stmt = self
            .conn
            .prepare("SELECT note_id FROM pins ORDER BY pinned_at_ms ASC")?;
        collect_strings(stmt.query_map([], |row| row.get(0))?)
    }

    pub fn settings(&self) -> Result<Settings> {
        let value: Option<String> = self
            .conn
            .query_row(
                "SELECT value FROM settings WHERE key='settings'",
                [],
                |row| row.get(0),
            )
            .optional()?;
        match value {
            Some(value) => Ok(serde_json::from_str(&value)?),
            None => Ok(Settings::default()),
        }
    }

    pub fn save_settings(&mut self, settings: &Settings) -> Result<()> {
        self.conn.execute(
            "INSERT INTO settings(key, value) VALUES('settings', ?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            params![serde_json::to_string(settings)?],
        )?;
        self.set_search_dirty(true, false)?;
        self.advance_sync()
    }

    pub fn session(&self) -> Result<SessionState> {
        let value: Option<String> = self
            .conn
            .query_row("SELECT value FROM session WHERE key='session'", [], |row| {
                row.get(0)
            })
            .optional()?;
        match value {
            Some(value) => Ok(serde_json::from_str(&value).unwrap_or_else(|_| default_session())),
            None => Ok(default_session()),
        }
    }

    pub fn save_session(&mut self, session: &SessionState) -> Result<()> {
        self.conn.execute(
            "INSERT INTO session(key, value) VALUES('session', ?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            params![serde_json::to_string(session)?],
        )?;
        self.advance_sync()
    }

    pub fn search_status(&self) -> Result<SearchStatus> {
        Ok(SearchStatus {
            dirty: self.meta_bool("search_dirty")?,
            degraded: self.meta_bool("search_degraded")?,
        })
    }

    pub fn set_search_dirty(&mut self, dirty: bool, degraded: bool) -> Result<()> {
        self.conn.execute(
            "INSERT INTO vault_meta(key, value) VALUES('search_dirty', ?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            params![dirty.to_string()],
        )?;
        self.conn.execute(
            "INSERT INTO vault_meta(key, value) VALUES('search_degraded', ?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            params![degraded.to_string()],
        )?;
        Ok(())
    }

    pub fn sync_version(&self) -> Result<i64> {
        let value: String = self.conn.query_row(
            "SELECT value FROM vault_meta WHERE key='sync_version'",
            [],
            |row| row.get(0),
        )?;
        Ok(value.parse().unwrap_or(0))
    }

    fn advance_sync(&mut self) -> Result<()> {
        let tx = self.conn.transaction()?;
        advance_sync_tx(&tx)?;
        tx.commit()?;
        Ok(())
    }

    fn meta_bool(&self, key: &str) -> Result<bool> {
        let value: String = self.conn.query_row(
            "SELECT value FROM vault_meta WHERE key=?1",
            params![key],
            |row| row.get(0),
        )?;
        Ok(value == "true")
    }
}

fn insert_note_tx(tx: &Transaction<'_>, note_id: &str, note: InsertNote<'_>) -> Result<()> {
    let now = now_ms();
    let unresolved = note.unresolved.map(unresolved_reason);
    tx.execute(
        "INSERT INTO notes(note_id, path, path_key, title, tags_json, seq, content_hash, visible_hash, updated_at_ms, tombstoned, unresolved_reason) VALUES(?1, ?2, ?3, ?4, ?5, 1, ?6, ?6, ?7, 0, ?8)",
        params![
            note_id,
            note.path,
            note.path_key,
            note.title,
            serde_json::to_string(note.tags)?,
            note.content_hash,
            now,
            unresolved
        ],
    )?;
    tx.execute(
        "INSERT INTO note_events(note_id, seq, kind, source, path, content_hash, created_at_ms) VALUES(?1, 1, ?2, ?3, ?4, ?5, ?6)",
        params![
            note_id,
            event_kind(note.kind),
            event_source(note.source),
            note.path,
            note.content_hash,
            now
        ],
    )?;
    Ok(())
}

fn note_by_id_tx(tx: &Transaction<'_>, note_id: &str) -> Result<Option<NoteRow>> {
    let mut stmt = tx.prepare(
        "SELECT note_id, path, title, tags_json, seq, content_hash, visible_hash, updated_at_ms, tombstoned, unresolved_reason FROM notes WHERE note_id=?1",
    )?;
    stmt.query_row(params![note_id], row_from_sql)
        .optional()
        .map_err(Into::into)
}

fn row_from_sql(row: &rusqlite::Row<'_>) -> rusqlite::Result<NoteRow> {
    let tags_json: String = row.get(3)?;
    let tags = serde_json::from_str(&tags_json).unwrap_or_default();
    Ok(NoteRow {
        meta: NoteMeta {
            note_id: row.get(0)?,
            path: row.get(1)?,
            title: row.get(2)?,
            tags,
            seq: row.get(4)?,
            content_hash: row.get(5)?,
            updated_at_ms: row.get(7)?,
        },
        visible_hash: row.get(6)?,
        tombstoned: row.get::<_, i64>(8)? != 0,
        unresolved_reason: row.get(9)?,
    })
}

fn revision_from_sql(row: &rusqlite::Row<'_>) -> rusqlite::Result<RevisionMeta> {
    Ok(RevisionMeta {
        event_id: row.get(0)?,
        note_id: row.get(1)?,
        seq: row.get(2)?,
        kind: note_event_kind(row.get::<_, String>(3)?.as_str()),
        source: note_event_source(row.get::<_, String>(4)?.as_str()),
        content_hash: row.get(5)?,
        created_at_ms: row.get(6)?,
    })
}

fn ensure_column(conn: &Connection, table: &str, column: &str, declaration: &str) -> Result<()> {
    let mut stmt = conn.prepare(&format!("PRAGMA table_info({table})"))?;
    let rows = stmt.query_map([], |row| row.get::<_, String>(1))?;
    for row in rows {
        if row? == column {
            return Ok(());
        }
    }
    conn.execute(
        &format!("ALTER TABLE {table} ADD COLUMN {column} {declaration}"),
        [],
    )?;
    Ok(())
}

fn collect_strings(
    rows: rusqlite::MappedRows<'_, impl FnMut(&rusqlite::Row<'_>) -> rusqlite::Result<String>>,
) -> Result<Vec<String>> {
    let mut out = Vec::new();
    for row in rows {
        out.push(row?);
    }
    Ok(out)
}

fn default_session() -> SessionState {
    SessionState {
        open_tabs: Vec::new(),
        active_note_id: None,
        closed_tabs: Vec::new(),
    }
}

fn advance_sync_tx(tx: &Transaction<'_>) -> Result<()> {
    let value: String = tx.query_row(
        "SELECT value FROM vault_meta WHERE key='sync_version'",
        [],
        |row| row.get(0),
    )?;
    let next = value.parse::<i64>().unwrap_or(0) + 1;
    tx.execute(
        "UPDATE vault_meta SET value=?1 WHERE key='sync_version'",
        params![next.to_string()],
    )?;
    Ok(())
}

pub fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .try_into()
        .unwrap_or(i64::MAX)
}

pub fn generate_note_id() -> String {
    let mut bytes = [0_u8; 16];
    rand::thread_rng().fill_bytes(&mut bytes);
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn event_kind(kind: NoteEventKind) -> &'static str {
    match kind {
        NoteEventKind::Baseline => "baseline",
        NoteEventKind::Create => "create",
        NoteEventKind::Import => "import",
        NoteEventKind::Save => "save",
        NoteEventKind::Rename => "rename",
        NoteEventKind::Delete => "delete",
        NoteEventKind::ExternalEdit => "external_edit",
        NoteEventKind::ExternalRename => "external_rename",
        NoteEventKind::ExternalDelete => "external_delete",
        NoteEventKind::ConflictRecovery => "conflict_recovery",
    }
}

fn note_event_kind(kind: &str) -> NoteEventKind {
    match kind {
        "baseline" => NoteEventKind::Baseline,
        "create" => NoteEventKind::Create,
        "import" => NoteEventKind::Import,
        "save" => NoteEventKind::Save,
        "rename" => NoteEventKind::Rename,
        "delete" => NoteEventKind::Delete,
        "external_edit" => NoteEventKind::ExternalEdit,
        "external_rename" => NoteEventKind::ExternalRename,
        "external_delete" => NoteEventKind::ExternalDelete,
        "conflict_recovery" => NoteEventKind::ConflictRecovery,
        _ => NoteEventKind::Save,
    }
}

fn event_source(source: NoteEventSource) -> &'static str {
    match source {
        NoteEventSource::User => "user",
        NoteEventSource::Import => "import",
        NoteEventSource::External => "external",
        NoteEventSource::Repair => "repair",
    }
}

fn note_event_source(source: &str) -> NoteEventSource {
    match source {
        "user" => NoteEventSource::User,
        "import" => NoteEventSource::Import,
        "external" => NoteEventSource::External,
        "repair" => NoteEventSource::Repair,
        _ => NoteEventSource::User,
    }
}

fn unresolved_reason(reason: UnresolvedReason) -> &'static str {
    match reason {
        UnresolvedReason::CaseFoldCollision => "case_fold_collision",
        UnresolvedReason::InvalidUtf8 => "invalid_utf8",
        UnresolvedReason::MissingSnapshot => "missing_snapshot",
        UnresolvedReason::CorruptSnapshot => "corrupt_snapshot",
        UnresolvedReason::FileCatalogMismatch => "file_catalog_mismatch",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::api_types::SessionTab;

    #[test]
    fn live_path_uniqueness_allows_tombstone_reuse() {
        let dir = tempfile::tempdir().unwrap();
        let mut catalog = Catalog::open(&dir.path().join("vault.db")).unwrap();
        let first = catalog
            .insert_note(InsertNote {
                path: "A.md",
                path_key: "a.md",
                title: "A",
                tags: &[],
                content_hash: "sha256:first",
                kind: NoteEventKind::Baseline,
                source: NoteEventSource::External,
                unresolved: None,
            })
            .unwrap();
        catalog
            .tombstone_note(&first, NoteEventKind::Delete, NoteEventSource::User)
            .unwrap();
        catalog
            .insert_note(InsertNote {
                path: "a.md",
                path_key: "a.md",
                title: "a",
                tags: &[],
                content_hash: "sha256:second",
                kind: NoteEventKind::Create,
                source: NoteEventSource::User,
                unresolved: None,
            })
            .unwrap();
    }

    #[test]
    fn session_and_settings_round_trip() {
        let dir = tempfile::tempdir().unwrap();
        let mut catalog = Catalog::open(&dir.path().join("vault.db")).unwrap();
        let settings = Settings {
            excluded_folders: vec!["Archive".to_string()],
            ..Settings::default()
        };
        catalog.save_settings(&settings).unwrap();
        assert_eq!(
            catalog.settings().unwrap().excluded_folders,
            vec!["Archive"]
        );
        let session = SessionState {
            open_tabs: vec![SessionTab {
                note_id: "n".to_string(),
                title: "N".to_string(),
                path: "N.md".to_string(),
                cursor_offset: Some(0),
                source_mode: false,
            }],
            active_note_id: Some("n".to_string()),
            closed_tabs: Vec::new(),
        };
        catalog.save_session(&session).unwrap();
        assert_eq!(
            catalog.session().unwrap().active_note_id.as_deref(),
            Some("n")
        );
    }
}
