use serde::de::DeserializeOwned;
use tauri::{
    plugin::{PluginApi, PluginHandle},
    AppHandle, Runtime,
};

use crate::models::*;
use crate::Result;

#[cfg(target_os = "ios")]
tauri::ios_plugin_binding!(init_plugin_pdf_render);

pub fn init<R: Runtime, C: DeserializeOwned>(
    _app: &AppHandle<R>,
    api: PluginApi<R, C>,
) -> crate::Result<PdfRender<R>> {
    #[cfg(target_os = "android")]
    let handle = api.register_android_plugin("com.plugin.pdf.render", "PdfRenderPlugin")?;
    #[cfg(target_os = "ios")]
    let handle = api.register_ios_plugin(init_plugin_pdf_render)?;
    Ok(PdfRender(handle))
}

/// Access to the pdf-render APIs.
pub struct PdfRender<R: Runtime>(PluginHandle<R>);

impl<R: Runtime> PdfRender<R> {
    /// Render the HTML at `html_path` through the native WebView and
    /// write the resulting PDF to `output_path`. Returns the
    /// keep-blocks JSON string (already un-stringified) extracted
    /// from the page during measurement.
    pub fn render(&self, request: RenderRequest) -> Result<RenderResponse> {
        let response: RenderResponse = self
            .0
            .run_mobile_plugin("render", request)
            .map_err(crate::Error::from)?;
        Ok(response)
    }

    /// Copy a file from `source_path` (a local temp path) into a
    /// scoped-storage destination. The native plugin resolves the
    /// `scoped:` URL via the platform's folder-bookmark store
    /// (UserDefaults on iOS, SharedPreferences on Android) and
    /// writes the file through the security-scoped / content-URI APIs.
    pub fn write_to_scoped(&self, request: WriteScopedRequest) -> Result<()> {
        self.0
            .run_mobile_plugin::<serde_json::Value>("writeScoped", request)
            .map_err(crate::Error::from)?;
        Ok(())
    }
}
