use std::sync::Arc;

use std::io::Write;
use std::net::TcpStream;

use crate::api_types::VaultEntry;
use crate::config::Config;
use crate::http::HttpRequest;
use crate::vault::VaultRuntime;
use crate::{Error, Result};

#[derive(Clone)]
pub struct App {
    vaults: Arc<Vec<Arc<VaultRuntime>>>,
}

impl App {
    pub fn new(config: Config) -> Result<Self> {
        let mut runtimes = Vec::new();
        for (index, vault) in config.vaults.iter().enumerate() {
            runtimes.push(Arc::new(VaultRuntime::open(index, vault)?));
        }
        let app = Self {
            vaults: Arc::new(runtimes),
        };
        for vault in app.vaults.iter() {
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
        write!(
            stream,
            "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nCache-Control: no-cache\r\nConnection: close\r\nX-Accel-Buffering: no\r\n\r\n"
        )?;
        for event in rx {
            let json = serde_json::to_string(&event)?;
            stream.write_all(format!("event: message\ndata: {json}\n\n").as_bytes())?;
            stream.flush()?;
        }
        Ok(())
    }
}
