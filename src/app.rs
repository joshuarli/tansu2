use std::sync::Arc;

use std::io::Write;
use std::net::TcpStream;

use crate::api_types::VaultEntry;
use crate::config::Config;
use crate::http::HttpRequest;
use crate::logging::{LogHub, LogLevel, fields};
use crate::vault::VaultRuntime;
use crate::{Error, Result};

#[derive(Clone)]
pub struct App {
    vaults: Arc<Vec<Arc<VaultRuntime>>>,
    logs: LogHub,
}

impl App {
    pub fn new(config: Config) -> Result<Self> {
        let logs = LogHub::from_env();
        let mut runtimes = Vec::new();
        for (index, vault) in config.vaults.iter().enumerate() {
            runtimes.push(Arc::new(VaultRuntime::open(index, vault, logs.clone())?));
        }
        let app = Self {
            vaults: Arc::new(runtimes),
            logs,
        };
        if app.logs.enabled() {
            app.logs.server_event(
                LogLevel::Info,
                "system.event",
                None,
                fields([
                    (
                        "system",
                        serde_json::json!({ "component": "startup", "action": "app_open" }),
                    ),
                    ("vaultCount", serde_json::json!(app.vaults.len())),
                ]),
            );
        }
        for vault in app.vaults.iter() {
            vault.start_search_worker();
            vault.start_watcher()?;
        }
        Ok(app)
    }

    pub fn vault(&self, index: usize) -> Result<Arc<VaultRuntime>> {
        self.vaults
            .get(index)
            .cloned()
            .ok_or_else(|| Error::BadRequest(format!("unknown vault index {index}")))
    }

    pub fn vault_entries(&self) -> Vec<VaultEntry> {
        self.vaults
            .iter()
            .map(|vault| VaultEntry {
                index: vault.index,
                name: vault.name.clone(),
            })
            .collect()
    }

    pub fn logs(&self) -> &LogHub {
        &self.logs
    }

    pub fn handle_events(&self, request: &HttpRequest, stream: &mut TcpStream) -> Result<()> {
        let vault_index = request
            .path
            .split_once('?')
            .and_then(|(_, query)| {
                query
                    .split('&')
                    .find_map(|pair| pair.split_once("vault=")?.1.parse().ok())
            })
            .unwrap_or(0);
        let vault = self.vault(vault_index)?;
        let rx = vault.subscribe()?;
        if self.logs.enabled() {
            self.logs.server_event(
                LogLevel::Info,
                "system.event",
                None,
                fields([
                    (
                        "system",
                        serde_json::json!({ "component": "sse", "action": "connect" }),
                    ),
                    ("vault", serde_json::json!(vault_index)),
                ]),
            );
        }
        write!(
            stream,
            "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nCache-Control: no-cache\r\nConnection: keep-alive\r\nX-Accel-Buffering: no\r\nX-Content-Type-Options: nosniff\r\nReferrer-Policy: no-referrer\r\n\r\nretry: 2000\n\n"
        )?;
        for event in rx {
            let json = serde_json::to_string(&event)?;
            stream.write_all(format!("event: message\ndata: {json}\n\n").as_bytes())?;
            stream.flush()?;
        }
        if self.logs.enabled() {
            self.logs.server_event(
                LogLevel::Info,
                "system.event",
                None,
                fields([
                    (
                        "system",
                        serde_json::json!({ "component": "sse", "action": "disconnect" }),
                    ),
                    ("vault", serde_json::json!(vault_index)),
                ]),
            );
        }
        Ok(())
    }

    pub fn handle_log_stream(&self, stream: &mut TcpStream) -> Result<()> {
        let Some(rx) = self.logs.subscribe() else {
            return Err(Error::NotFound("dev logs".to_string()));
        };
        write!(
            stream,
            "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nCache-Control: no-cache\r\nConnection: keep-alive\r\nX-Accel-Buffering: no\r\nX-Content-Type-Options: nosniff\r\nReferrer-Policy: no-referrer\r\n\r\nretry: 2000\n\n"
        )?;
        for event in rx {
            let json = serde_json::to_string(&event)?;
            stream.write_all(format!("event: message\ndata: {json}\n\n").as_bytes())?;
            stream.flush()?;
        }
        Ok(())
    }
}
