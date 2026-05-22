use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct VaultEntry {
    pub index: usize,
    pub name: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct NoteMeta {
    pub note_id: String,
    pub path: String,
    pub title: String,
    pub tags: Vec<String>,
    #[ts(type = "number")]
    pub seq: i64,
    pub content_hash: String,
    #[ts(type = "number")]
    pub updated_at_ms: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct NoteDocument {
    pub meta: NoteMeta,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct RevisionMeta {
    #[ts(type = "number")]
    pub event_id: i64,
    pub note_id: String,
    #[ts(type = "number")]
    pub seq: i64,
    pub kind: NoteEventKind,
    pub source: NoteEventSource,
    pub content_hash: Option<String>,
    #[ts(type = "number")]
    pub created_at_ms: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct RevisionDocument {
    pub revision: RevisionMeta,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum NoteEventKind {
    Baseline,
    Create,
    Import,
    Save,
    Rename,
    Delete,
    ExternalEdit,
    ExternalRename,
    ExternalDelete,
    ConflictRecovery,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum NoteEventSource {
    User,
    Import,
    External,
    Repair,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ConflictDraftMeta {
    #[ts(type = "number")]
    pub draft_id: i64,
    pub note_id: String,
    #[ts(type = "number")]
    pub base_seq: i64,
    pub base_hash: String,
    pub content_hash: String,
    #[ts(type = "number")]
    pub created_at_ms: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ConflictDraftDocument {
    pub draft: ConflictDraftMeta,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
pub struct Settings {
    pub excluded_folders: Vec<String>,
    pub search_title_weight: f32,
    pub search_heading_weight: f32,
    pub search_tag_weight: f32,
    pub search_content_weight: f32,
    pub recency_boost: f32,
    #[ts(type = "number")]
    pub autosave_delay_ms: u64,
    #[ts(type = "number")]
    pub undo_stack_max: usize,
    pub image_webp_quality: f32,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            excluded_folders: Vec::new(),
            search_title_weight: 4.0,
            search_heading_weight: 2.0,
            search_tag_weight: 3.0,
            search_content_weight: 1.0,
            recency_boost: 0.1,
            autosave_delay_ms: 900,
            undo_stack_max: 200,
            image_webp_quality: 0.85,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct SessionState {
    pub open_tabs: Vec<SessionTab>,
    pub active_note_id: Option<String>,
    pub closed_tabs: Vec<SessionTab>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct SessionTab {
    pub note_id: String,
    pub title: String,
    pub path: String,
    pub cursor_offset: Option<usize>,
    pub source_mode: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct SearchStatus {
    pub dirty: bool,
    pub degraded: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct SearchFieldScores {
    pub title: f32,
    pub headings: f32,
    pub tags: f32,
    pub content: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub note: NoteMeta,
    pub snippet: String,
    pub score: f32,
    pub field_scores: SearchFieldScores,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct BootstrapResponse {
    #[ts(type = "number")]
    pub api_version: u32,
    pub vaults: Vec<VaultEntry>,
    pub active_vault: usize,
    pub notes: Vec<NoteMeta>,
    pub pinned_note_ids: Vec<String>,
    pub recent_note_ids: Vec<String>,
    pub settings: Settings,
    pub session: SessionState,
    pub search_status: SearchStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ServerEvent {
    pub kind: ServerEventKind,
    pub vault: usize,
    pub notes: Vec<NoteMeta>,
    pub deleted_note_ids: Vec<String>,
    pub search_status: SearchStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum ServerEventKind {
    Ready,
    VaultChanged,
    NoteChanged,
    NoteDeleted,
    SearchChanged,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
pub struct CreateNoteRequest {
    pub path: String,
    pub content: String,
    pub source: Option<NoteEventSource>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
pub struct SaveNoteRequest {
    pub content: String,
    #[ts(type = "number")]
    pub base_seq: i64,
    pub base_hash: String,
    pub checkpoint: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
pub struct SaveNoteDeltaRequest {
    #[ts(type = "number")]
    pub base_seq: i64,
    pub base_hash: String,
    pub content_hash: String,
    pub edits: Vec<TextEdit>,
    pub checkpoint: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
pub struct TextEdit {
    pub start: TextPosition,
    pub end: TextPosition,
    pub text: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
pub struct TextPosition {
    #[ts(type = "number")]
    pub line: usize,
    #[ts(type = "number")]
    pub character: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
pub struct RenameNoteRequest {
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct NoteMutationResponse {
    pub document: Option<NoteDocument>,
    pub meta: NoteMeta,
    #[ts(type = "number")]
    pub sync_version: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ImageUploadResponse {
    pub name: String,
    pub markdown: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ApiErrorResponse {
    pub error: ApiErrorKind,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(tag = "code", rename_all = "snake_case")]
pub enum ApiErrorKind {
    PathInvalid {
        reason: PathValidationReason,
    },
    PathCollision {
        path: String,
    },
    NoteNotFound {
        note_id: String,
    },
    SaveConflict {
        current: Box<NoteDocument>,
        draft: ConflictDraftMeta,
    },
    UnresolvedNote {
        note_id: String,
        reason: UnresolvedReason,
    },
    BadRequest {
        message: String,
    },
    Internal {
        message: String,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum PathValidationReason {
    Empty,
    Absolute,
    Traversal,
    DotTansu,
    NotMarkdown,
    NestedVault,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum UnresolvedReason {
    CaseFoldCollision,
    InvalidUtf8,
    MissingSnapshot,
    CorruptSnapshot,
    FileCatalogMismatch,
}
