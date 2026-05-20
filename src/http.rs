use std::fs;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::thread;

use crate::api::{api_error_response, handle_api};
use crate::app::App;
use crate::{Error, Result};

#[derive(Debug)]
pub struct HttpRequest {
    pub method: String,
    pub path: String,
    pub headers: Vec<(String, String)>,
    pub body: Vec<u8>,
}

#[derive(Debug)]
pub struct HttpResponse {
    status: u16,
    content_type: String,
    body: Vec<u8>,
}

impl HttpResponse {
    pub fn json<T: serde::Serialize>(
        status: u16,
        value: &T,
    ) -> std::result::Result<Self, serde_json::Error> {
        Ok(Self {
            status,
            content_type: "application/json; charset=utf-8".to_string(),
            body: serde_json::to_vec(value)?,
        })
    }

    pub fn text(status: u16, text: &str) -> Self {
        Self {
            status,
            content_type: "text/plain; charset=utf-8".to_string(),
            body: text.as_bytes().to_vec(),
        }
    }

    fn bytes(status: u16, content_type: &str, body: Vec<u8>) -> Self {
        Self {
            status,
            content_type: content_type.to_string(),
            body,
        }
    }

    fn write(self, stream: &mut TcpStream) -> std::io::Result<()> {
        let reason = match self.status {
            200 => "OK",
            201 => "Created",
            400 => "Bad Request",
            404 => "Not Found",
            409 => "Conflict",
            500 => "Internal Server Error",
            _ => "OK",
        };
        write!(
            stream,
            "HTTP/1.1 {} {}\r\nContent-Type: {}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            self.status,
            reason,
            self.content_type,
            self.body.len()
        )?;
        stream.write_all(&self.body)
    }
}

pub fn serve(app: App, port: u16) -> Result<()> {
    let listener = TcpListener::bind(("127.0.0.1", port))?;
    serve_listener(app, listener)
}

pub fn serve_listener(app: App, listener: TcpListener) -> Result<()> {
    for stream in listener.incoming() {
        let app = app.clone();
        match stream {
            Ok(stream) => {
                thread::spawn(move || {
                    let _ = handle_stream(app, stream);
                });
            }
            Err(error) => return Err(Error::Io(error)),
        }
    }
    Ok(())
}

fn handle_stream(app: App, mut stream: TcpStream) -> Result<()> {
    let response = match parse_request(&mut stream) {
        Ok(request) => route(&app, &request),
        Err(error) => HttpResponse::text(400, &error.to_string()),
    };
    response.write(&mut stream)?;
    Ok(())
}

fn route(app: &App, request: &HttpRequest) -> HttpResponse {
    if request.path.starts_with("/api/") {
        return handle_api(app, request).unwrap_or_else(api_error_response);
    }
    serve_static(&request.path).unwrap_or_else(|error| {
        if matches!(error, Error::NotFound(_)) {
            HttpResponse::text(404, "not found")
        } else {
            HttpResponse::text(500, &error.to_string())
        }
    })
}

fn parse_request(stream: &mut TcpStream) -> Result<HttpRequest> {
    let mut buffer = Vec::new();
    let mut temp = [0_u8; 8192];
    let header_end = loop {
        let read = stream.read(&mut temp)?;
        if read == 0 {
            return Err(Error::BadRequest("empty request".to_string()));
        }
        buffer.extend_from_slice(&temp[..read]);
        if let Some(index) = find_header_end(&buffer) {
            break index;
        }
        if buffer.len() > 1024 * 1024 {
            return Err(Error::BadRequest("request headers too large".to_string()));
        }
    };

    let mut headers = [httparse::EMPTY_HEADER; 64];
    let mut parsed = httparse::Request::new(&mut headers);
    parsed
        .parse(&buffer[..header_end])
        .map_err(|error| Error::BadRequest(error.to_string()))?;
    let method = parsed
        .method
        .ok_or_else(|| Error::BadRequest("missing method".to_string()))?
        .to_string();
    let path = parsed
        .path
        .ok_or_else(|| Error::BadRequest("missing path".to_string()))?
        .to_string();
    let headers = parsed
        .headers
        .iter()
        .map(|header| {
            (
                header.name.to_string(),
                String::from_utf8_lossy(header.value).to_string(),
            )
        })
        .collect::<Vec<_>>();
    let content_length = headers
        .iter()
        .find(|(name, _)| name.eq_ignore_ascii_case("content-length"))
        .and_then(|(_, value)| value.parse::<usize>().ok())
        .unwrap_or(0);
    let body_start = header_end + 4;
    while buffer.len() < body_start + content_length {
        let read = stream.read(&mut temp)?;
        if read == 0 {
            break;
        }
        buffer.extend_from_slice(&temp[..read]);
    }
    let body =
        buffer[body_start..body_start + content_length.min(buffer.len() - body_start)].to_vec();
    Ok(HttpRequest {
        method,
        path,
        headers,
        body,
    })
}

fn find_header_end(buffer: &[u8]) -> Option<usize> {
    buffer.windows(4).position(|window| window == b"\r\n\r\n")
}

fn serve_static(path: &str) -> Result<HttpResponse> {
    let relative = if path == "/" {
        PathBuf::from("index.html")
    } else {
        let without_query = path.split('?').next().unwrap_or(path);
        let trimmed = without_query.trim_start_matches('/');
        if trimmed.contains("..") {
            return Err(Error::NotFound(path.to_string()));
        }
        PathBuf::from(trimmed)
    };
    let full = Path::new("web").join(relative);
    let target = if full.is_dir() {
        full.join("index.html")
    } else {
        full
    };
    let body = fs::read(&target).map_err(|error| {
        if error.kind() == std::io::ErrorKind::NotFound {
            Error::NotFound(path.to_string())
        } else {
            Error::Io(error)
        }
    })?;
    let content_type = match target.extension().and_then(|value| value.to_str()) {
        Some("html") => "text/html; charset=utf-8",
        Some("css") => "text/css; charset=utf-8",
        Some("js") => "text/javascript; charset=utf-8",
        _ => "application/octet-stream",
    };
    Ok(HttpResponse::bytes(200, content_type, body))
}
