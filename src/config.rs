use std::fs;
use std::path::{Path, PathBuf};

use serde::Deserialize;

use crate::api_types::PathValidationReason;
use crate::{Error, Result};

#[derive(Debug, Clone)]
pub struct Config {
    pub vaults: Vec<VaultConfig>,
}

#[derive(Debug, Clone)]
pub struct VaultConfig {
    pub name: String,
    pub path: PathBuf,
    pub excluded_folders: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct RawConfig {
    vaults: Vec<RawVault>,
}

#[derive(Debug, Deserialize)]
struct RawVault {
    name: String,
    path: String,
    #[serde(default)]
    excluded_folders: Vec<String>,
}

pub fn default_config_path() -> Result<PathBuf> {
    let base = match std::env::var_os("XDG_CONFIG_HOME") {
        Some(value) => PathBuf::from(value),
        None => {
            let home = std::env::var_os("HOME")
                .ok_or_else(|| Error::BadRequest("HOME is not set".to_string()))?;
            PathBuf::from(home).join(".config")
        }
    };
    Ok(base.join("tansu").join("config.toml"))
}

pub fn load_config() -> Result<Config> {
    load_config_from_path(&default_config_path()?)
}

pub fn load_config_from_path(path: &Path) -> Result<Config> {
    let text = fs::read_to_string(path).map_err(|error| {
        if error.kind() == std::io::ErrorKind::NotFound {
            Error::BadRequest(format!("missing config: {}", path.display()))
        } else {
            Error::Io(error)
        }
    })?;
    parse_config(&text)
}

pub fn parse_config(text: &str) -> Result<Config> {
    let raw: RawConfig = toml::from_str(text)?;
    if raw.vaults.is_empty() {
        return Err(Error::BadRequest(
            "config must contain at least one vault".to_string(),
        ));
    }
    let vaults = raw
        .vaults
        .into_iter()
        .map(|vault| {
            let path = expand_tilde(&vault.path)?;
            Ok(VaultConfig {
                name: vault.name,
                path,
                excluded_folders: vault.excluded_folders,
            })
        })
        .collect::<Result<Vec<_>>>()?;
    validate_vaults(&vaults)?;
    Ok(Config { vaults })
}

fn expand_tilde(path: &str) -> Result<PathBuf> {
    if path == "~" || path.starts_with("~/") {
        let home = std::env::var_os("HOME")
            .ok_or_else(|| Error::BadRequest("HOME is not set".to_string()))?;
        let suffix = path.strip_prefix("~/").unwrap_or("");
        return Ok(PathBuf::from(home).join(suffix));
    }
    Ok(PathBuf::from(path))
}

fn validate_vaults(vaults: &[VaultConfig]) -> Result<()> {
    for (index, vault) in vaults.iter().enumerate() {
        for other in vaults.iter().skip(index + 1) {
            if is_nested(&vault.path, &other.path) || is_nested(&other.path, &vault.path) {
                return Err(Error::BadRequest(format!(
                    "nested vaults are not allowed: {} and {} ({:?})",
                    vault.path.display(),
                    other.path.display(),
                    PathValidationReason::NestedVault
                )));
            }
        }
    }
    Ok(())
}

fn is_nested(child: &Path, parent: &Path) -> bool {
    let child = normalize_for_compare(child);
    let parent = normalize_for_compare(parent);
    child != parent && child.starts_with(parent)
}

fn normalize_for_compare(path: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for component in path.components() {
        match component {
            std::path::Component::CurDir => {}
            std::path::Component::ParentDir => {
                out.pop();
            }
            other => out.push(other.as_os_str()),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_config_and_expands_tilde() {
        let config = parse_config("[[vaults]]\nname='Main'\npath='~/notes'\n").unwrap();
        assert_eq!(config.vaults[0].name, "Main");
        assert!(config.vaults[0].path.ends_with("notes"));
    }

    #[test]
    fn rejects_nested_vaults() {
        let error = parse_config(
            "[[vaults]]\nname='A'\npath='/tmp/a'\n[[vaults]]\nname='B'\npath='/tmp/a/b'\n",
        )
        .unwrap_err();
        assert!(error.to_string().contains("nested vaults"));
    }

    #[test]
    fn parses_excluded_folders_and_rejects_empty_vault_list() {
        let config = parse_config(
            "[[vaults]]\nname='Main'\npath='/tmp/notes'\nexcluded_folders=['tmp','.cache']\n",
        )
        .unwrap();
        assert_eq!(config.vaults[0].excluded_folders, vec!["tmp", ".cache"]);

        let error = parse_config("vaults=[]").unwrap_err();
        assert!(error.to_string().contains("at least one vault"));
    }

    #[test]
    fn load_config_reports_missing_files_and_keeps_sibling_vaults() {
        let root = tempfile::tempdir().unwrap();
        let missing = load_config_from_path(&root.path().join("missing.toml")).unwrap_err();
        assert!(missing.to_string().contains("missing config"));

        let config = parse_config(
            "[[vaults]]\nname='A'\npath='/tmp/a/../a-one'\n[[vaults]]\nname='B'\npath='/tmp/a-two'\n",
        )
        .unwrap();
        assert_eq!(config.vaults.len(), 2);
    }
}
