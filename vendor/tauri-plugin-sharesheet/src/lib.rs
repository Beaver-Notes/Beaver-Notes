#![cfg(mobile)]

use tauri::{
    plugin::{Builder, PluginHandle, TauriPlugin},
    Manager, Runtime,
};

pub use models::*;

mod error;
mod models;

pub use error::{Error, Result};

#[cfg(target_os = "android")]
const PLUGIN_IDENTIFIER: &str = "app.tauri.sharesheet";

#[cfg(target_os = "ios")]
tauri::ios_plugin_binding!(init_plugin_sharesheet);

/// Access to the sharesheet APIs.
pub struct Sharesheet<R: Runtime>(PluginHandle<R>);

impl<R: Runtime> Sharesheet<R> {
    pub fn share_text(&self, text: String, mime_type: Option<String>) -> crate::Result<()> {
        self.0
            .run_mobile_plugin("share_text", ShareTextPayload {
                text,
                options: SharesheetOptions { mime_type },
            })
            .map_err(Into::into)
    }

    pub fn share_file(&self, path: String, mime_type: Option<String>) -> crate::Result<()> {
        self.0
            .run_mobile_plugin("share_file", ShareFilePayload { path, mime_type })
            .map_err(Into::into)
    }
}

/// Extensions to [`tauri::App`], [`tauri::AppHandle`], [`tauri::WebviewWindow`], [`tauri::Webview`] and [`tauri::Window`] to access the sharesheet APIs.
pub trait SharesheetExt<R: Runtime> {
    fn sharesheet(&self) -> &Sharesheet<R>;
}

impl<R: Runtime, T: Manager<R>> crate::SharesheetExt<R> for T {
    fn sharesheet(&self) -> &Sharesheet<R> {
        self.state::<Sharesheet<R>>().inner()
    }
}

/// Initializes the plugin.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("sharesheet")
        .setup(|app, api| {
            #[cfg(target_os = "android")]
            let handle = api.register_android_plugin(PLUGIN_IDENTIFIER, "SharesheetPlugin")?;
            #[cfg(target_os = "ios")]
            let handle = api.register_ios_plugin(init_plugin_sharesheet)?;
            app.manage(Sharesheet(handle));
            Ok(())
        })
        .build()
}
