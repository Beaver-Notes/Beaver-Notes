use authenticators::Authenticator;
use tauri::{
    plugin::{Builder, TauriPlugin},
    Manager, Runtime,
};

mod authenticators;
mod commands;
mod error;
mod normalize;
mod prf;
mod validation;
#[cfg(test)]
mod wire_contract;

pub use error::{Error, Result};

#[cfg(not(any(
    target_os = "android",
    target_os = "ios",
    target_os = "windows",
    target_os = "macos"
)))]
type Webauthn<R> = authenticators::ctap2::Webauthn<R>;
#[cfg(target_os = "macos")]
type Webauthn<R> = authenticators::macos::Webauthn<R>;
#[cfg(all(desktop, windows))]
type Webauthn<R> = authenticators::windows::Webauthn<R>;
#[cfg(mobile)]
type Webauthn<R> = authenticators::mobile::Webauthn<R>;

/// Crate-internal accessor for the platform authenticator state.
/// Not public: the return type is a private, cfg-selected alias, so this
/// trait cannot be meaningfully used outside the crate.
pub(crate) trait WebauthnExt<R: Runtime> {
    fn webauthn(&self) -> &Webauthn<R>;
}

impl<R: Runtime, T: Manager<R>> crate::WebauthnExt<R> for T {
    fn webauthn(&self) -> &Webauthn<R> {
        self.state::<Webauthn<R>>().inner()
    }
}

/// Initializes the plugin.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("passkey")
        .invoke_handler(tauri::generate_handler![
            commands::register,
            commands::authenticate,
            commands::send_pin,
            commands::select_key,
            commands::cancel,
        ])
        .setup(|app, api| {
            let webauthn = Webauthn::init(app, api)?;
            app.manage(webauthn);
            Ok(())
        })
        .build()
}
