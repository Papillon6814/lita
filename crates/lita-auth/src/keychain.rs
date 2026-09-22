//! Where the session lives between launches: the OS keychain, as one JSON
//! blob. Never a file in the app directory, so a backup or a copied profile
//! folder does not leak a refresh token.

use anyhow::{Context, Result};
use keyring::Entry;

use crate::Session;

pub struct SessionStore {
    service: String,
    account: String,
}

impl SessionStore {
    /// `service` should be the app's bundle identifier so the entry is
    /// recognisably Lita's in Keychain Access and its peers.
    pub fn new(service: impl Into<String>) -> Self {
        Self { service: service.into(), account: "session".into() }
    }

    fn entry(&self) -> Result<Entry> {
        Entry::new(&self.service, &self.account).context("opening the keychain entry")
    }

    pub fn load(&self) -> Result<Option<Session>> {
        match self.entry()?.get_password() {
            Ok(json) => Ok(Some(serde_json::from_str(&json).context("the stored session is unreadable")?)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(e).context("reading the session from the keychain"),
        }
    }

    pub fn save(&self, session: &Session) -> Result<()> {
        self.entry()?
            .set_password(&serde_json::to_string(session)?)
            .context("writing the session to the keychain")
    }

    pub fn clear(&self) -> Result<()> {
        match self.entry()?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(e).context("removing the session from the keychain"),
        }
    }
}
