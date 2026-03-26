use serde::de::DeserializeOwned;
use tauri::{
    plugin::{PluginApi, PluginHandle},
    AppHandle, Runtime,
};

use crate::models::*;

#[cfg(target_os = "ios")]
tauri::ios_plugin_binding!(init_plugin_safe_area_insets_css);

// initializes the Kotlin or Swift plugin classes
pub fn init<R: Runtime, C: DeserializeOwned>(
    _app: &AppHandle<R>,
    api: PluginApi<R, C>,
) -> crate::Result<SafeAreaInsetsCss<R>> {
    #[cfg(target_os = "android")]
    let handle = api.register_android_plugin("com.plugin.safe.area.insets.css", "InsetPlugin")?;
    #[cfg(target_os = "ios")]
    let handle = api.register_ios_plugin(init_plugin_safe_area_insets_css)?;
    Ok(SafeAreaInsetsCss(handle))
}

/// Access to the safe-area-insets-css APIs.
pub struct SafeAreaInsetsCss<R: Runtime>(PluginHandle<R>);

impl<R: Runtime> SafeAreaInsetsCss<R> {
    pub fn get_top_inset(&self) -> crate::Result<GetInsetResponse> {
        self.0
            .run_mobile_plugin("getTopInset", ())
            .map_err(Into::into)
    }
    pub fn get_bottom_inset(&self) -> crate::Result<GetInsetResponse> {
        self.0
            .run_mobile_plugin("getBottomInset", ())
            .map_err(Into::into)
    }

    pub fn set_scribble_enabled(&self, enabled: bool) -> crate::Result<()> {
        self.0
            .run_mobile_plugin(
                "setScribbleEnabled",
                SetScribbleEnabledRequest { enabled },
            )
            .map_err(Into::into)
    }
}
