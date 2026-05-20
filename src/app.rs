use std::sync::Arc;

use crate::api_types::VaultEntry;
use crate::config::Config;
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
        Ok(Self {
            vaults: Arc::new(runtimes),
        })
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
}
