use crate::api_types::{
    ApiErrorKind, ApiErrorResponse, CreateNoteRequest, RenameNoteRequest, SaveNoteRequest,
    SessionState, Settings,
};
use crate::app::App;
use crate::http::{HttpRequest, HttpResponse};
use crate::{Error, Result};

pub fn handle_api(app: &App, request: &HttpRequest) -> Result<HttpResponse> {
    let vault_index = request
        .headers
        .iter()
        .find(|(name, _)| name.eq_ignore_ascii_case("x-tansu-vault"))
        .and_then(|(_, value)| value.parse::<usize>().ok())
        .unwrap_or(0);
    let vault = app.vault(vault_index)?;
    let path = request.path.as_str();
    match (request.method.as_str(), path) {
        ("GET", "/api/health") => json(200, &serde_json::json!({ "ok": true })),
        ("GET", "/api/bootstrap") => json(200, &vault.bootstrap(app.vault_entries(), vault_index)?),
        ("PUT", "/api/session") => {
            let body: SessionState = serde_json::from_slice(&request.body)?;
            vault.save_session(body)?;
            json(200, &serde_json::json!({ "ok": true }))
        }
        ("GET", "/api/settings") => json(200, &vault.settings()?),
        ("PUT", "/api/settings") => {
            let body: Settings = serde_json::from_slice(&request.body)?;
            json(200, &vault.save_settings(body)?)
        }
        ("GET", _) if path.starts_with("/api/search") => {
            let query = query_param(path, "q").unwrap_or_default();
            json(200, &vault.search(&query)?)
        }
        ("POST", "/api/notes") => {
            let body: CreateNoteRequest = serde_json::from_slice(&request.body)?;
            json(201, &vault.create_note(body)?)
        }
        _ => handle_note_route(&vault, request),
    }
}

fn handle_note_route(
    vault: &crate::vault::VaultRuntime,
    request: &HttpRequest,
) -> Result<HttpResponse> {
    let Some(rest) = request.path.strip_prefix("/api/notes/") else {
        return Err(Error::NotFound(request.path.clone()));
    };
    let parts = rest.split('/').collect::<Vec<_>>();
    match (request.method.as_str(), parts.as_slice()) {
        ("GET", [note_id]) => json(200, &vault.open_note(note_id)?),
        ("PUT", [note_id]) => {
            let body: SaveNoteRequest = serde_json::from_slice(&request.body)?;
            json(200, &vault.save_note(note_id, body)?)
        }
        ("POST", [note_id, "rename"]) => {
            let body: RenameNoteRequest = serde_json::from_slice(&request.body)?;
            json(200, &vault.rename_note(note_id, body)?)
        }
        ("DELETE", [note_id]) => json(200, &vault.delete_note(note_id)?),
        ("POST", [note_id, "pin"]) => {
            vault.set_pin(note_id, true)?;
            json(200, &serde_json::json!({ "ok": true }))
        }
        ("DELETE", [note_id, "pin"]) => {
            vault.set_pin(note_id, false)?;
            json(200, &serde_json::json!({ "ok": true }))
        }
        _ => Err(Error::NotFound(request.path.clone())),
    }
}

pub fn api_error_response(error: Error) -> HttpResponse {
    match error {
        Error::Api(error) => {
            HttpResponse::json(api_error_status(&error), &ApiErrorResponse { error })
                .unwrap_or_else(internal_error)
        }
        Error::NotFound(note_id) => HttpResponse::json(
            404,
            &ApiErrorResponse {
                error: ApiErrorKind::NoteNotFound { note_id },
            },
        )
        .unwrap_or_else(internal_error),
        Error::BadRequest(message) => HttpResponse::json(
            400,
            &ApiErrorResponse {
                error: ApiErrorKind::BadRequest { message },
            },
        )
        .unwrap_or_else(internal_error),
        Error::Json(error) => HttpResponse::json(
            400,
            &ApiErrorResponse {
                error: ApiErrorKind::BadRequest {
                    message: error.to_string(),
                },
            },
        )
        .unwrap_or_else(internal_error),
        other => HttpResponse::json(
            500,
            &ApiErrorResponse {
                error: ApiErrorKind::Internal {
                    message: other.to_string(),
                },
            },
        )
        .unwrap_or_else(internal_error),
    }
}

fn api_error_status(error: &ApiErrorKind) -> u16 {
    match error {
        ApiErrorKind::PathInvalid { .. } | ApiErrorKind::BadRequest { .. } => 400,
        ApiErrorKind::NoteNotFound { .. } => 404,
        ApiErrorKind::PathCollision { .. }
        | ApiErrorKind::SaveConflict { .. }
        | ApiErrorKind::UnresolvedNote { .. } => 409,
        ApiErrorKind::Internal { .. } => 500,
    }
}

fn internal_error(error: serde_json::Error) -> HttpResponse {
    HttpResponse::text(500, &format!("internal serialization error: {error}"))
}

fn json<T: serde::Serialize>(status: u16, value: &T) -> Result<HttpResponse> {
    Ok(HttpResponse::json(status, value)?)
}

fn query_param(path: &str, key: &str) -> Option<String> {
    let query = path.split_once('?')?.1;
    for pair in query.split('&') {
        let (name, value) = pair.split_once('=').unwrap_or((pair, ""));
        if name == key {
            return Some(percent_decode(value));
        }
    }
    None
}

fn percent_decode(value: &str) -> String {
    let mut out = String::new();
    let mut chars = value.as_bytes().iter().copied();
    while let Some(byte) = chars.next() {
        if byte == b'%' {
            let hi = chars.next();
            let lo = chars.next();
            if let (Some(hi), Some(lo)) = (hi, lo) {
                if let Ok(hex) = std::str::from_utf8(&[hi, lo]) {
                    if let Ok(decoded) = u8::from_str_radix(hex, 16) {
                        out.push(decoded as char);
                        continue;
                    }
                }
            }
        }
        out.push(if byte == b'+' { ' ' } else { byte as char });
    }
    out
}
