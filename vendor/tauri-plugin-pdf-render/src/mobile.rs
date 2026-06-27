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
    /// Render the HTML through the native WebView and write a correctly
    /// paginated A4 PDF to `output_path`.
    pub fn render(&self, request: RenderRequest) -> Result<RenderResponse> {
        let response: RenderResponse = self
            .0
            .run_mobile_plugin("render", request)
            .map_err(crate::Error::from)?;
        Ok(response)
    }

    /// Copy a file from a local temp path into a scoped-storage destination.
    pub fn write_to_scoped(&self, request: WriteScopedRequest) -> Result<()> {
        self.0
            .run_mobile_plugin::<serde_json::Value>("writeScoped", request)
            .map_err(crate::Error::from)?;
        Ok(())
    }
}
