use std::{
    sync::{
        mpsc::{channel, Sender},
        Mutex,
    },
    thread,
};

use authenticator::{
    authenticatorservice::{AuthenticatorService, RegisterArgs, SignArgs},
    crypto::COSEAlgorithm,
    ctap2::server::{
        AuthenticationExtensionsClientInputs, AuthenticationExtensionsClientOutputs,
        CredentialProtectionPolicy, HMACGetSecretInput, PublicKeyCredentialDescriptor,
        PublicKeyCredentialParameters, PublicKeyCredentialUserEntity, RelyingParty,
        ResidentKeyRequirement, Transport, UserVerificationRequirement,
    },
    statecallback::StateCallback,
    Pin, StatusPinUv, StatusUpdate,
};
use base64::{prelude::BASE64_URL_SAFE_NO_PAD, Engine};
use base64urlsafedata::Base64UrlSafeData;
use openssl::sha::Sha256;
use tauri::{async_runtime::block_on, AppHandle, Emitter, Runtime, Url};
use tokio::sync::mpsc;
use webauthn_rs_proto::{
    AuthenticatorTransport, PublicKeyCredential, PublicKeyCredentialCreationOptions,
    PublicKeyCredentialRequestOptions, RegisterPublicKeyCredential,
    RegistrationExtensionsClientOutputs, RequestAuthenticationExtensions,
    RequestRegistrationExtensions,
};

use crate::authenticators::ctap2::event::WebauthnEvent;
use crate::prf::{
    PrfAuthenticationInput, PrfAuthenticationOutput, PrfRegistrationInput, PrfRegistrationOutput,
};

use super::EVENT_NAME;

pub fn init_manager() -> crate::Result<AuthenticatorService> {
    let mut manager = AuthenticatorService::new()?;
    manager.add_u2f_usb_hid_platform_transports();
    Ok(manager)
}

pub fn perform_register(
    manager: &Mutex<AuthenticatorService>,
    status_tx: Sender<StatusUpdate>,
    url: Url,
    options: PublicKeyCredentialCreationOptions,
    prf: Option<PrfRegistrationInput>,
    timeout: u64,
) -> crate::Result<(RegisterPublicKeyCredential, Option<PrfRegistrationOutput>)> {
    let client_data =
        crate::validation::build_client_data("webauthn.create", &options.challenge, &url)?;

    let mut hasher = Sha256::new();
    hasher.update(&client_data);
    let client_data_hash = hasher.finish();

    let user_verification_req = options
        .authenticator_selection
        .as_ref()
        .map(|s| convert_user_verification(s.user_verification))
        .unwrap_or(UserVerificationRequirement::Preferred);
    let resident_key_req = convert_resident_key(options.authenticator_selection.as_ref());
    let exclude_list = convert_exclude_list(options.exclude_credentials);

    let args = RegisterArgs {
        pin: None,
        client_data_hash,
        origin: url.to_string(),
        user_verification_req,
        use_ctap1_fallback: false,
        relying_party: RelyingParty {
            id: options.rp.id,
            name: Some(options.rp.name),
        },
        user: PublicKeyCredentialUserEntity {
            id: options.user.id.to_vec(),
            name: Some(options.user.name),
            display_name: Some(options.user.display_name),
        },
        exclude_list,
        resident_key_req,
        extensions: convert_request_registration_extensions(options.extensions, prf),
        pub_cred_params: convert_algorithms(options.pub_key_cred_params),
    };

    let (register_tx, register_rx) = channel();
    let callback = StateCallback::new(Box::new(move |rv| {
        let _ = register_tx.send(rv);
    }));

    // `args` carries the hmac-secret/PRF inputs, which are key-derivation
    // secrets — log only non-sensitive shape, never the struct itself.
    #[cfg(feature = "log")]
    log::debug!(
        "Registering with rp_id={}, {} pub_cred_params",
        args.relying_party.id,
        args.pub_cred_params.len()
    );

    // Hold the manager lock only for this dispatch: `register` hands the work
    // to transport threads and returns. The blocking wait below must run
    // WITHOUT the lock so that `cancel()` can acquire it mid-operation.
    manager
        .lock()
        .unwrap()
        .register(timeout, args, status_tx, callback)?;

    let result = register_rx.recv().map_err(|_| {
        crate::Error::Authenticator("Registration ended without a result".to_string())
    })??;

    #[cfg(feature = "log")]
    log::debug!("Register succeeded");

    let raw_id = result
        .att_obj
        .auth_data
        .credential_data
        .as_ref()
        .map(|c| c.credential_id.clone())
        .ok_or_else(|| {
            crate::Error::Authenticator("attestation object is missing credential data".to_string())
        })?;

    let prf_output = prf.map(|_| PrfRegistrationOutput {
        enabled: result.extensions.hmac_create_secret.unwrap_or(false),
    });

    let credential = webauthn_rs_proto::RegisterPublicKeyCredential {
        extensions: convert_response_registration_extensions(result.extensions),
        response: webauthn_rs_proto::AuthenticatorAttestationResponseRaw {
            attestation_object: serde_cbor_2::to_vec(&result.att_obj)?.into(),
            client_data_json: Base64UrlSafeData::from(client_data),
            transports: Some(vec![
                AuthenticatorTransport::Usb,
                AuthenticatorTransport::Nfc,
                AuthenticatorTransport::Internal,
                AuthenticatorTransport::Ble,
            ]),
        },
        id: BASE64_URL_SAFE_NO_PAD.encode(&raw_id),
        raw_id: raw_id.into(),
        type_: "public-key".to_string(),
    };

    Ok((credential, prf_output))
}

pub fn perform_authentication(
    manager: &Mutex<AuthenticatorService>,
    status_tx: Sender<StatusUpdate>,
    url: Url,
    options: PublicKeyCredentialRequestOptions,
    prf: Option<PrfAuthenticationInput>,
    timeout: u64,
) -> crate::Result<(PublicKeyCredential, Option<PrfAuthenticationOutput>)> {
    let client_data =
        crate::validation::build_client_data("webauthn.get", &options.challenge, &url)?;

    let mut hasher = Sha256::new();
    hasher.update(&client_data);
    let client_data_hash = hasher.finish();

    // Keep the allow-list ids: CTAP2.0 authenticators may omit `credentials`
    // from the assertion, and a single-entry allow list is then the only way
    // to recover which credential signed.
    let allowed_ids: Vec<Vec<u8>> = options
        .allow_credentials
        .iter()
        .map(|c| c.id.to_vec())
        .collect();

    let args = SignArgs {
        pin: None,
        relying_party_id: options.rp_id.clone(),
        client_data_hash,
        origin: url.to_string(),
        user_presence_req: true,
        user_verification_req: convert_user_verification(options.user_verification),
        use_ctap1_fallback: false,
        allow_list: convert_allow_list(options.allow_credentials),
        extensions: convert_request_authentication_extensions(options.extensions, prf.as_ref()),
    };

    let (sign_tx, sign_rx) = channel();
    let callback = StateCallback::new(Box::new(move |rv| {
        let _ = sign_tx.send(rv);
    }));

    // `args.extensions` carries the PRF salts — see perform_register.
    #[cfg(feature = "log")]
    log::debug!("Signing with rp_id={}", args.relying_party_id);

    // Hold the manager lock only for this dispatch: `sign` hands the work
    // to transport threads and returns. The blocking wait below must run
    // WITHOUT the lock so that `cancel()` can acquire it mid-operation.
    manager
        .lock()
        .unwrap()
        .sign(timeout, args, status_tx, callback)?;

    let result = sign_rx.recv().map_err(|_| {
        crate::Error::Authenticator("Authentication ended without a result".to_string())
    })??;

    // The sign result contains the PRF outputs — do not log it.
    #[cfg(feature = "log")]
    log::debug!("Sign succeeded");

    // `credentials` was optional in CTAP2.0: authenticators may omit it when
    // the client already knows which credential signed. A single-entry allow
    // list identifies that credential; otherwise (discoverable-credential
    // flow) there is nothing to fall back on and an empty id would only fail
    // later at the relying party, so surface a protocol error here instead.
    let raw_id = match result.assertion.credentials {
        Some(c) => c.id,
        None => match allowed_ids.as_slice() {
            [only] => only.clone(),
            _ => {
                return Err(crate::Error::Authenticator(
                    "authenticator did not return a credential id".to_string(),
                ))
            }
        },
    };
    let auth_data = result.assertion.auth_data.to_vec();

    let prf_output = result
        .extensions
        .hmac_get_secret
        .as_ref()
        .map(|h| PrfAuthenticationOutput {
            first: h.output1.to_vec(),
            second: h.output2.map(|s| s.to_vec()),
        });

    let credential = PublicKeyCredential {
        id: BASE64_URL_SAFE_NO_PAD.encode(&raw_id),
        raw_id: raw_id.into(),
        type_: "public-key".to_string(),
        response: webauthn_rs_proto::AuthenticatorAssertionResponseRaw {
            client_data_json: Base64UrlSafeData::from(client_data),
            authenticator_data: auth_data.into(),
            signature: result.assertion.signature.into(),
            user_handle: result.assertion.user.map(|h| h.id.into()),
        },
        extensions: convert_response_authentication_extensions(result.extensions),
    };

    Ok((credential, prf_output))
}

pub fn status<R: Runtime>(
    app_handle: AppHandle<R>,
    pin_sender: mpsc::Sender<Sender<Pin>>,
    select_sender: mpsc::Sender<Sender<Option<usize>>>,
) -> Sender<StatusUpdate> {
    let (status_tx, status_rx) = channel::<StatusUpdate>();
    thread::spawn(move || loop {
        let Ok(status) = status_rx.recv() else {
            return;
        };

        #[cfg(feature = "log")]
        log::debug!("Status: {status:?}");

        match &status {
            StatusUpdate::PinUvError(StatusPinUv::PinRequired(sender))
            | StatusUpdate::PinUvError(StatusPinUv::InvalidPin(sender, ..)) => {
                block_on(async {
                    let _ = pin_sender.send(sender.clone()).await;
                });
            }
            StatusUpdate::SelectResultNotice(sender, ..) => {
                block_on(async {
                    let _ = select_sender.send(sender.clone()).await;
                });
            }
            _ => (),
        }

        if let Some(event) = WebauthnEvent::from_status(status) {
            let _ = app_handle.emit(EVENT_NAME, event);
        }
    });
    status_tx
}

fn convert_response_authentication_extensions(
    extensions: AuthenticationExtensionsClientOutputs,
) -> webauthn_rs_proto::AuthenticationExtensionsClientOutputs {
    // PRF travels back to `commands.rs` as its own typed return value (see
    // `perform_authentication`'s `prf_output`), not through this struct — do
    // not also populate `hmac_get_secret` here, or the credential's serialized
    // `extensions` carries the same secret twice under the legacy CTAP2
    // spelling. `crate::prf::set_client_extension_results` strips any survivor
    // as a second line of defense, but the fix belongs at the source.
    webauthn_rs_proto::AuthenticationExtensionsClientOutputs {
        appid: extensions.app_id,
        hmac_get_secret: None,
    }
}

fn convert_request_authentication_extensions(
    extensions: Option<RequestAuthenticationExtensions>,
    prf: Option<&PrfAuthenticationInput>,
) -> AuthenticationExtensionsClientInputs {
    // CTAP2 hmac-secret salts are derived from the browser's PRF salts; the
    // native WebAuthn layers on the other platforms do this for us.
    let hmac_get_secret = prf.map(|p| HMACGetSecretInput {
        salt1: crate::prf::ctap_salt(&p.first),
        salt2: p.second.as_deref().map(crate::prf::ctap_salt),
    });

    AuthenticationExtensionsClientInputs {
        app_id: extensions.and_then(|e| e.appid),
        hmac_get_secret,
        ..Default::default()
    }
}

fn convert_request_registration_extensions(
    extensions: Option<RequestRegistrationExtensions>,
    prf: Option<PrfRegistrationInput>,
) -> AuthenticationExtensionsClientInputs {
    let mut inputs = extensions
        .map(|e| AuthenticationExtensionsClientInputs {
            cred_props: e.cred_props,
            min_pin_length: e.min_pin_length,
            credential_protection_policy: e
                .cred_protect
                .clone()
                .map(|c| convert_credential_protection_policy(c.credential_protection_policy)),
            enforce_credential_protection_policy: e
                .cred_protect
                .and_then(|c| c.enforce_credential_protection_policy),
            ..Default::default()
        })
        .unwrap_or_default();
    inputs.hmac_create_secret = prf.map(|_| true);
    inputs
}

fn convert_response_registration_extensions(
    extensions: AuthenticationExtensionsClientOutputs,
) -> RegistrationExtensionsClientOutputs {
    // PRF travels back to `commands.rs` as its own typed return value (see
    // `perform_register`'s `prf_output`, sourced from `hmac_create_secret`
    // just above) — do not also surface `hmac_secret` here, or the serialized
    // credential would carry `clientExtensionResults.hmacSecret` alongside
    // `prf.enabled` for the same fact.
    RegistrationExtensionsClientOutputs {
        appid: extensions.app_id,
        hmac_secret: None,
        cred_props: extensions
            .cred_props
            .map(|c| webauthn_rs_proto::CredProps { rk: Some(c.rk) }),
        ..Default::default()
    }
}

fn convert_credential_protection_policy(
    cred_protect: webauthn_rs_proto::CredentialProtectionPolicy,
) -> CredentialProtectionPolicy {
    match cred_protect {
    webauthn_rs_proto::CredentialProtectionPolicy::UserVerificationOptional => {
      CredentialProtectionPolicy::UserVerificationOptional
    }
    webauthn_rs_proto::CredentialProtectionPolicy::UserVerificationOptionalWithCredentialIDList => {
      CredentialProtectionPolicy::UserVerificationOptionalWithCredentialIDList
    }
    webauthn_rs_proto::CredentialProtectionPolicy::UserVerificationRequired => {
      CredentialProtectionPolicy::UserVerificationRequired
    }
  }
}

fn convert_algorithms(
    algorithms: Vec<webauthn_rs_proto::PubKeyCredParams>,
) -> Vec<PublicKeyCredentialParameters> {
    algorithms
        .into_iter()
        .filter_map(|a| {
            Some(PublicKeyCredentialParameters {
                alg: COSEAlgorithm::try_from(a.alg).ok()?,
            })
        })
        .collect()
}

fn convert_transports(
    transports: Vec<webauthn_rs_proto::AuthenticatorTransport>,
) -> Vec<Transport> {
    transports
        .into_iter()
        .filter_map(|t| match t {
            webauthn_rs_proto::AuthenticatorTransport::Usb => Some(Transport::USB),
            webauthn_rs_proto::AuthenticatorTransport::Nfc => Some(Transport::NFC),
            webauthn_rs_proto::AuthenticatorTransport::Ble => Some(Transport::BLE),
            webauthn_rs_proto::AuthenticatorTransport::Internal => Some(Transport::Internal),
            _ => None, // Hybrid etc. have no CTAP2-crate equivalent
        })
        .collect()
}

fn convert_exclude_list(
    list: Option<Vec<webauthn_rs_proto::PublicKeyCredentialDescriptor>>,
) -> Vec<PublicKeyCredentialDescriptor> {
    list.unwrap_or_default()
        .into_iter()
        .map(|d| PublicKeyCredentialDescriptor {
            id: d.id.into(),
            transports: d.transports.map(convert_transports).unwrap_or_default(),
        })
        .collect()
}

fn convert_allow_list(
    list: Vec<webauthn_rs_proto::AllowCredentials>,
) -> Vec<PublicKeyCredentialDescriptor> {
    list.into_iter()
        .map(|c| PublicKeyCredentialDescriptor {
            id: c.id.into(),
            transports: c.transports.map(convert_transports).unwrap_or_default(),
        })
        .collect()
}

fn convert_user_verification(
    policy: webauthn_rs_proto::UserVerificationPolicy,
) -> UserVerificationRequirement {
    match policy {
        webauthn_rs_proto::UserVerificationPolicy::Required => {
            UserVerificationRequirement::Required
        }
        webauthn_rs_proto::UserVerificationPolicy::Preferred => {
            UserVerificationRequirement::Preferred
        }
        webauthn_rs_proto::UserVerificationPolicy::Discouraged_DO_NOT_USE => {
            UserVerificationRequirement::Discouraged
        }
    }
}

fn convert_resident_key(
    selection: Option<&webauthn_rs_proto::AuthenticatorSelectionCriteria>,
) -> ResidentKeyRequirement {
    match selection.and_then(|s| s.resident_key) {
        Some(webauthn_rs_proto::ResidentKeyRequirement::Required) => {
            ResidentKeyRequirement::Required
        }
        Some(webauthn_rs_proto::ResidentKeyRequirement::Preferred) => {
            ResidentKeyRequirement::Preferred
        }
        Some(webauthn_rs_proto::ResidentKeyRequirement::Discouraged) => {
            ResidentKeyRequirement::Discouraged
        }
        // WebAuthn Level 1 compatibility: the boolean is authoritative when the
        // enum is absent.
        None if selection.map(|s| s.require_resident_key).unwrap_or(false) => {
            ResidentKeyRequirement::Required
        }
        None => ResidentKeyRequirement::Preferred,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn selection(
        resident_key: Option<webauthn_rs_proto::ResidentKeyRequirement>,
        require_resident_key: bool,
    ) -> webauthn_rs_proto::AuthenticatorSelectionCriteria {
        webauthn_rs_proto::AuthenticatorSelectionCriteria {
            authenticator_attachment: None,
            resident_key,
            require_resident_key,
            user_verification: webauthn_rs_proto::UserVerificationPolicy::Preferred,
        }
    }

    #[test]
    fn convert_user_verification_maps_every_policy() {
        use webauthn_rs_proto::UserVerificationPolicy as P;
        assert_eq!(
            convert_user_verification(P::Required),
            UserVerificationRequirement::Required
        );
        assert_eq!(
            convert_user_verification(P::Preferred),
            UserVerificationRequirement::Preferred
        );
        assert_eq!(
            convert_user_verification(P::Discouraged_DO_NOT_USE),
            UserVerificationRequirement::Discouraged
        );
    }

    #[test]
    fn convert_resident_key_prefers_the_enum_when_present() {
        use webauthn_rs_proto::ResidentKeyRequirement as R;
        assert_eq!(
            convert_resident_key(Some(&selection(Some(R::Required), false))),
            ResidentKeyRequirement::Required
        );
        assert_eq!(
            convert_resident_key(Some(&selection(Some(R::Discouraged), true))),
            ResidentKeyRequirement::Discouraged
        );
    }

    #[test]
    fn convert_resident_key_falls_back_to_the_level1_boolean() {
        // Enum absent + require_resident_key=true => Required (WebAuthn L1).
        assert_eq!(
            convert_resident_key(Some(&selection(None, true))),
            ResidentKeyRequirement::Required
        );
        // Enum absent + boolean false => Preferred (the crate's default).
        assert_eq!(
            convert_resident_key(Some(&selection(None, false))),
            ResidentKeyRequirement::Preferred
        );
    }

    #[test]
    fn convert_resident_key_defaults_to_preferred_without_selection() {
        assert_eq!(
            convert_resident_key(None),
            ResidentKeyRequirement::Preferred
        );
    }

    #[test]
    fn convert_transports_maps_known_and_drops_hybrid() {
        use webauthn_rs_proto::AuthenticatorTransport as T;
        let out = convert_transports(vec![T::Usb, T::Nfc, T::Ble, T::Internal, T::Hybrid]);
        assert_eq!(
            out,
            vec![
                Transport::USB,
                Transport::NFC,
                Transport::BLE,
                Transport::Internal
            ]
        );
    }

    #[test]
    fn convert_algorithms_keeps_known_cose_algs_and_filters_unknown() {
        let params = vec![
            webauthn_rs_proto::PubKeyCredParams {
                type_: "public-key".to_string(),
                alg: -7, // ES256
            },
            webauthn_rs_proto::PubKeyCredParams {
                type_: "public-key".to_string(),
                alg: 999_999, // not a COSE algorithm
            },
        ];
        let out = convert_algorithms(params);
        assert_eq!(
            out,
            vec![PublicKeyCredentialParameters {
                alg: COSEAlgorithm::ES256
            }]
        );
    }

    #[test]
    fn convert_exclude_list_is_empty_when_absent() {
        assert!(convert_exclude_list(None).is_empty());
    }

    #[test]
    fn convert_exclude_list_maps_ids_and_transports() {
        use webauthn_rs_proto::AuthenticatorTransport as T;
        let list = vec![webauthn_rs_proto::PublicKeyCredentialDescriptor {
            type_: "public-key".to_string(),
            id: vec![1u8, 2, 3].into(),
            transports: Some(vec![T::Usb]),
        }];
        let out = convert_exclude_list(Some(list));
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].id, vec![1u8, 2, 3]);
        assert_eq!(out[0].transports, vec![Transport::USB]);
    }

    #[test]
    fn convert_allow_list_defaults_transports_to_empty() {
        let list = vec![webauthn_rs_proto::AllowCredentials {
            type_: "public-key".to_string(),
            id: vec![9u8, 9].into(),
            transports: None,
        }];
        let out = convert_allow_list(list);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].id, vec![9u8, 9]);
        assert!(out[0].transports.is_empty());
    }

    #[test]
    fn convert_request_authentication_extensions_defaults_when_none() {
        let out = convert_request_authentication_extensions(None, None);
        assert!(out.hmac_get_secret.is_none());
        assert!(out.app_id.is_none());
    }

    #[test]
    fn convert_request_authentication_extensions_passes_through_appid() {
        let ext = RequestAuthenticationExtensions {
            appid: Some("https://example.com".to_string()),
            uvm: None,
            hmac_get_secret: None,
        };
        let out = convert_request_authentication_extensions(Some(ext), None);
        assert_eq!(out.app_id, Some("https://example.com".to_string()));
        assert!(out.hmac_get_secret.is_none());
    }

    // SHA-256("WebAuthn PRF" || 0x00 || "salt1")
    const SALT1_DERIVED: [u8; 32] = [
        0x2a, 0x19, 0x90, 0xf9, 0xc9, 0xbb, 0xfe, 0x1b, 0xbf, 0x56, 0xab, 0xee, 0x2b, 0x5a, 0x0f,
        0x59, 0xbe, 0x5f, 0x63, 0x3a, 0x35, 0xc2, 0xa5, 0xf0, 0x7d, 0x85, 0x53, 0x3e, 0xee, 0xcb,
        0xdd, 0x3c,
    ];

    #[test]
    fn authentication_extensions_derive_ctap_salts_from_browser_salts() {
        let prf = PrfAuthenticationInput {
            first: b"salt1".to_vec(),
            second: None,
        };
        let out = convert_request_authentication_extensions(None, Some(&prf));
        let hmac = out.hmac_get_secret.unwrap();
        assert_eq!(hmac.salt1, SALT1_DERIVED);
        assert!(hmac.salt2.is_none());
    }

    #[test]
    fn authentication_extensions_accept_salts_of_any_length() {
        // Browser PRF salts are arbitrary length; the derivation makes them 32 bytes.
        let prf = PrfAuthenticationInput {
            first: vec![7u8; 3],
            second: Some(vec![9u8; 100]),
        };
        let out = convert_request_authentication_extensions(None, Some(&prf));
        let hmac = out.hmac_get_secret.unwrap();
        assert_eq!(hmac.salt1, crate::prf::ctap_salt(&[7u8; 3]));
        assert_eq!(hmac.salt2, Some(crate::prf::ctap_salt(&[9u8; 100])));
    }

    #[test]
    fn convert_request_registration_extensions_maps_cred_protect_and_hmac() {
        let ext = webauthn_rs_proto::RequestRegistrationExtensions {
            cred_protect: Some(webauthn_rs_proto::CredProtect {
                credential_protection_policy:
                    webauthn_rs_proto::CredentialProtectionPolicy::UserVerificationRequired,
                enforce_credential_protection_policy: Some(true),
            }),
            uvm: None,
            cred_props: Some(true),
            min_pin_length: Some(true),
            hmac_create_secret: None,
        };
        let out = convert_request_registration_extensions(Some(ext), Some(PrfRegistrationInput));
        assert_eq!(out.cred_props, Some(true));
        assert_eq!(out.min_pin_length, Some(true));
        assert_eq!(out.hmac_create_secret, Some(true));
        assert_eq!(
            out.credential_protection_policy,
            Some(CredentialProtectionPolicy::UserVerificationRequired)
        );
        assert_eq!(out.enforce_credential_protection_policy, Some(true));
    }

    #[test]
    fn convert_request_registration_extensions_defaults_when_none() {
        let out = convert_request_registration_extensions(None, None);
        assert!(out.hmac_create_secret.is_none());
        assert!(out.credential_protection_policy.is_none());
    }

    #[test]
    fn convert_credential_protection_policy_maps_all_variants() {
        use webauthn_rs_proto::CredentialProtectionPolicy as P;
        assert_eq!(
            convert_credential_protection_policy(P::UserVerificationOptional),
            CredentialProtectionPolicy::UserVerificationOptional
        );
        assert_eq!(
            convert_credential_protection_policy(P::UserVerificationOptionalWithCredentialIDList),
            CredentialProtectionPolicy::UserVerificationOptionalWithCredentialIDList
        );
        assert_eq!(
            convert_credential_protection_policy(P::UserVerificationRequired),
            CredentialProtectionPolicy::UserVerificationRequired
        );
    }

    #[test]
    fn convert_response_registration_extensions_maps_cred_props_but_not_hmac_secret() {
        // `hmac_create_secret` must NOT surface as `hmac_secret` here: PRF
        // travels back as its own typed value (`perform_register`'s
        // `prf_output`), and re-populating this field would duplicate the
        // secret-derivation signal under the legacy CTAP2 spelling.
        let outputs = AuthenticationExtensionsClientOutputs {
            app_id: Some(true),
            hmac_create_secret: Some(true),
            cred_props: Some(authenticator::ctap2::server::CredentialProperties { rk: true }),
            ..Default::default()
        };
        let out = convert_response_registration_extensions(outputs);
        assert_eq!(out.appid, Some(true));
        assert!(out.hmac_secret.is_none());
        assert_eq!(out.cred_props.map(|c| c.rk), Some(Some(true)));
    }

    #[test]
    fn convert_response_authentication_extensions_passes_through_appid_but_not_hmac_get_secret() {
        // Same reasoning as the registration case: `hmac_get_secret` here
        // would duplicate the PRF secret alongside `prf.results`.
        let outputs = AuthenticationExtensionsClientOutputs {
            app_id: Some(false),
            hmac_get_secret: Some(authenticator::ctap2::server::HMACGetSecretOutput {
                output1: [3u8; 32],
                output2: Some([4u8; 32]),
            }),
            ..Default::default()
        };
        let out = convert_response_authentication_extensions(outputs);
        assert_eq!(out.appid, Some(false));
        assert!(out.hmac_get_secret.is_none());
    }
}
