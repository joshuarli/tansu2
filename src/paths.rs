use std::path::{Component, Path, PathBuf};

use crate::api_types::PathValidationReason;

pub fn normalize_note_path(input: &str) -> std::result::Result<String, PathValidationReason> {
    let trimmed = input.trim().replace('\\', "/");
    if trimmed.is_empty() {
        return Err(PathValidationReason::Empty);
    }
    let path = Path::new(&trimmed);
    if path.is_absolute() {
        return Err(PathValidationReason::Absolute);
    }
    let mut parts = Vec::new();
    for component in path.components() {
        match component {
            Component::Normal(value) => {
                let text = value.to_string_lossy();
                if text == ".tansu" {
                    return Err(PathValidationReason::DotTansu);
                }
                if !text.is_empty() {
                    parts.push(text.to_string());
                }
            }
            Component::ParentDir => return Err(PathValidationReason::Traversal),
            Component::CurDir => {}
            _ => return Err(PathValidationReason::Absolute),
        }
    }
    if parts.is_empty() {
        return Err(PathValidationReason::Empty);
    }
    let normalized = parts.join("/");
    if !normalized.to_ascii_lowercase().ends_with(".md") {
        return Err(PathValidationReason::NotMarkdown);
    }
    Ok(normalized)
}

pub fn path_key(path: &str) -> String {
    path.replace('\\', "/").to_lowercase()
}

pub fn visible_path(root: &Path, note_path: &str) -> PathBuf {
    let mut out = root.to_path_buf();
    for part in note_path.split('/') {
        out.push(part);
    }
    out
}

pub fn title_from_path(path: &str) -> String {
    Path::new(path)
        .file_stem()
        .and_then(|value| value.to_str())
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("Untitled")
        .trim()
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_path_traversal() {
        assert_eq!(
            normalize_note_path("../x.md").unwrap_err(),
            PathValidationReason::Traversal
        );
        assert_eq!(
            normalize_note_path(".tansu/x.md").unwrap_err(),
            PathValidationReason::DotTansu
        );
    }

    #[test]
    fn normalizes_separators_and_case_key() {
        assert_eq!(
            normalize_note_path("Notes\\One.md").unwrap(),
            "Notes/One.md"
        );
        assert_eq!(path_key("Notes/One.md"), "notes/one.md");
    }
}
