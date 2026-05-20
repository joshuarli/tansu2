use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::Path;

use crate::api_types::{NoteEventKind, NoteEventSource, UnresolvedReason};
use crate::catalog::Catalog;
use crate::history;
use crate::paths::{normalize_note_path, path_key};
use crate::tags::parse_markdown;
use crate::{Error, Result};

pub fn reconcile_vault(
    root: &Path,
    catalog: &mut Catalog,
    excluded_folders: &[String],
) -> Result<()> {
    let files = walk_markdown(root, excluded_folders)?;
    let mut seen_keys: HashMap<String, Vec<FileRecord>> = HashMap::new();
    for file in files {
        seen_keys
            .entry(file.path_key.clone())
            .or_default()
            .push(file);
    }

    for records in seen_keys.values_mut() {
        records.sort_by(|a, b| a.path.cmp(&b.path));
        if records.len() > 1 {
            for record in records.iter().skip(1) {
                insert_unresolved(root, catalog, record, UnresolvedReason::CaseFoldCollision)?;
            }
        }
    }

    let primary_files = seen_keys
        .values()
        .filter_map(|records| records.first().cloned())
        .collect::<Vec<_>>();
    let mut consumed = HashSet::new();

    for row in catalog.all_rows()? {
        if row.tombstoned || row.unresolved_reason.is_some() {
            continue;
        }
        if let Some(file) = primary_files
            .iter()
            .find(|file| file.path_key == path_key(&row.meta.path))
        {
            consumed.insert(file.path_key.clone());
            if let Some(reason) = file.unresolved.clone() {
                catalog.mark_unresolved(&row.meta.note_id, reason)?;
            } else if file.hash != row.meta.content_hash {
                if row.visible_hash != row.meta.content_hash && file.hash == row.visible_hash {
                    let content =
                        history::read_snapshot(root, &row.meta.note_id, &row.meta.content_hash)?;
                    history::write_visible_atomic(
                        &crate::paths::visible_path(root, &row.meta.path),
                        &content,
                    )?;
                    catalog.record_visible_hash(&row.meta.note_id, &row.meta.content_hash)?;
                } else {
                    let parsed = parse_markdown(&file.path, &file.content);
                    history::write_snapshot(root, &row.meta.note_id, &file.content)?;
                    catalog.update_note_content(
                        &row.meta.note_id,
                        &parsed.title,
                        &parsed.tags,
                        &file.hash,
                        NoteEventKind::ExternalEdit,
                        NoteEventSource::External,
                    )?;
                    catalog.record_visible_hash(&row.meta.note_id, &file.hash)?;
                }
            }
        } else if let Some(file) =
            exact_hash_match(&primary_files, &consumed, &row.meta.content_hash)
        {
            consumed.insert(file.path_key.clone());
            catalog.rename_note(&row.meta.note_id, &file.path, &file.path_key)?;
        } else if let Ok(content) =
            history::read_snapshot(root, &row.meta.note_id, &row.meta.content_hash)
        {
            if should_repair_missing_visible(catalog, &row.meta.note_id)? {
                history::write_visible_atomic(
                    &crate::paths::visible_path(root, &row.meta.path),
                    &content,
                )?;
                catalog.record_visible_hash(&row.meta.note_id, &row.meta.content_hash)?;
            } else {
                catalog.tombstone_note(
                    &row.meta.note_id,
                    NoteEventKind::ExternalDelete,
                    NoteEventSource::External,
                )?;
            }
        } else {
            catalog.mark_unresolved(&row.meta.note_id, UnresolvedReason::MissingSnapshot)?;
        }
    }

    for file in primary_files {
        if consumed.contains(&file.path_key) {
            continue;
        }
        if let Some(reason) = file.unresolved.clone() {
            insert_unresolved(root, catalog, &file, reason)?;
            continue;
        }
        if catalog.note_by_path_key(&file.path_key)?.is_some() {
            continue;
        }
        let parsed = parse_markdown(&file.path, &file.content);
        let note_id = catalog.insert_note(
            &file.path,
            &file.path_key,
            &parsed.title,
            &parsed.tags,
            &file.hash,
            NoteEventKind::Baseline,
            NoteEventSource::External,
            None,
        )?;
        history::write_snapshot(root, &note_id, &file.content)?;
    }
    Ok(())
}

#[derive(Debug, Clone)]
struct FileRecord {
    path: String,
    path_key: String,
    hash: String,
    content: String,
    unresolved: Option<UnresolvedReason>,
}

fn walk_markdown(root: &Path, excluded_folders: &[String]) -> Result<Vec<FileRecord>> {
    let mut out = Vec::new();
    walk_dir(root, root, excluded_folders, &mut out)?;
    Ok(out)
}

fn walk_dir(
    root: &Path,
    dir: &Path,
    excluded_folders: &[String],
    out: &mut Vec<FileRecord>,
) -> Result<()> {
    if !dir.exists() {
        fs::create_dir_all(dir)?;
    }
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        let file_name = entry.file_name().to_string_lossy().to_string();
        if file_name == ".tansu" || excluded_folders.iter().any(|folder| folder == &file_name) {
            continue;
        }
        if path.is_dir() {
            walk_dir(root, &path, excluded_folders, out)?;
            continue;
        }
        if path.extension().and_then(|value| value.to_str()) != Some("md") {
            continue;
        }
        let rel = path
            .strip_prefix(root)
            .map_err(|_| Error::Internal("walked path outside vault".to_string()))?
            .to_string_lossy()
            .replace('\\', "/");
        let rel = match normalize_note_path(&rel) {
            Ok(rel) => rel,
            Err(_) => continue,
        };
        let bytes = fs::read(&path)?;
        let content = match history::validate_and_canonicalize(&bytes) {
            Ok(content) => content,
            Err(_) => {
                let hash = format!("invalid-utf8:{}", path_key(&rel));
                out.push(FileRecord {
                    path: rel.clone(),
                    path_key: path_key(&rel),
                    hash,
                    content: String::new(),
                    unresolved: Some(UnresolvedReason::InvalidUtf8),
                });
                continue;
            }
        };
        let hash = history::content_hash(&content);
        out.push(FileRecord {
            path: rel.clone(),
            path_key: path_key(&rel),
            hash,
            content,
            unresolved: None,
        });
    }
    Ok(())
}

fn exact_hash_match<'a>(
    files: &'a [FileRecord],
    consumed: &HashSet<String>,
    content_hash: &str,
) -> Option<&'a FileRecord> {
    let matches = files
        .iter()
        .filter(|file| !consumed.contains(&file.path_key))
        .filter(|file| file.unresolved.is_none())
        .filter(|file| file.hash == content_hash)
        .collect::<Vec<_>>();
    if matches.len() == 1 {
        matches.first().copied()
    } else {
        None
    }
}

fn should_repair_missing_visible(catalog: &Catalog, note_id: &str) -> Result<bool> {
    let Some((kind, source)) = catalog.latest_event(note_id)? else {
        return Ok(false);
    };
    Ok(source == "user" && matches!(kind.as_str(), "create" | "save" | "rename" | "import"))
}

fn insert_unresolved(
    root: &Path,
    catalog: &mut Catalog,
    record: &FileRecord,
    reason: UnresolvedReason,
) -> Result<()> {
    if catalog.note_by_path_key(&record.path_key)?.is_some() {
        return Ok(());
    }
    let parsed = parse_markdown(&record.path, &record.content);
    let note_id = catalog.insert_note(
        &record.path,
        &record.path_key,
        &parsed.title,
        &parsed.tags,
        &record.hash,
        NoteEventKind::Baseline,
        NoteEventSource::External,
        Some(reason),
    )?;
    if !record.content.is_empty() {
        let _ = history::write_snapshot(root, &note_id, &record.content);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::fs;

    use crate::api_types::{NoteEventKind, NoteEventSource};

    use super::*;

    #[test]
    fn exact_hash_external_rename_preserves_note_id() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("A.md"), "# A\n\nsame\n").unwrap();
        let mut catalog = Catalog::open(&dir.path().join(".tansu").join("vault.db")).unwrap();
        reconcile_vault(dir.path(), &mut catalog, &[]).unwrap();
        let before = catalog.live_notes().unwrap().remove(0);

        fs::rename(dir.path().join("A.md"), dir.path().join("Renamed.md")).unwrap();
        reconcile_vault(dir.path(), &mut catalog, &[]).unwrap();
        let after = catalog.live_notes().unwrap().remove(0);

        assert_eq!(after.note_id, before.note_id);
        assert_eq!(after.path, "Renamed.md");
    }

    #[test]
    fn moved_and_edited_file_becomes_delete_plus_new_note() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("A.md"), "# A\n\nsame\n").unwrap();
        let mut catalog = Catalog::open(&dir.path().join(".tansu").join("vault.db")).unwrap();
        reconcile_vault(dir.path(), &mut catalog, &[]).unwrap();
        let original = catalog.live_notes().unwrap().remove(0);

        fs::remove_file(dir.path().join("A.md")).unwrap();
        fs::write(dir.path().join("Moved.md"), "# A\n\nchanged\n").unwrap();
        reconcile_vault(dir.path(), &mut catalog, &[]).unwrap();
        let live = catalog.live_notes().unwrap();
        let rows = catalog.all_rows().unwrap();

        assert_eq!(live.len(), 1);
        assert_ne!(live[0].note_id, original.note_id);
        assert!(
            rows.iter()
                .any(|row| row.meta.note_id == original.note_id && row.tombstoned)
        );
    }

    #[test]
    fn invalid_utf8_file_is_unresolved_and_excluded_from_live_notes() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("Bad.md"), [0xff, 0xfe]).unwrap();
        let mut catalog = Catalog::open(&dir.path().join(".tansu").join("vault.db")).unwrap();

        reconcile_vault(dir.path(), &mut catalog, &[]).unwrap();

        assert!(catalog.live_notes().unwrap().is_empty());
        let rows = catalog.all_rows().unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].unresolved_reason.as_deref(), Some("invalid_utf8"));
    }

    #[test]
    fn interrupted_user_save_repairs_visible_file_from_latest_snapshot() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("A.md"), "# A\n\nold\n").unwrap();
        let mut catalog = Catalog::open(&dir.path().join(".tansu").join("vault.db")).unwrap();
        reconcile_vault(dir.path(), &mut catalog, &[]).unwrap();
        let note = catalog.live_notes().unwrap().remove(0);
        let accepted = "# A\n\nnew\n";
        let accepted_hash = history::write_snapshot(dir.path(), &note.note_id, accepted).unwrap();
        let parsed = parse_markdown(&note.path, accepted);
        catalog
            .update_note_content(
                &note.note_id,
                &parsed.title,
                &parsed.tags,
                &accepted_hash,
                NoteEventKind::Save,
                NoteEventSource::User,
            )
            .unwrap();

        reconcile_vault(dir.path(), &mut catalog, &[]).unwrap();

        let visible = fs::read_to_string(dir.path().join("A.md")).unwrap();
        assert_eq!(visible, history::canonical_markdown_string(accepted));
        let row = catalog.note_row_by_id(&note.note_id).unwrap().unwrap();
        assert_eq!(row.meta.content_hash, accepted_hash);
        assert_eq!(row.visible_hash, accepted_hash);
    }

    #[test]
    fn external_edit_after_accepted_save_is_preserved_when_visible_hash_changed() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("A.md"), "# A\n\nold\n").unwrap();
        let mut catalog = Catalog::open(&dir.path().join(".tansu").join("vault.db")).unwrap();
        reconcile_vault(dir.path(), &mut catalog, &[]).unwrap();
        let note = catalog.live_notes().unwrap().remove(0);
        let accepted = "# A\n\nnew\n";
        let accepted_hash = history::write_snapshot(dir.path(), &note.note_id, accepted).unwrap();
        let parsed = parse_markdown(&note.path, accepted);
        catalog
            .update_note_content(
                &note.note_id,
                &parsed.title,
                &parsed.tags,
                &accepted_hash,
                NoteEventKind::Save,
                NoteEventSource::User,
            )
            .unwrap();
        fs::write(dir.path().join("A.md"), "# A\n\nexternal\n").unwrap();

        reconcile_vault(dir.path(), &mut catalog, &[]).unwrap();

        let live = catalog.live_notes().unwrap().remove(0);
        assert_eq!(live.note_id, note.note_id);
        assert_eq!(
            live.content_hash,
            history::content_hash("# A\n\nexternal\n")
        );
        assert_eq!(
            fs::read_to_string(dir.path().join("A.md")).unwrap(),
            "# A\n\nexternal\n"
        );
    }
}
