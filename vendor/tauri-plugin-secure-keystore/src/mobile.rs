use serde::de::DeserializeOwned;
use tauri::{
    plugin::{PluginApi, PluginHandle},
    AppHandle, Runtime,
};

use crate::models::*;

const PLUGIN_IDENTIFIER: &str = "com.beavernotes.secure.keystore";

// This plugin is Android-only. iOS uses the `keyring` crate (wired up in
// Task 10's master_key.rs), so there is deliberately no
// `tauri::ios_plugin_binding!` / Swift `init_plugin_secure_keystore` symbol.
// This module is gated on `target_os = "android"` in lib.rs, so on iOS the
// plugin registers as a no-op and simply is never invoked.

pub fn init<R: Runtime, C: DeserializeOwned>(
    _app: &AppHandle<R>,
    api: PluginApi<R, C>,
) -> crate::Result<SecureKeystore<R>> {
    let handle = api.register_android_plugin(PLUGIN_IDENTIFIER, "SecureKeystorePlugin")?;
    Ok(SecureKeystore(handle))
}

pub struct SecureKeystore<R: Runtime>(PluginHandle<R>);

impl<R: Runtime> SecureKeystore<R> {
    pub fn wrap(&self, data_b64: String) -> crate::Result<String> {
        self.0
            .run_mobile_plugin("wrap", WrapRequest { data: data_b64 })
            .map(|r: WrapResponse| r.blob)
            .map_err(Into::into)
    }

    pub fn unwrap(&self, blob: String) -> crate::Result<String> {
        self.0
            .run_mobile_plugin("unwrap", UnwrapRequest { blob })
            .map(|r: UnwrapResponse| r.data)
            .map_err(Into::into)
    }

    pub fn has_key(&self) -> crate::Result<bool> {
        self.0
            .run_mobile_plugin("hasKey", ())
            .map(|r: HasKeyResponse| r.has_key)
            .map_err(Into::into)
    }

    pub fn delete_key(&self) -> crate::Result<()> {
        self.0.run_mobile_plugin("deleteKey", ()).map_err(Into::into)
    }
}
