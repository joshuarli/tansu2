use std::fs;
use std::io::{ErrorKind, Write};
use std::path::{Path, PathBuf};

use lz4_flex::{compress_prepend_size, decompress_size_prepended};
use sha2::{Digest, Sha256};

use crate::{Error, Result};

pub fn canonical_markdown_bytes(content: &str) -> Vec<u8> {
    let normalized = content.replace("\r\n", "\n").replace('\r', "\n");
    normalized.replace('\n', "\r\n").into_bytes()
}

pub fn canonical_markdown_string(content: &str) -> String {
    String::from_utf8(canonical_markdown_bytes(content)).expect("canonical markdown is UTF-8")
}

pub fn validate_and_canonicalize(bytes: &[u8]) -> Result<String> {
    let content = std::str::from_utf8(bytes)
        .map_err(|_| Error::BadRequest("markdown must be valid UTF-8".to_string()))?;
    Ok(canonical_markdown_string(content))
}

pub fn content_hash(content: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(canonical_markdown_bytes(content));
    format!("sha256:{:x}", hasher.finalize())
}

pub fn write_snapshot(root: &Path, note_id: &str, content: &str) -> Result<String> {
    let hash = content_hash(content);
    let dir = root
        .join(".tansu")
        .join("history")
        .join("snapshots")
        .join(note_id);
    fs::create_dir_all(&dir)?;
    let path = dir.join(hash_filename(&hash));
    write_compressed_atomic(&path, &canonical_markdown_bytes(content))?;
    Ok(hash)
}

pub fn read_snapshot(root: &Path, note_id: &str, hash: &str) -> Result<String> {
    let path = root
        .join(".tansu")
        .join("history")
        .join("snapshots")
        .join(note_id)
        .join(hash_filename(hash));
    let compressed = fs::read(&path).map_err(|error| {
        if error.kind() == ErrorKind::NotFound {
            Error::NotFound(format!("missing snapshot {hash}"))
        } else {
            Error::Io(error)
        }
    })?;
    let bytes = decompress_size_prepended(&compressed)
        .map_err(|_| Error::Internal(format!("corrupt snapshot {hash}")))?;
    let content = validate_and_canonicalize(&bytes)?;
    let actual = content_hash(&content);
    if actual != hash {
        return Err(Error::Internal(format!(
            "snapshot hash mismatch for {hash}"
        )));
    }
    Ok(content)
}

pub fn write_conflict_draft(
    root: &Path,
    note_id: &str,
    draft_id: i64,
    content: &str,
) -> Result<String> {
    let hash = content_hash(content);
    let dir = root
        .join(".tansu")
        .join("history")
        .join("conflicts")
        .join(note_id);
    fs::create_dir_all(&dir)?;
    let path = dir.join(format!("{draft_id}.lz4"));
    write_compressed_atomic(&path, &canonical_markdown_bytes(content))?;
    Ok(hash)
}

pub fn read_conflict_draft(
    root: &Path,
    note_id: &str,
    draft_id: i64,
    expected_hash: &str,
) -> Result<String> {
    let path = root
        .join(".tansu")
        .join("history")
        .join("conflicts")
        .join(note_id)
        .join(format!("{draft_id}.lz4"));
    let compressed = fs::read(path)?;
    let bytes = decompress_size_prepended(&compressed)
        .map_err(|_| Error::Internal("corrupt conflict draft".to_string()))?;
    let content = validate_and_canonicalize(&bytes)?;
    let actual = content_hash(&content);
    if actual != expected_hash {
        return Err(Error::Internal("conflict draft hash mismatch".to_string()));
    }
    Ok(content)
}

pub fn write_visible_atomic(path: &Path, content: &str) -> Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    write_atomic(path, &canonical_markdown_bytes(content))
}

fn write_compressed_atomic(path: &Path, bytes: &[u8]) -> Result<()> {
    write_atomic(path, &compress_prepend_size(bytes))
}

fn write_atomic(path: &Path, bytes: &[u8]) -> Result<()> {
    let tmp = temp_path(path);
    if let Some(parent) = tmp.parent() {
        fs::create_dir_all(parent)?;
    }
    let result = (|| {
        let mut file = fs::File::create(&tmp)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        fs::rename(&tmp, path)?;
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    result
}

fn temp_path(path: &Path) -> PathBuf {
    let mut tmp = path.to_path_buf();
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| format!("{value}.tmp"))
        .unwrap_or_else(|| "tmp".to_string());
    tmp.set_extension(extension);
    tmp
}

fn hash_filename(hash: &str) -> String {
    format!("{}.lz4", hash.replace(':', "_"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lf_and_mixed_line_endings_hash_the_same() {
        assert_eq!(
            content_hash("a\nb\r\nc\rd"),
            content_hash("a\r\nb\r\nc\r\nd")
        );
    }

    #[test]
    fn snapshot_round_trip_verifies_hash() {
        let dir = tempfile::tempdir().unwrap();
        let hash = write_snapshot(dir.path(), "note", "hello\n").unwrap();
        let content = read_snapshot(dir.path(), "note", &hash).unwrap();
        assert_eq!(content, "hello\r\n");
    }
}
