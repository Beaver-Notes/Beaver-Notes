#![cfg(mobile)]

use tauri::{
    plugin::{Builder, TauriPlugin},
    Runtime,
};

// Binds the Swift `init_plugin_live_activity` symbol so the plugin's
// `@objc live_activity_start/update/end` methods handle invokes on iOS.
#[cfg(target_os = "ios")]
tauri::ios_plugin_binding!(init_plugin_live_activity);

/// Initializes the plugin. On iOS this registers the ActivityKit Swift plugin
/// so the frontend's `plugin:live-activity|live_activity_*` invokes reach it.
/// No-op elsewhere (Live Activities are iOS-only).
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("live-activity")
        .setup(|_app, api| {
            #[cfg(target_os = "ios")]
            api.register_ios_plugin(init_plugin_live_activity)?;
            Ok(())
        })
        .build()
}
