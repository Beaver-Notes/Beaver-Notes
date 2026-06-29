use tauri::{
    plugin::{Builder, TauriPlugin},
    Runtime,
};

#[cfg(mobile)]
use tauri::Manager;

pub use models::*;

mod error;
mod models;

#[cfg(mobile)]
mod mobile;

pub use error::{Error, Result};

#[cfg(mobile)]
use mobile::PdfRender;

#[cfg(mobile)]
/// Extensions to [`tauri::App`], [`tauri::AppHandle`] and [`tauri::Window`]
/// to access the pdf-render APIs.
pub trait PdfRenderExt<R: Runtime> {
    fn pdf_render(&self) -> &PdfRender<R>;
}

#[cfg(mobile)]
impl<R: Runtime, T: Manager<R>> crate::PdfRenderExt<R> for T {
    fn pdf_render(&self) -> &PdfRender<R> {
        self.state::<PdfRender<R>>().inner()
    }
}

/// Initializes the plugin. Call this from your `tauri::Builder` like
/// any other Tauri plugin. The plugin only does work on mobile
/// (iOS/Android); on desktop `init` is a no-op and the plugin's
/// `PdfRenderExt` trait is unavailable.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("pdf-render")
        .setup(|app, api| {
            #[cfg(mobile)]
            let pdf_render = mobile::init(app, api)?;
            #[cfg(mobile)]
            app.manage(pdf_render);
            #[cfg(not(mobile))]
            let _ = (app, api);
            Ok(())
        })
        .build()
}
