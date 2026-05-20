use std::fs;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::thread;

use crate::api::{api_error_response, handle_api};
use crate::app::App;
use crate::{Error, Result};

const MAX_HEADER_BYTES: usize = 1024 * 1024;
const MAX_BODY_BYTES: usize = 32 * 1024 * 1024;

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

    pub fn bytes(status: u16, content_type: &str, body: Vec<u8>) -> Self {
        Self {
            status,
            content_type: content_type.to_string(),
            body,
        }
    }

    #[cfg(test)]
    pub(crate) fn status(&self) -> u16 {
        self.status
    }

    #[cfg(test)]
    pub(crate) fn content_type(&self) -> &str {
        &self.content_type
    }

    #[cfg(test)]
    pub(crate) fn body(&self) -> &[u8] {
        &self.body
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
            "HTTP/1.1 {} {}\r\nContent-Type: {}\r\nContent-Length: {}\r\nConnection: close\r\nX-Content-Type-Options: nosniff\r\nReferrer-Policy: no-referrer\r\nContent-Security-Policy: default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'\r\n\r\n",
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
        Ok(request) if request.path.starts_with("/events") => {
            if let Err(error) = app.handle_events(&request, &mut stream) {
                HttpResponse::text(500, &error.to_string()).write(&mut stream)?;
            }
            return Ok(());
        }
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
        if buffer.len() > MAX_HEADER_BYTES {
            return Err(Error::BadRequest("request headers too large".to_string()));
        }
    };

    let mut headers = [httparse::EMPTY_HEADER; 64];
    let mut parsed = httparse::Request::new(&mut headers);
    parsed
        .parse(&buffer[..header_end + 4])
        .map_err(|error| Error::BadRequest(error.to_string()))?;
    let method = parsed
        .method
        .ok_or_else(|| Error::BadRequest("missing method".to_string()))?
        .to_string();
    let path = parsed
        .path
        .ok_or_else(|| Error::BadRequest("missing path".to_string()))?
        .to_string();
    validate_percent_encoding(&path)?;
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
    if content_length > MAX_BODY_BYTES {
        return Err(Error::BadRequest("request body too large".to_string()));
    }
    let body_start = header_end + 4;
    while buffer.len() < body_start + content_length {
        let read = stream.read(&mut temp)?;
        if read == 0 {
            return Err(Error::BadRequest("incomplete request body".to_string()));
        }
        buffer.extend_from_slice(&temp[..read]);
    }
    let body = buffer[body_start..body_start + content_length].to_vec();
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

fn validate_percent_encoding(path: &str) -> Result<()> {
    let bytes = path.as_bytes();
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' {
            if index + 2 >= bytes.len()
                || !bytes[index + 1].is_ascii_hexdigit()
                || !bytes[index + 2].is_ascii_hexdigit()
            {
                return Err(Error::BadRequest("invalid percent encoding".to_string()));
            }
            index += 3;
        } else {
            index += 1;
        }
    }
    Ok(())
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};

    #[test]
    fn parses_request_headers_body_and_percent_encoding() {
        let request = parse_raw_request(
            b"POST /api/notes/n%201 HTTP/1.1\r\nHost: localhost\r\nContent-Length: 7\r\nX-Tansu-Vault: 2\r\n\r\npayload",
        )
        .unwrap();

        assert_eq!(request.method, "POST");
        assert_eq!(request.path, "/api/notes/n%201");
        assert_eq!(request.body, b"payload");
        assert!(
            request.headers.iter().any(|(name, value)| {
                name.eq_ignore_ascii_case("x-tansu-vault") && value == "2"
            })
        );
    }

    #[test]
    fn rejects_invalid_percent_encoding_and_large_bodies() {
        let invalid = parse_raw_request(b"GET /api/search?q=%xx HTTP/1.1\r\nHost: local\r\n\r\n")
            .unwrap_err();
        assert!(invalid.to_string().contains("invalid percent encoding"));

        let large =
            parse_raw_request(b"POST /api/notes HTTP/1.1\r\nContent-Length: 33554433\r\n\r\n")
                .unwrap_err();
        assert!(large.to_string().contains("request body too large"));
    }

    #[test]
    fn serves_static_files_with_mime_types_and_rejects_traversal() {
        let html = serve_static("/").unwrap();
        assert_eq!(html.status(), 200);
        assert_eq!(html.content_type(), "text/html; charset=utf-8");
        assert!(!html.body().is_empty());

        let css = serve_static("/static/app.css?cache=1").unwrap();
        assert_eq!(css.content_type(), "text/css; charset=utf-8");

        let missing = serve_static("/../Cargo.toml").unwrap_err();
        assert!(matches!(missing, Error::NotFound(_)));
    }

    #[test]
    fn writes_security_headers_and_reason_phrase() {
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let address = listener.local_addr().unwrap();
        let handle = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            HttpResponse::text(409, "conflict")
                .write(&mut stream)
                .unwrap();
        });
        let mut client = TcpStream::connect(address).unwrap();
        let mut response = String::new();
        client.read_to_string(&mut response).unwrap();
        handle.join().unwrap();

        assert!(response.starts_with("HTTP/1.1 409 Conflict"));
        assert!(response.contains("X-Content-Type-Options: nosniff"));
        assert!(response.contains("Content-Security-Policy: default-src 'self'"));
        assert!(response.ends_with("conflict"));
    }

    fn parse_raw_request(bytes: &[u8]) -> Result<HttpRequest> {
        let listener = TcpListener::bind(("127.0.0.1", 0))?;
        let address = listener.local_addr()?;
        let bytes = bytes.to_vec();
        let handle = thread::spawn(move || {
            let mut client = TcpStream::connect(address).unwrap();
            client.write_all(&bytes).unwrap();
        });
        let (mut server, _) = listener.accept()?;
        let request = parse_request(&mut server);
        handle.join().unwrap();
        request
    }
}
