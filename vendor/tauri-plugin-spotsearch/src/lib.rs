use tauri::{
    plugin::{Builder, TauriPlugin},
    Manager, Runtime,
};

pub use models::*;

pub mod commands;
#[cfg(not(target_os = "ios"))]
mod desktop;
#[cfg(target_os = "ios")]
mod mobile;
mod models;
mod error;

pub use error::{Error, Result};

#[cfg(not(target_os = "ios"))]
use desktop::SpotSearch;
#[cfg(target_os = "ios")]
use mobile::SpotSearch;

pub trait SpotSearchExt<R: Runtime> {
    fn spotsearch(&self) -> &SpotSearch<R>;
}

impl<R: Runtime, T: Manager<R>> crate::SpotSearchExt<R> for T {
    fn spotsearch(&self) -> &SpotSearch<R> {
        self.state::<SpotSearch<R>>().inner()
    }
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("spotsearch")
        .invoke_handler(tauri::generate_handler![
            commands::enable_indexing,
            commands::index_items,
            commands::delete_items,
            commands::delete_domain,
        ])
        .setup(|_app, api| {
            #[cfg(target_os = "ios")]
            let spotsearch = mobile::init(_app, api)?;
            #[cfg(not(target_os = "ios"))]
            let spotsearch = desktop::init(_app, api)?;
            _app.manage(spotsearch);
            Ok(())
        })
        .build()
}
