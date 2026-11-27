use std::{
    marker::PhantomData,
    sync::{mpsc::Sender, Mutex},
};

use authenticator::{authenticatorservice::AuthenticatorService, Pin, StatusUpdate};
use serde::de::DeserializeOwned;
use tauri::{plugin::PluginApi, AppHandle, Runtime, Url};
use tokio::sync::mpsc;
use webauthn_rs_proto::{
    PublicKeyCredential, PublicKeyCredentialCreationOptions, PublicKeyCredentialRequestOptions,
    RegisterPublicKeyCredential,
};

use crate::prf::{
    PrfAuthenticationInput, PrfAuthenticationOutput, PrfRegistrationInput, PrfRegistrationOutput,
};

use super::Authenticator;

mod event;
mod platform;

pub const EVENT_NAME: &str = "tauri-plugin-passkey";

pub struct Webauthn<R: Runtime> {
    manager: Mutex<AuthenticatorService>,
    status_tx: Sender<StatusUpdate>,
    pin_receiver: Mutex<mpsc::Receiver<Sender<Pin>>>,
    select_receiver: Mutex<mpsc::Receiver<Sender<Option<usize>>>>,
    phantom: PhantomData<AppHandle<R>>,
}

impl<R: Runtime> Authenticator<R> for Webauthn<R> {
    fn init<C: DeserializeOwned>(app: &AppHandle<R>, _api: PluginApi<R, C>) -> crate::Result<Self> {
        let (pin_sender, pin_receiver) = mpsc::channel(100000);
        let (select_sender, select_receiver) = mpsc::channel(100000);
        Ok(Webauthn {
            manager: Mutex::new(platform::init_manager()?),
            status_tx: platform::status(app.clone(), pin_sender, select_sender),
            pin_receiver: Mutex::new(pin_receiver),
            select_receiver: Mutex::new(select_receiver),
            phantom: PhantomData,
        })
    }

    /// Register a new credential using ctap2.
    fn register(
        &self,
        origin: Url,
        options: PublicKeyCredentialCreationOptions,
        prf: Option<PrfRegistrationInput>,
        timeout: u32,
    ) -> crate::Result<(RegisterPublicKeyCredential, Option<PrfRegistrationOutput>)> {
        #[cfg(feature = "log")]
        log::info!("Registering for rp_id={}", options.rp.id);
        platform::perform_register(
            &self.manager,
            self.status_tx.clone(),
            origin,
            options,
            prf,
            timeout as u64,
        )
        .map_err(|e| {
            #[cfg(feature = "log")]
            log::error!("Failed to register: {e:?}");
            e
        })
    }

    /// Authenticate using ctap2.
    fn authenticate(
        &self,
        origin: Url,
        options: PublicKeyCredentialRequestOptions,
        prf: Option<PrfAuthenticationInput>,
        timeout: u32,
    ) -> crate::Result<(PublicKeyCredential, Option<PrfAuthenticationOutput>)> {
        // `prf` carries the browser salts — log identifiers only.
        #[cfg(feature = "log")]
        log::debug!("Authenticating for rp_id={}", options.rp_id);
        platform::perform_authentication(
            &self.manager,
            self.status_tx.clone(),
            origin,
            options,
            prf,
            timeout as u64,
        )
        .map_err(|e| {
            #[cfg(feature = "log")]
            log::error!("Failed to authenticate: {e:?}");
            e
        })
    }

    /// Send a PIN to the authenticator does nothing if no PIN was requested.
    fn send_pin(&self, pin: String) {
        #[cfg(feature = "log")]
        log::debug!("Sending pin");
        let mut last_sender = None;
        while let Ok(sender) = self.pin_receiver.lock().unwrap().try_recv() {
            last_sender = Some(sender);
        }
        if let Some(sender) = last_sender {
            let _ = sender.send(Pin::new(&pin));
        }
    }

    /// Select a key from the authenticator where key is the index into the list received via the Event.
    /// Does nothing if no selection was requested.
    fn select_key(&self, key: usize) {
        #[cfg(feature = "log")]
        log::debug!("Selecting key {key}");
        let mut last_sender = None;
        while let Ok(sender) = self.select_receiver.lock().unwrap().try_recv() {
            last_sender = Some(sender);
        }
        if let Some(sender) = last_sender {
            let _ = sender.send(Some(key));
        }
    }

    /// Cancel the current operation.
    fn cancel(&self) {
        #[cfg(feature = "log")]
        log::debug!("Cancelling operation");
        let _ = self.manager.lock().unwrap().cancel();
    }
}
