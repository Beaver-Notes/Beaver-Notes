use std::{fmt::Debug, marker::PhantomData};

use serde::de::DeserializeOwned;
use tauri::{plugin::PluginApi, AppHandle, Runtime, Url};
use webauthn_authenticator_rs::{win10::Win10, AuthenticatorBackend};
use webauthn_rs_proto::{
    PublicKeyCredential, PublicKeyCredentialCreationOptions, PublicKeyCredentialRequestOptions,
    RegisterPublicKeyCredential,
};

use crate::prf::{
    PrfAuthenticationInput, PrfAuthenticationOutput, PrfRegistrationInput, PrfRegistrationOutput,
};

use super::Authenticator;

/// Windows' WebAuthn API exposes no PRF/hmac-secret support. `commands.rs`
/// already turns "PRF requested, no backend output" into
/// `clientExtensionResults.prf.enabled = false` for every platform, so
/// registration here always returns `None` and lets that generic rule apply.
///
/// An assertion that actually asks for a secret must fail loudly, and before
/// running an authenticator ceremony that can never satisfy it: silently
/// returning no secret risks data the caller can never decrypt again. This
/// Windows-specific message ("no PRF support at all") is worth keeping
/// alongside the generic one — it tells the caller *why*, not just *that*.
fn reject_prf(prf: Option<&PrfAuthenticationInput>) -> crate::Result<()> {
    if prf.is_some() {
        return Err(crate::Error::Unsupported(
            "PRF is not supported by the Windows WebAuthn API".into(),
        ));
    }
    Ok(())
}

/// Access to the webauthn APIs.
#[derive(Debug)]
pub struct Webauthn<R: Runtime> {
    phantom: PhantomData<AppHandle<R>>,
}

impl<R: Runtime> Authenticator<R> for Webauthn<R> {
    fn init<C: DeserializeOwned>(
        _app: &AppHandle<R>,
        _api: PluginApi<R, C>,
    ) -> crate::Result<Self> {
        Ok(Webauthn {
            phantom: PhantomData,
        })
    }

    /// Register a new credential using native Windows API.
    fn register(
        &self,
        origin: Url,
        options: PublicKeyCredentialCreationOptions,
        _prf: Option<PrfRegistrationInput>,
        timeout: u32,
    ) -> crate::Result<(RegisterPublicKeyCredential, Option<PrfRegistrationOutput>)> {
        let mut auth = Win10::default();
        let credential = auth
            .perform_register(origin, options, timeout)
            .map_err(|e| {
                #[cfg(feature = "log")]
                log::error!("Failed to register: {:?}", e);
                crate::Error::WebAuthn(e)
            })?;
        Ok((credential, None))
    }

    /// Authenticate using native Windows API.
    fn authenticate(
        &self,
        origin: Url,
        options: PublicKeyCredentialRequestOptions,
        prf: Option<PrfAuthenticationInput>,
        timeout: u32,
    ) -> crate::Result<(PublicKeyCredential, Option<PrfAuthenticationOutput>)> {
        reject_prf(prf.as_ref())?;
        let mut auth = Win10::default();
        let credential = auth.perform_auth(origin, options, timeout).map_err(|e| {
            #[cfg(feature = "log")]
            log::error!("Failed to authenticate: {:?}", e);
            crate::Error::WebAuthn(e)
        })?;
        Ok((credential, None))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn authentication_with_salts_is_rejected() {
        let err = reject_prf(Some(&PrfAuthenticationInput {
            first: b"salt1".to_vec(),
            second: None,
        }))
        .unwrap_err();
        assert_eq!(err.kind(), "unsupported");
        assert!(reject_prf(None).is_ok());
    }
}
