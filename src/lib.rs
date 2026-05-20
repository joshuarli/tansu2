pub mod api;
pub mod api_types;
pub mod app;
pub mod catalog;
pub mod config;
pub mod history;
pub mod http;
pub mod paths;
pub mod reconcile;
pub mod search;
pub mod tags;
pub mod vault;

use crate::api_types::ApiErrorKind;

pub type Result<T> = std::result::Result<T, Error>;

#[derive(Debug)]
pub enum Error {
    Api(ApiErrorKind),
    BadRequest(String),
    Io(std::io::Error),
    Json(serde_json::Error),
    Sql(rusqlite::Error),
    Toml(toml::de::Error),
    NotFound(String),
    Internal(String),
}

impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Api(error) => write!(f, "{error:?}"),
            Self::BadRequest(message) | Self::NotFound(message) | Self::Internal(message) => {
                f.write_str(message)
            }
            Self::Io(error) => write!(f, "{error}"),
            Self::Json(error) => write!(f, "{error}"),
            Self::Sql(error) => write!(f, "{error}"),
            Self::Toml(error) => write!(f, "{error}"),
        }
    }
}

impl std::error::Error for Error {}

impl From<std::io::Error> for Error {
    fn from(value: std::io::Error) -> Self {
        Self::Io(value)
    }
}

impl From<serde_json::Error> for Error {
    fn from(value: serde_json::Error) -> Self {
        Self::Json(value)
    }
}

impl From<rusqlite::Error> for Error {
    fn from(value: rusqlite::Error) -> Self {
        Self::Sql(value)
    }
}

impl From<toml::de::Error> for Error {
    fn from(value: toml::de::Error) -> Self {
        Self::Toml(value)
    }
}
