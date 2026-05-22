use std::fs;
use std::path::{Component, Path, PathBuf};
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::{Arc, Mutex, MutexGuard};
use std::thread;
use std::time::Duration;

use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use rusqlite::ErrorCode;

use crate::api_types::{
    ApiErrorKind, BootstrapResponse, CreateNoteRequest, NoteDocument, NoteEventKind,
    NoteEventSource, NoteMeta, NoteMutationResponse, RenameNoteRequest, RevisionDocument,
    RevisionMeta, SaveNoteDeltaRequest, SaveNoteRequest, SearchHit, SearchStatus, ServerEvent,
    ServerEventKind, SessionState, Settings, TextEdit, TextPosition, VaultEntry,
};
use crate::catalog::{Catalog, InsertNote, now_ms};
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
    subscribers: Mutex<Vec<Sender<ServerEvent>>>,
    watcher: Mutex<Option<RecommendedWatcher>>,
    search_tx: Sender<SearchJob>,
    search_rx: Mutex<Option<Receiver<SearchJob>>>,
}

enum SearchJob {
    Upsert(NoteMeta, String),
    Remove(String),
    Rebuild,
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
        let mut search = SearchIndex::open(&config.path)?;
        if search.rebuild(&config.path, &notes).is_err() {
            catalog.set_search_dirty(true, true)?;
        }
        let (search_tx, search_rx) = mpsc::channel();
        Ok(Self {
            index,
            name: config.name.clone(),
            root: config.path.clone(),
            catalog: Mutex::new(catalog),
            search: Mutex::new(search),
            op_lock: Mutex::new(()),
            subscribers: Mutex::new(Vec::new()),
            watcher: Mutex::new(None),
            search_tx,
            search_rx: Mutex::new(Some(search_rx)),
        })
    }

    pub fn start_search_worker(self: &Arc<Self>) {
        let Some(rx) = self
            .search_rx
            .lock()
            .expect("search receiver mutex poisoned")
            .take()
        else {
            return;
        };
        let runtime = Arc::clone(self);
        thread::spawn(move || {
            while let Ok(job) = rx.recv() {
                runtime.run_search_job(job);
            }
        });
    }

    pub fn start_watcher(self: &Arc<Self>) -> Result<()> {
        let root = self.root.clone();
        let (tx, rx) = mpsc::channel::<()>();
        let mut watcher =
            notify::recommended_watcher(move |result: notify::Result<notify::Event>| {
                if let Ok(event) = result {
                    if event
                        .paths
                        .iter()
                        .any(|path| path.components().any(|part| part.as_os_str() == ".tansu"))
                    {
                        return;
                    }
                    let _ = tx.send(());
                }
            })?;
        watcher.watch(&root, RecursiveMode::Recursive)?;
        *self.watcher.lock().expect("watcher mutex poisoned") = Some(watcher);
        let runtime = Arc::clone(self);
        thread::spawn(move || {
            while rx.recv().is_ok() {
                while rx.recv_timeout(Duration::from_millis(150)).is_ok() {}
                let _ = runtime.reconcile_from_watcher();
            }
        });
        Ok(())
    }

    pub fn subscribe(&self) -> Result<Receiver<ServerEvent>> {
        let (tx, rx) = mpsc::channel();
        tx.send(self.server_event(ServerEventKind::Ready, Vec::new())?)
            .map_err(|error| Error::Internal(error.to_string()))?;
        self.subscribers
            .lock()
            .expect("subscribers mutex poisoned")
            .push(tx);
        Ok(rx)
    }

    pub fn bootstrap(
        &self,
        vaults: Vec<VaultEntry>,
        active_vault: usize,
    ) -> Result<BootstrapResponse> {
        let _op = self.lock_op();
        let catalog = self.lock_catalog();
        Ok(BootstrapResponse {
            api_version: crate::api::API_VERSION,
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
                return Err(Error::api(ApiErrorKind::PathInvalid { reason }));
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
            return Err(Error::api(ApiErrorKind::PathCollision { path }));
        }
        let note_id = match catalog.insert_note(InsertNote {
            path: &path,
            path_key: &key,
            title: &parsed.title,
            tags: &parsed.tags,
            content_hash: &hash,
            kind,
            source,
            unresolved: None,
        }) {
            Ok(note_id) => note_id,
            Err(Error::Sql(error)) if is_unique_violation(&error) => {
                return Err(Error::api(ApiErrorKind::PathCollision { path }));
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
        self.enqueue_search(SearchJob::Upsert(meta.clone(), content.clone()));
        self.broadcast(ServerEventKind::NoteChanged, Vec::new());
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
        self.save_reconstructed_note(
            note_id,
            &content,
            request.base_seq,
            &request.base_hash,
            true,
        )
    }

    pub fn save_note_delta(
        &self,
        note_id: &str,
        request: SaveNoteDeltaRequest,
    ) -> Result<NoteMutationResponse> {
        let _op = self.lock_op();
        {
            let catalog = self.lock_catalog();
            let current_row = catalog
                .note_row_by_id(note_id)?
                .ok_or_else(|| Error::NotFound(note_id.to_string()))?;
            if current_row.tombstoned || current_row.unresolved_reason.is_some() {
                return Err(Error::NotFound(note_id.to_string()));
            }
        }
        let base = match history::read_snapshot(&self.root, note_id, &request.base_hash) {
            Ok(base) => base,
            Err(Error::NotFound(_)) => {
                return Err(Error::BadRequest("base snapshot not found".to_string()));
            }
            Err(error) => return Err(error),
        };
        let content = apply_text_edits(&base, &request.edits)?;
        let submitted_hash = history::content_hash(&content);
        if submitted_hash != request.content_hash {
            return Err(Error::BadRequest("delta content hash mismatch".to_string()));
        }
        self.save_reconstructed_note(
            note_id,
            &content,
            request.base_seq,
            &request.base_hash,
            false,
        )
    }

    fn save_reconstructed_note(
        &self,
        note_id: &str,
        content: &str,
        base_seq: i64,
        base_hash: &str,
        include_document: bool,
    ) -> Result<NoteMutationResponse> {
        let content = history::canonical_markdown_string(content);
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
            let document = if include_document {
                Some(NoteDocument {
                    meta: current.clone(),
                    content: read_visible_or_snapshot(&self.root, &current)?,
                })
            } else {
                None
            };
            return Ok(NoteMutationResponse {
                document,
                meta: current,
                sync_version,
            });
        }
        if current.seq != base_seq || current.content_hash != base_hash {
            let draft =
                catalog.create_conflict_draft(note_id, base_seq, base_hash, &submitted_hash)?;
            history::write_conflict_draft(&self.root, note_id, draft.draft_id, &content)?;
            let current_doc = NoteDocument {
                meta: current.clone(),
                content: read_visible_or_snapshot(&self.root, &current)?,
            };
            return Err(Error::api(ApiErrorKind::SaveConflict {
                current: Box::new(current_doc),
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
        self.enqueue_search(SearchJob::Upsert(meta.clone(), content.clone()));
        self.broadcast(ServerEventKind::NoteChanged, Vec::new());
        let document = if include_document {
            Some(NoteDocument {
                meta: meta.clone(),
                content,
            })
        } else {
            None
        };
        Ok(NoteMutationResponse {
            document,
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
                return Err(Error::api(ApiErrorKind::PathInvalid { reason }));
            }
        };
        let key = path_key(&path);
        let mut catalog = self.lock_catalog();
        let current = catalog
            .note_by_id(note_id)?
            .ok_or_else(|| Error::NotFound(note_id.to_string()))?;
        if let Some(existing) = catalog.note_by_path_key(&key)?
            && existing.note_id != note_id
        {
            return Err(Error::api(ApiErrorKind::PathCollision { path }));
        }
        let old_visible = visible_path(&self.root, &current.path);
        let new_visible = visible_path(&self.root, &path);
        let meta = match catalog.rename_note(note_id, &path, &key) {
            Ok(meta) => meta,
            Err(Error::Sql(error)) if is_unique_violation(&error) => {
                return Err(Error::api(ApiErrorKind::PathCollision { path }));
            }
            Err(error) => return Err(error),
        };
        if let Some(parent) = new_visible.parent() {
            fs::create_dir_all(parent)?;
        }
        if old_visible.exists() {
            fs::rename(&old_visible, &new_visible)?;
            history::sync_parent_dir(&old_visible)?;
            history::sync_parent_dir(&new_visible)?;
        }
        let content = read_visible_or_snapshot(&self.root, &meta)?;
        let sync_version = catalog.sync_version()?;
        drop(catalog);
        self.enqueue_search(SearchJob::Upsert(meta.clone(), content.clone()));
        self.broadcast(ServerEventKind::NoteChanged, Vec::new());
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
            fs::remove_file(&visible)?;
            history::sync_parent_dir(&visible)?;
        }
        let sync_version = catalog.sync_version()?;
        drop(catalog);
        self.enqueue_search(SearchJob::Remove(note_id.to_string()));
        self.broadcast(ServerEventKind::NoteDeleted, vec![note_id.to_string()]);
        Ok(NoteMutationResponse {
            document: None,
            meta,
            sync_version,
        })
    }

    pub fn search(&self, query: &str) -> Result<Vec<SearchHit>> {
        let _op = self.lock_op();
        let (notes, settings) = {
            let catalog = self.lock_catalog();
            (catalog.live_notes()?, catalog.settings()?)
        };
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
        drop(catalog);
        self.enqueue_search(SearchJob::Rebuild);
        self.broadcast(ServerEventKind::SearchChanged, Vec::new());
        Ok(settings)
    }

    pub fn set_pin(&self, note_id: &str, pinned: bool) -> Result<()> {
        let _op = self.lock_op();
        let mut catalog = self.lock_catalog();
        if catalog.note_by_id(note_id)?.is_none() {
            return Err(Error::NotFound(note_id.to_string()));
        }
        catalog.set_pin(note_id, pinned)?;
        drop(catalog);
        self.broadcast(ServerEventKind::VaultChanged, Vec::new());
        Ok(())
    }

    pub fn search_status(&self) -> Result<SearchStatus> {
        let _op = self.lock_op();
        self.lock_catalog().search_status()
    }

    pub fn revisions(&self, note_id: &str) -> Result<Vec<RevisionMeta>> {
        let _op = self.lock_op();
        if self.lock_catalog().note_row_by_id(note_id)?.is_none() {
            return Err(Error::NotFound(note_id.to_string()));
        }
        self.lock_catalog().revisions(note_id)
    }

    pub fn revision_document(&self, note_id: &str, event_id: i64) -> Result<RevisionDocument> {
        let _op = self.lock_op();
        let catalog = self.lock_catalog();
        let revision = catalog
            .revision(note_id, event_id)?
            .ok_or_else(|| Error::NotFound(format!("revision {event_id}")))?;
        let hash = revision
            .content_hash
            .as_deref()
            .ok_or_else(|| Error::NotFound(format!("revision {event_id}")))?;
        let content = history::read_snapshot(&self.root, note_id, hash)?;
        Ok(RevisionDocument { revision, content })
    }

    pub fn restore_revision(&self, note_id: &str, event_id: i64) -> Result<NoteMutationResponse> {
        let _op = self.lock_op();
        let mut catalog = self.lock_catalog();
        let current = catalog
            .note_by_id(note_id)?
            .ok_or_else(|| Error::NotFound(note_id.to_string()))?;
        let revision = catalog
            .revision(note_id, event_id)?
            .ok_or_else(|| Error::NotFound(format!("revision {event_id}")))?;
        let hash = revision
            .content_hash
            .as_deref()
            .ok_or_else(|| Error::NotFound(format!("revision {event_id}")))?;
        let content = history::read_snapshot(&self.root, note_id, hash)?;
        let parsed = parse_markdown(&current.path, &content);
        let meta = catalog.update_note_content(
            note_id,
            &parsed.title,
            &parsed.tags,
            hash,
            NoteEventKind::Save,
            NoteEventSource::User,
        )?;
        catalog.touch_recent(note_id)?;
        let sync_version = catalog.sync_version()?;
        history::write_visible_atomic(&visible_path(&self.root, &meta.path), &content)?;
        catalog.record_visible_hash(note_id, hash)?;
        drop(catalog);
        self.enqueue_search(SearchJob::Upsert(meta.clone(), content.clone()));
        self.broadcast(ServerEventKind::NoteChanged, Vec::new());
        Ok(NoteMutationResponse {
            document: Some(NoteDocument {
                meta: meta.clone(),
                content,
            }),
            meta,
            sync_version,
        })
    }

    pub fn conflict_draft(
        &self,
        note_id: &str,
        draft_id: i64,
    ) -> Result<crate::api_types::ConflictDraftDocument> {
        let _op = self.lock_op();
        let catalog = self.lock_catalog();
        let draft = catalog
            .conflict_draft(note_id, draft_id)?
            .ok_or_else(|| Error::NotFound(format!("conflict draft {draft_id}")))?;
        let content =
            history::read_conflict_draft(&self.root, note_id, draft.draft_id, &draft.content_hash)?;
        Ok(crate::api_types::ConflictDraftDocument { draft, content })
    }

    pub fn restore_conflict_draft(
        &self,
        note_id: &str,
        draft_id: i64,
    ) -> Result<NoteMutationResponse> {
        let _op = self.lock_op();
        let mut catalog = self.lock_catalog();
        let current = catalog
            .note_by_id(note_id)?
            .ok_or_else(|| Error::NotFound(note_id.to_string()))?;
        let draft = catalog
            .conflict_draft(note_id, draft_id)?
            .ok_or_else(|| Error::NotFound(format!("conflict draft {draft_id}")))?;
        let content =
            history::read_conflict_draft(&self.root, note_id, draft.draft_id, &draft.content_hash)?;
        history::write_snapshot(&self.root, note_id, &content)?;
        let parsed = parse_markdown(&current.path, &content);
        let meta = catalog.update_note_content(
            note_id,
            &parsed.title,
            &parsed.tags,
            &draft.content_hash,
            NoteEventKind::ConflictRecovery,
            NoteEventSource::User,
        )?;
        catalog.touch_recent(note_id)?;
        let sync_version = catalog.sync_version()?;
        history::write_visible_atomic(&visible_path(&self.root, &meta.path), &content)?;
        catalog.record_visible_hash(note_id, &draft.content_hash)?;
        drop(catalog);
        self.enqueue_search(SearchJob::Upsert(meta.clone(), content.clone()));
        self.broadcast(ServerEventKind::NoteChanged, Vec::new());
        Ok(NoteMutationResponse {
            document: Some(NoteDocument {
                meta: meta.clone(),
                content,
            }),
            meta,
            sync_version,
        })
    }

    pub fn upload_image(&self, bytes: &[u8]) -> Result<crate::api_types::ImageUploadResponse> {
        if bytes.is_empty() {
            return Err(Error::BadRequest("image body is empty".to_string()));
        }
        let name = format!(
            "z-images/image-{}-{}.webp",
            now_ms(),
            crate::catalog::generate_note_id()
        );
        let path = visible_path(&self.root, &name);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        history::write_bytes_atomic(&path, bytes)?;
        Ok(crate::api_types::ImageUploadResponse {
            markdown: format!("![[{name}]]"),
            name,
        })
    }

    pub fn read_asset(&self, name: &str) -> Result<Vec<u8>> {
        let path = normalize_asset_path(name)?;
        if !path.to_string_lossy().starts_with("z-images/") {
            return Err(Error::BadRequest(
                "asset must be under z-images/".to_string(),
            ));
        }
        fs::read(self.root.join(&path)).map_err(|error| {
            if error.kind() == std::io::ErrorKind::NotFound {
                Error::NotFound(name.to_string())
            } else {
                Error::Io(error)
            }
        })
    }

    fn enqueue_search(&self, job: SearchJob) {
        if let Ok(mut catalog) = self.catalog.lock() {
            let _ = catalog.set_search_dirty(true, false);
        }
        if self.search_tx.send(job).is_err()
            && let Ok(mut catalog) = self.catalog.lock()
        {
            let _ = catalog.set_search_dirty(true, true);
        }
    }

    fn run_search_job(&self, job: SearchJob) {
        let result = match job {
            SearchJob::Upsert(meta, content) => {
                let mut search = self.search.lock().expect("search mutex poisoned");
                search.index_note(meta, &content);
                (search.dirty, search.degraded)
            }
            SearchJob::Remove(note_id) => {
                let mut search = self.search.lock().expect("search mutex poisoned");
                search.remove_note(&note_id);
                (search.dirty, search.degraded)
            }
            SearchJob::Rebuild => {
                let notes = match self.catalog.lock() {
                    Ok(mut catalog) => match catalog.live_notes() {
                        Ok(notes) => notes,
                        Err(_) => {
                            let _ = catalog.set_search_dirty(true, true);
                            return;
                        }
                    },
                    Err(_) => return,
                };
                let mut search = self.search.lock().expect("search mutex poisoned");
                if search.rebuild(&self.root, &notes).is_err() {
                    (true, true)
                } else {
                    (search.dirty, search.degraded)
                }
            }
        };
        if let Ok(mut catalog) = self.catalog.lock() {
            let _ = catalog.set_search_dirty(result.0, result.1);
        }
    }

    fn reconcile_from_watcher(&self) -> Result<()> {
        let _op = self.lock_op();
        let mut catalog = self.lock_catalog();
        let before = catalog
            .live_notes()?
            .into_iter()
            .map(|note| note.note_id)
            .collect::<std::collections::HashSet<_>>();
        let settings = catalog.settings()?;
        reconcile_vault(&self.root, &mut catalog, &settings.excluded_folders)?;
        let notes = catalog.live_notes()?;
        let after = notes
            .iter()
            .map(|note| note.note_id.clone())
            .collect::<std::collections::HashSet<_>>();
        let deleted = before.difference(&after).cloned().collect::<Vec<_>>();
        drop(catalog);
        self.enqueue_search(SearchJob::Rebuild);
        self.broadcast(ServerEventKind::VaultChanged, deleted);
        Ok(())
    }

    fn server_event(
        &self,
        kind: ServerEventKind,
        deleted_note_ids: Vec<String>,
    ) -> Result<ServerEvent> {
        let catalog = self.lock_catalog();
        Ok(ServerEvent {
            kind,
            vault: self.index,
            notes: catalog.live_notes()?,
            deleted_note_ids,
            search_status: catalog.search_status()?,
        })
    }

    fn broadcast(&self, kind: ServerEventKind, deleted_note_ids: Vec<String>) {
        let Ok(event) = self.server_event(kind, deleted_note_ids) else {
            return;
        };
        let mut subscribers = self.subscribers.lock().expect("subscribers mutex poisoned");
        subscribers.retain(|tx| tx.send(event.clone()).is_ok());
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

fn apply_text_edits(base: &str, edits: &[TextEdit]) -> Result<String> {
    let base = normalize_markdown_lf(base);
    let mut ranges = Vec::with_capacity(edits.len());
    let mut previous_start: Option<&TextPosition> = None;
    let mut previous_end: Option<&TextPosition> = None;
    for edit in edits {
        if edit.text.contains('\r') {
            return Err(Error::BadRequest("delta edit text contains CR".to_string()));
        }
        if compare_position(&edit.start, &edit.end).is_gt() {
            return Err(Error::BadRequest(
                "delta edit range is reversed".to_string(),
            ));
        }
        if let Some(previous_start) = previous_start {
            if compare_position(&edit.start, previous_start).is_eq()
                || compare_position(&edit.start, previous_end.expect("previous end")).is_lt()
            {
                return Err(Error::BadRequest(
                    "delta edits must be sorted and non-overlapping".to_string(),
                ));
            }
        }
        let start = text_position_to_byte_offset(&base, &edit.start)?;
        let end = text_position_to_byte_offset(&base, &edit.end)?;
        if start > end {
            return Err(Error::BadRequest(
                "delta edit range is reversed".to_string(),
            ));
        }
        ranges.push((start, end, edit.text.as_str()));
        previous_start = Some(&edit.start);
        previous_end = Some(&edit.end);
    }

    let mut content = base;
    for (start, end, text) in ranges.into_iter().rev() {
        content.replace_range(start..end, text);
    }
    Ok(content)
}

fn normalize_markdown_lf(content: &str) -> String {
    content.replace("\r\n", "\n").replace('\r', "\n")
}

fn compare_position(left: &TextPosition, right: &TextPosition) -> std::cmp::Ordering {
    left.line
        .cmp(&right.line)
        .then_with(|| left.character.cmp(&right.character))
}

fn text_position_to_byte_offset(content: &str, position: &TextPosition) -> Result<usize> {
    let mut line_start = 0;
    for (line, segment) in content.split('\n').enumerate() {
        if line == position.line {
            return utf16_character_to_byte_offset(segment, position.character)
                .map(|column| line_start + column);
        }
        line_start += segment.len() + 1;
    }
    Err(Error::BadRequest(
        "delta edit position is outside the base document".to_string(),
    ))
}

fn utf16_character_to_byte_offset(line: &str, character: usize) -> Result<usize> {
    let mut utf16_offset = 0;
    for (byte_offset, ch) in line.char_indices() {
        if utf16_offset == character {
            return Ok(byte_offset);
        }
        utf16_offset += ch.len_utf16();
        if utf16_offset > character {
            return Err(Error::BadRequest(
                "delta edit position splits a UTF-16 surrogate pair".to_string(),
            ));
        }
    }
    if utf16_offset == character {
        Ok(line.len())
    } else {
        Err(Error::BadRequest(
            "delta edit position is outside the base document".to_string(),
        ))
    }
}

fn normalize_asset_path(path: &str) -> Result<PathBuf> {
    let raw = Path::new(path);
    if raw.is_absolute() {
        return Err(Error::BadRequest("asset path must be relative".to_string()));
    }
    let mut normalized = PathBuf::new();
    for component in raw.components() {
        match component {
            Component::Normal(part) => normalized.push(part),
            _ => return Err(Error::BadRequest("invalid asset path".to_string())),
        }
    }
    if normalized
        .components()
        .any(|part| part.as_os_str() == ".tansu")
    {
        return Err(Error::BadRequest("invalid asset path".to_string()));
    }
    Ok(normalized)
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
    use crate::api_types::{
        PathValidationReason, SaveNoteDeltaRequest, SaveNoteRequest, TextEdit, TextPosition,
    };

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

        let Error::Api(error) = error else {
            panic!("expected API error");
        };
        assert!(matches!(
            *error,
            ApiErrorKind::PathInvalid {
                reason: PathValidationReason::Traversal
            }
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

        let Error::Api(error) = error else {
            panic!("expected save conflict");
        };
        let ApiErrorKind::SaveConflict { current, draft } = *error else {
            panic!("expected save conflict");
        };
        assert_eq!(current.meta.note_id, created.meta.note_id);
        assert_eq!(draft.note_id, created.meta.note_id);
        assert_eq!(draft.base_seq, base_seq);
    }

    #[test]
    fn revision_restore_appends_recoverable_event() {
        let vault = test_vault();
        let created = vault
            .create_note(CreateNoteRequest {
                path: "A.md".to_string(),
                content: "# A\n\nfirst\n".to_string(),
                source: None,
            })
            .unwrap();
        vault
            .save_note(
                &created.meta.note_id,
                SaveNoteRequest {
                    content: "# A\n\nsecond\n".to_string(),
                    base_seq: created.meta.seq,
                    base_hash: created.meta.content_hash.clone(),
                    checkpoint: Some(true),
                },
            )
            .unwrap();

        let revisions = vault.revisions(&created.meta.note_id).unwrap();
        let oldest = revisions.last().unwrap();
        let restored = vault
            .restore_revision(&created.meta.note_id, oldest.event_id)
            .unwrap();

        assert_eq!(restored.document.unwrap().content, "# A\r\n\r\nfirst\r\n");
        assert!(vault.revisions(&created.meta.note_id).unwrap().len() >= 3);
    }

    #[test]
    fn conflict_draft_can_be_restored_without_losing_current_snapshot() {
        let vault = test_vault();
        let created = vault
            .create_note(CreateNoteRequest {
                path: "A.md".to_string(),
                content: "# A\n\nbase\n".to_string(),
                source: None,
            })
            .unwrap();
        vault
            .save_note(
                &created.meta.note_id,
                SaveNoteRequest {
                    content: "# A\n\naccepted\n".to_string(),
                    base_seq: created.meta.seq,
                    base_hash: created.meta.content_hash.clone(),
                    checkpoint: None,
                },
            )
            .unwrap();
        let error = vault
            .save_note(
                &created.meta.note_id,
                SaveNoteRequest {
                    content: "# A\n\ndraft\n".to_string(),
                    base_seq: created.meta.seq,
                    base_hash: created.meta.content_hash,
                    checkpoint: None,
                },
            )
            .unwrap_err();
        let Error::Api(error) = error else {
            panic!("expected conflict");
        };
        let ApiErrorKind::SaveConflict { draft, .. } = *error else {
            panic!("expected conflict");
        };

        let draft_doc = vault
            .conflict_draft(&created.meta.note_id, draft.draft_id)
            .unwrap();
        assert_eq!(draft_doc.content, "# A\r\n\r\ndraft\r\n");
        let restored = vault
            .restore_conflict_draft(&created.meta.note_id, draft.draft_id)
            .unwrap();

        assert_eq!(restored.document.unwrap().content, "# A\r\n\r\ndraft\r\n");
        let revisions = vault.revisions(&created.meta.note_id).unwrap();
        assert!(
            revisions
                .iter()
                .any(|revision| matches!(revision.kind, NoteEventKind::ConflictRecovery))
        );
    }

    #[test]
    fn text_edits_apply_utf16_ranges_and_multiline_text() {
        let content = apply_text_edits(
            "alpha\nemoji 😀\nomega\n",
            &[
                TextEdit {
                    start: TextPosition {
                        line: 1,
                        character: 6,
                    },
                    end: TextPosition {
                        line: 1,
                        character: 8,
                    },
                    text: "😁".to_string(),
                },
                TextEdit {
                    start: TextPosition {
                        line: 2,
                        character: 5,
                    },
                    end: TextPosition {
                        line: 2,
                        character: 5,
                    },
                    text: "\ntrail".to_string(),
                },
            ],
        )
        .unwrap();

        assert_eq!(content, "alpha\nemoji 😁\nomega\ntrail\n");
    }

    #[test]
    fn text_edits_reject_invalid_ranges() {
        let split_pair = apply_text_edits(
            "😀\n",
            &[TextEdit {
                start: TextPosition {
                    line: 0,
                    character: 1,
                },
                end: TextPosition {
                    line: 0,
                    character: 1,
                },
                text: "x".to_string(),
            }],
        );
        assert!(matches!(split_pair, Err(Error::BadRequest(_))));

        let overlapping = apply_text_edits(
            "abcd",
            &[
                TextEdit {
                    start: TextPosition {
                        line: 0,
                        character: 1,
                    },
                    end: TextPosition {
                        line: 0,
                        character: 3,
                    },
                    text: "x".to_string(),
                },
                TextEdit {
                    start: TextPosition {
                        line: 0,
                        character: 2,
                    },
                    end: TextPosition {
                        line: 0,
                        character: 4,
                    },
                    text: "y".to_string(),
                },
            ],
        );
        assert!(matches!(overlapping, Err(Error::BadRequest(_))));
    }

    #[test]
    fn delta_save_writes_snapshot_without_echoing_document() {
        let vault = test_vault();
        let created = vault
            .create_note(CreateNoteRequest {
                path: "A.md".to_string(),
                content: "# A\n\nbase\n".to_string(),
                source: None,
            })
            .unwrap();
        let next = "# A\n\nchanged\n";
        let response = vault
            .save_note_delta(
                &created.meta.note_id,
                SaveNoteDeltaRequest {
                    base_seq: created.meta.seq,
                    base_hash: created.meta.content_hash.clone(),
                    content_hash: history::content_hash(next),
                    edits: vec![TextEdit {
                        start: TextPosition {
                            line: 2,
                            character: 0,
                        },
                        end: TextPosition {
                            line: 2,
                            character: 4,
                        },
                        text: "changed".to_string(),
                    }],
                    checkpoint: None,
                },
            )
            .unwrap();

        assert!(response.document.is_none());
        assert_eq!(
            history::read_snapshot(
                &vault.root,
                &created.meta.note_id,
                &response.meta.content_hash
            )
            .unwrap(),
            "# A\r\n\r\nchanged\r\n"
        );
        assert_eq!(
            fs::read_to_string(visible_path(&vault.root, &response.meta.path)).unwrap(),
            "# A\r\n\r\nchanged\r\n"
        );
    }

    #[test]
    fn stale_delta_save_creates_conflict_draft_from_reconstructed_content() {
        let vault = test_vault();
        let created = vault
            .create_note(CreateNoteRequest {
                path: "A.md".to_string(),
                content: "# A\n\nbase\n".to_string(),
                source: None,
            })
            .unwrap();
        vault
            .save_note(
                &created.meta.note_id,
                SaveNoteRequest {
                    content: "# A\n\naccepted\n".to_string(),
                    base_seq: created.meta.seq,
                    base_hash: created.meta.content_hash.clone(),
                    checkpoint: None,
                },
            )
            .unwrap();
        let stale = "# A\n\nstale\n";
        let error = vault
            .save_note_delta(
                &created.meta.note_id,
                SaveNoteDeltaRequest {
                    base_seq: created.meta.seq,
                    base_hash: created.meta.content_hash,
                    content_hash: history::content_hash(stale),
                    edits: vec![TextEdit {
                        start: TextPosition {
                            line: 2,
                            character: 0,
                        },
                        end: TextPosition {
                            line: 2,
                            character: 4,
                        },
                        text: "stale".to_string(),
                    }],
                    checkpoint: None,
                },
            )
            .unwrap_err();

        let Error::Api(error) = error else {
            panic!("expected save conflict");
        };
        let ApiErrorKind::SaveConflict { draft, .. } = *error else {
            panic!("expected save conflict");
        };
        let draft = vault
            .conflict_draft(&created.meta.note_id, draft.draft_id)
            .unwrap();
        assert_eq!(draft.content, "# A\r\n\r\nstale\r\n");
    }

    #[test]
    fn delta_hash_mismatch_mutates_nothing() {
        let vault = test_vault();
        let created = vault
            .create_note(CreateNoteRequest {
                path: "A.md".to_string(),
                content: "# A\n\nbase\n".to_string(),
                source: None,
            })
            .unwrap();
        let error = vault
            .save_note_delta(
                &created.meta.note_id,
                SaveNoteDeltaRequest {
                    base_seq: created.meta.seq,
                    base_hash: created.meta.content_hash.clone(),
                    content_hash: history::content_hash("# wrong\n"),
                    edits: vec![TextEdit {
                        start: TextPosition {
                            line: 2,
                            character: 0,
                        },
                        end: TextPosition {
                            line: 2,
                            character: 4,
                        },
                        text: "changed".to_string(),
                    }],
                    checkpoint: None,
                },
            )
            .unwrap_err();

        assert!(matches!(error, Error::BadRequest(_)));
        assert_eq!(
            vault.open_note(&created.meta.note_id).unwrap().content,
            "# A\r\n\r\nbase\r\n"
        );
        assert_eq!(
            vault.open_note(&created.meta.note_id).unwrap().meta.seq,
            created.meta.seq
        );
    }

    #[test]
    fn uploaded_images_are_vault_scoped_assets() {
        let vault = test_vault();
        let uploaded = vault.upload_image(b"webp").unwrap();

        assert!(uploaded.name.starts_with("z-images/"));
        assert_eq!(vault.read_asset(&uploaded.name).unwrap(), b"webp");
        assert!(vault.read_asset("../bad.webp").is_err());
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
