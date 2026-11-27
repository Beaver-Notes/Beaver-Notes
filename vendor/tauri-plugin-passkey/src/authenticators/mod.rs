use serde::de::DeserializeOwned;
use tauri::{plugin::PluginApi, AppHandle, Runtime, Url};
use webauthn_rs_proto::{
    PublicKeyCredential, PublicKeyCredentialCreationOptions, PublicKeyCredentialRequestOptions,
    RegisterPublicKeyCredential,
};

use crate::prf::{
    PrfAuthenticationInput, PrfAuthenticationOutput, PrfRegistrationInput, PrfRegistrationOutput,
};

#[cfg(not(any(
    target_os = "android",
    target_os = "ios",
    target_os = "windows",
    target_os = "macos"
)))]
pub mod ctap2;
#[cfg(target_os = "macos")]
pub mod macos;
#[cfg(mobile)]
pub mod mobile;
#[cfg(all(desktop, windows))]
pub mod windows;

pub trait Authenticator<R: Runtime>: Sized {
    fn init<C: DeserializeOwned>(app: &AppHandle<R>, api: PluginApi<R, C>) -> crate::Result<Self>;
    /// Register a new webauthn credential.
    ///
    /// `prf` is the browser `prf` extension input. Backends fronting a native
    /// WebAuthn layer pass its salts through unchanged; raw-CTAP2 backends must
    /// derive theirs with [`crate::prf::ctap_salt`].
    ///
    /// This is a blocking call and should be run in a separate thread.
    fn register(
        &self,
        origin: Url,
        options: PublicKeyCredentialCreationOptions,
        prf: Option<PrfRegistrationInput>,
        timeout: u32,
    ) -> crate::Result<(RegisterPublicKeyCredential, Option<PrfRegistrationOutput>)>;

    /// Authenticate using webauthn.
    ///
    /// See [`Authenticator::register`] for the meaning of `prf`.
    ///
    /// This is a blocking call and should be run in a separate thread.
    fn authenticate(
        &self,
        origin: Url,
        options: PublicKeyCredentialRequestOptions,
        prf: Option<PrfAuthenticationInput>,
        timeout: u32,
    ) -> crate::Result<(PublicKeyCredential, Option<PrfAuthenticationOutput>)>;

    /// Send a PIN to the authenticator.
    /// This is only required for some authenticators.
    fn send_pin(&self, pin: String) {
        #[cfg(feature = "log")]
        log::warn!("send_pin is not implemented/required for this authenticator");
        let _ = pin;
    }

    /// Select a key from the authenticator.
    /// This is only required for some authenticators.
    fn select_key(&self, key: usize) {
        #[cfg(feature = "log")]
        log::warn!("select_key is not implemented/required for this authenticator");
        let _ = key;
    }

    /// Cancel the current operation.
    /// This is only supported by some authenticators.
    fn cancel(&self) {
        #[cfg(feature = "log")]
        log::warn!("cancel is not implemented/required for this authenticator");
    }
}
