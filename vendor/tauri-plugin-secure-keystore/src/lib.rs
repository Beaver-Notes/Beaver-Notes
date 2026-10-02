use tauri::{
    plugin::{Builder, TauriPlugin},
    Runtime,
};
#[cfg(target_os = "android")]
use tauri::Manager;

mod error;
mod models;
#[cfg(target_os = "android")]
mod mobile;

pub use error::{Error, Result};
pub use models::*;

#[cfg(target_os = "android")]
use mobile::SecureKeystore;

#[cfg(target_os = "android")]
pub trait SecureKeystoreExt<R: Runtime> {
    fn secure_keystore(&self) -> &SecureKeystore<R>;
}

#[cfg(target_os = "android")]
impl<R: Runtime, T: Manager<R>> SecureKeystoreExt<R> for T {
    fn secure_keystore(&self) -> &SecureKeystore<R> {
        self.state::<SecureKeystore<R>>().inner()
    }
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("secure-keystore")
        .setup(|_app, _api| {
            #[cfg(target_os = "android")]
            let keystore = mobile::init(_app, _api)?;
            #[cfg(target_os = "android")]
            _app.manage(keystore);
            Ok(())
        })
        .build()
}
