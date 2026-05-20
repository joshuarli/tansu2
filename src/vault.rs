use std::fs;
use std::path::PathBuf;
use std::sync::{Mutex, MutexGuard};

use rusqlite::ErrorCode;

use crate::api_types::{
    ApiErrorKind, BootstrapResponse, CreateNoteRequest, NoteDocument, NoteEventKind,
    NoteEventSource, NoteMeta, NoteMutationResponse, RenameNoteRequest, SaveNoteRequest, SearchHit,
    SearchStatus, SessionState, Settings, VaultEntry,
};
use crate::catalog::Catalog;
use crate::config::VaultConfig;
use crate::history;
use crate::paths::{normalize_note_path, path_key, visible_path};
use crate::reconcile::reconcile_vault;
use crate::search::SearchIndex;
use crate::tags::parse_markdown;
use crate::{Error, Result};

pub struct VaultRuntime {
    pub index: usize,
    pub name: String,
    pub root: PathBuf,
    catalog: Mutex<Catalog>,
    search: Mutex<SearchIndex>,
    op_lock: Mutex<()>,
}

impl VaultRuntime {
    pub fn open(index: usize, config: &VaultConfig) -> Result<Self> {
        fs::create_dir_all(&config.path)?;
        fs::create_dir_all(config.path.join(".tansu"))?;
        let mut catalog = Catalog::open(&config.path.join(".tansu").join("vault.db"))?;
        let settings = catalog.settings()?;
        let excluded = if settings.excluded_folders.is_empty() {
            config.excluded_folders.clone()
        } else {
            settings.excluded_folders
        };
        reconcile_vault(&config.path, &mut catalog, &excluded)?;
        let notes = catalog.live_notes()?;
        let mut search = SearchIndex::default();
        if search.rebuild(&config.path, &notes).is_err() {
            catalog.set_search_dirty(true, true)?;
        }
        Ok(Self {
            index,
            name: config.name.clone(),
            root: config.path.clone(),
            catalog: Mutex::new(catalog),
            search: Mutex::new(search),
            op_lock: Mutex::new(()),
        })
    }

    pub fn bootstrap(
        &self,
        vaults: Vec<VaultEntry>,
        active_vault: usize,
    ) -> Result<BootstrapResponse> {
        let _op = self.lock_op();
        let catalog = self.lock_catalog();
        Ok(BootstrapResponse {
            vaults,
            active_vault,
            notes: catalog.live_notes()?,
            pinned_note_ids: catalog.pinned()?,
            recent_note_ids: catalog.recent()?,
            settings: catalog.settings()?,
            session: catalog.session()?,
            search_status: catalog.search_status()?,
        })
    }

    pub fn open_note(&self, note_id: &str) -> Result<NoteDocument> {
        let _op = self.lock_op();
        let mut catalog = self.lock_catalog();
        let meta = catalog
            .note_by_id(note_id)?
            .ok_or_else(|| Error::NotFound(note_id.to_string()))?;
        let content = read_visible_or_snapshot(&self.root, &meta)?;
        catalog.touch_recent(note_id)?;
        Ok(NoteDocument { meta, content })
    }

    pub fn create_note(&self, request: CreateNoteRequest) -> Result<NoteMutationResponse> {
        let _op = self.lock_op();
        let path = match normalize_note_path(&request.path) {
            Ok(path) => path,
            Err(reason) => {
                return Err(Error::Api(ApiErrorKind::PathInvalid { reason }));
            }
        };
        let key = path_key(&path);
        let source = request.source.unwrap_or(NoteEventSource::User);
        let kind = match source {
            NoteEventSource::Import => NoteEventKind::Import,
            _ => NoteEventKind::Create,
        };
        let content = history::canonical_markdown_string(&request.content);
        let parsed = parse_markdown(&path, &content);
        let hash = history::content_hash(&content);
        let mut catalog = self.lock_catalog();
        if catalog.note_by_path_key(&key)?.is_some() {
            return Err(Error::Api(ApiErrorKind::PathCollision { path }));
        }
        let note_id = match catalog.insert_note(
            &path,
            &key,
            &parsed.title,
            &parsed.tags,
            &hash,
            kind,
            source,
            None,
        ) {
            Ok(note_id) => note_id,
            Err(Error::Sql(error)) if is_unique_violation(&error) => {
                return Err(Error::Api(ApiErrorKind::PathCollision { path }));
            }
            Err(error) => return Err(error),
        };
        history::write_snapshot(&self.root, &note_id, &content)?;
        history::write_visible_atomic(&visible_path(&self.root, &path), &content)?;
        let meta = catalog
            .note_by_id(&note_id)?
            .ok_or_else(|| Error::NotFound(note_id.clone()))?;
        catalog.touch_recent(&note_id)?;
        let sync_version = catalog.sync_version()?;
        drop(catalog);
        self.index_after_write(&meta, Some(&content));
        Ok(NoteMutationResponse {
            document: Some(NoteDocument {
                meta: meta.clone(),
                content,
            }),
            meta,
            sync_version,
        })
    }

    pub fn save_note(
        &self,
        note_id: &str,
        request: SaveNoteRequest,
    ) -> Result<NoteMutationResponse> {
        let _op = self.lock_op();
        let content = history::canonical_markdown_string(&request.content);
        let submitted_hash = history::content_hash(&content);
        let mut catalog = self.lock_catalog();
        let current_row = catalog
            .note_row_by_id(note_id)?
            .ok_or_else(|| Error::NotFound(note_id.to_string()))?;
        if current_row.tombstoned || current_row.unresolved_reason.is_some() {
            return Err(Error::NotFound(note_id.to_string()));
        }
        let current = current_row.meta;
        if current.content_hash == submitted_hash {
            if current_row.visible_hash != current.content_hash {
                let visible = visible_path(&self.root, &current.path);
                if let Ok(bytes) = fs::read(&visible) {
                    let visible_content = history::validate_and_canonicalize(&bytes)?;
                    if history::content_hash(&visible_content) == current_row.visible_hash {
                        let accepted = history::read_snapshot(
                            &self.root,
                            &current.note_id,
                            &current.content_hash,
                        )?;
                        history::write_visible_atomic(&visible, &accepted)?;
                        catalog.record_visible_hash(&current.note_id, &current.content_hash)?;
                    }
                }
            }
            catalog.touch_recent(note_id)?;
            let sync_version = catalog.sync_version()?;
            return Ok(NoteMutationResponse {
                document: Some(NoteDocument {
                    meta: current.clone(),
                    content: read_visible_or_snapshot(&self.root, &current)?,
                }),
                meta: current,
                sync_version,
            });
        }
        if current.seq != request.base_seq || current.content_hash != request.base_hash {
            let draft = catalog.create_conflict_draft(
                note_id,
                request.base_seq,
                &request.base_hash,
                &submitted_hash,
            )?;
            history::write_conflict_draft(&self.root, note_id, draft.draft_id, &content)?;
            let current_doc = NoteDocument {
                meta: current.clone(),
                content: read_visible_or_snapshot(&self.root, &current)?,
            };
            return Err(Error::Api(ApiErrorKind::SaveConflict {
                current: current_doc,
                draft,
            }));
        }
        history::write_snapshot(&self.root, note_id, &content)?;
        let parsed = parse_markdown(&current.path, &content);
        let meta = catalog.update_note_content(
            note_id,
            &parsed.title,
            &parsed.tags,
            &submitted_hash,
            NoteEventKind::Save,
            NoteEventSource::User,
        )?;
        catalog.touch_recent(note_id)?;
        let sync_version = catalog.sync_version()?;
        history::write_visible_atomic(&visible_path(&self.root, &meta.path), &content)?;
        catalog.record_visible_hash(note_id, &submitted_hash)?;
        drop(catalog);
        self.index_after_write(&meta, Some(&content));
        Ok(NoteMutationResponse {
            document: Some(NoteDocument {
                meta: meta.clone(),
                content,
            }),
            meta,
            sync_version,
        })
    }

    pub fn rename_note(
        &self,
        note_id: &str,
        request: RenameNoteRequest,
    ) -> Result<NoteMutationResponse> {
        let _op = self.lock_op();
        let path = match normalize_note_path(&request.path) {
            Ok(path) => path,
            Err(reason) => {
                return Err(Error::Api(ApiErrorKind::PathInvalid { reason }));
            }
        };
        let key = path_key(&path);
        let mut catalog = self.lock_catalog();
        let current = catalog
            .note_by_id(note_id)?
            .ok_or_else(|| Error::NotFound(note_id.to_string()))?;
        if let Some(existing) = catalog.note_by_path_key(&key)? {
            if existing.note_id != note_id {
                return Err(Error::Api(ApiErrorKind::PathCollision { path }));
            }
        }
        let old_visible = visible_path(&self.root, &current.path);
        let new_visible = visible_path(&self.root, &path);
        let meta = match catalog.rename_note(note_id, &path, &key) {
            Ok(meta) => meta,
            Err(Error::Sql(error)) if is_unique_violation(&error) => {
                return Err(Error::Api(ApiErrorKind::PathCollision { path }));
            }
            Err(error) => return Err(error),
        };
        if let Some(parent) = new_visible.parent() {
            fs::create_dir_all(parent)?;
        }
        if old_visible.exists() {
            fs::rename(old_visible, new_visible)?;
        }
        let content = read_visible_or_snapshot(&self.root, &meta)?;
        let sync_version = catalog.sync_version()?;
        drop(catalog);
        self.index_after_write(&meta, Some(&content));
        Ok(NoteMutationResponse {
            document: Some(NoteDocument {
                meta: meta.clone(),
                content,
            }),
            meta,
            sync_version,
        })
    }

    pub fn delete_note(&self, note_id: &str) -> Result<NoteMutationResponse> {
        let _op = self.lock_op();
        let mut catalog = self.lock_catalog();
        let current = catalog
            .note_by_id(note_id)?
            .ok_or_else(|| Error::NotFound(note_id.to_string()))?;
        let visible = visible_path(&self.root, &current.path);
        let meta = catalog.tombstone_note(note_id, NoteEventKind::Delete, NoteEventSource::User)?;
        if visible.exists() {
            fs::remove_file(visible)?;
        }
        let sync_version = catalog.sync_version()?;
        drop(catalog);
        self.index_after_write(&meta, None);
        Ok(NoteMutationResponse {
            document: None,
            meta,
            sync_version,
        })
    }

    pub fn search(&self, query: &str) -> Result<Vec<SearchHit>> {
        let _op = self.lock_op();
        let catalog = self.lock_catalog();
        let notes = catalog.live_notes()?;
        let settings = catalog.settings()?;
        let search = self.search.lock().expect("search mutex poisoned");
        Ok(search.search(query, &settings, &notes))
    }

    pub fn save_session(&self, session: SessionState) -> Result<()> {
        let _op = self.lock_op();
        self.lock_catalog().save_session(&session)
    }

    pub fn settings(&self) -> Result<Settings> {
        let _op = self.lock_op();
        self.lock_catalog().settings()
    }

    pub fn save_settings(&self, settings: Settings) -> Result<Settings> {
        let _op = self.lock_op();
        let mut catalog = self.lock_catalog();
        catalog.save_settings(&settings)?;
        let notes = catalog.live_notes()?;
        let result = self
            .search
            .lock()
            .expect("search mutex poisoned")
            .rebuild(&self.root, &notes);
        if result.is_err() {
            catalog.set_search_dirty(true, true)?;
        }
        Ok(settings)
    }

    pub fn set_pin(&self, note_id: &str, pinned: bool) -> Result<()> {
        let _op = self.lock_op();
        let mut catalog = self.lock_catalog();
        if catalog.note_by_id(note_id)?.is_none() {
            return Err(Error::NotFound(note_id.to_string()));
        }
        catalog.set_pin(note_id, pinned)
    }

    pub fn search_status(&self) -> Result<SearchStatus> {
        let _op = self.lock_op();
        self.lock_catalog().search_status()
    }

    fn index_after_write(&self, meta: &NoteMeta, content: Option<&str>) {
        let mut search = self.search.lock().expect("search mutex poisoned");
        match content {
            Some(content) => search.index_note(meta.clone(), content),
            None => search.remove_note(&meta.note_id),
        }
        if let Ok(mut catalog) = self.catalog.lock() {
            let _ = catalog.set_search_dirty(search.dirty, search.degraded);
        }
    }

    fn lock_op(&self) -> MutexGuard<'_, ()> {
        self.op_lock.lock().expect("vault operation mutex poisoned")
    }

    fn lock_catalog(&self) -> MutexGuard<'_, Catalog> {
        self.catalog.lock().expect("catalog mutex poisoned")
    }
}

fn read_visible_or_snapshot(root: &std::path::Path, meta: &NoteMeta) -> Result<String> {
    let visible = visible_path(root, &meta.path);
    match fs::read(&visible) {
        Ok(bytes) => history::validate_and_canonicalize(&bytes),
        Err(_) => history::read_snapshot(root, &meta.note_id, &meta.content_hash),
    }
}

fn is_unique_violation(error: &rusqlite::Error) -> bool {
    matches!(
        error,
        rusqlite::Error::SqliteFailure(inner, _)
            if inner.code == ErrorCode::ConstraintViolation
                || inner.extended_code == rusqlite::ffi::SQLITE_CONSTRAINT_UNIQUE
    )
}

#[cfg(test)]
mod tests {
    use crate::api_types::{PathValidationReason, SaveNoteRequest};

    use super::*;

    #[test]
    fn create_path_validation_returns_typed_api_error() {
        let vault = test_vault();
        let error = vault
            .create_note(CreateNoteRequest {
                path: "../bad.md".to_string(),
                content: "# Bad\n".to_string(),
                source: None,
            })
            .unwrap_err();

        assert!(matches!(
            error,
            Error::Api(ApiErrorKind::PathInvalid {
                reason: PathValidationReason::Traversal
            })
        ));
    }

    #[test]
    fn stale_save_returns_typed_conflict_with_draft_metadata() {
        let vault = test_vault();
        let created = vault
            .create_note(CreateNoteRequest {
                path: "A.md".to_string(),
                content: "# A\n\nold\n".to_string(),
                source: None,
            })
            .unwrap();
        let base_seq = created.meta.seq;
        let base_hash = created.meta.content_hash.clone();
        vault
            .save_note(
                &created.meta.note_id,
                SaveNoteRequest {
                    content: "# A\n\naccepted\n".to_string(),
                    base_seq,
                    base_hash: base_hash.clone(),
                    checkpoint: None,
                },
            )
            .unwrap();

        let error = vault
            .save_note(
                &created.meta.note_id,
                SaveNoteRequest {
                    content: "# A\n\nstale\n".to_string(),
                    base_seq,
                    base_hash,
                    checkpoint: None,
                },
            )
            .unwrap_err();

        let Error::Api(ApiErrorKind::SaveConflict { current, draft }) = error else {
            panic!("expected save conflict");
        };
        assert_eq!(current.meta.note_id, created.meta.note_id);
        assert_eq!(draft.note_id, created.meta.note_id);
        assert_eq!(draft.base_seq, base_seq);
    }

    fn test_vault() -> VaultRuntime {
        let dir = tempfile::tempdir().unwrap().keep();
        VaultRuntime::open(
            0,
            &VaultConfig {
                name: "Test".to_string(),
                path: dir,
                excluded_folders: Vec::new(),
            },
        )
        .unwrap()
    }
}
