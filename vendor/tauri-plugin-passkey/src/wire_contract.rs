//! Pins the JSON wire format between the webview and the Rust commands.
//! The shapes here are what guest-js/index.ts sends (standard WebAuthn JSON,
//! base64url-encoded binary fields). If a webauthn-rs-proto upgrade breaks
//! these tests, the JS<->Rust contract broke: audit before bumping.

use base64urlsafedata::Base64UrlSafeData;
use std::collections::BTreeSet;
use webauthn_rs_proto::{
    AuthenticationExtensionsClientOutputs, AuthenticatorAssertionResponseRaw,
    AuthenticatorAttestationResponseRaw, CredProps, PublicKeyCredential,
    PublicKeyCredentialCreationOptions, PublicKeyCredentialRequestOptions,
    RegisterPublicKeyCredential, RegistrationExtensionsClientOutputs,
};

#[test]
fn creation_options_deserialize_from_standard_webauthn_json() {
    let json = r#"{
        "rp": { "id": "example.com", "name": "Example" },
        "user": { "id": "dXNlci1pZA", "name": "alice", "displayName": "Alice" },
        "challenge": "Y2hhbGxlbmdlLWJ5dGVz",
        "pubKeyCredParams": [{ "type": "public-key", "alg": -7 }],
        "timeout": 60000,
        "attestation": "none"
    }"#;
    let options: PublicKeyCredentialCreationOptions =
        serde_json::from_str(json).expect("standard creation options JSON must deserialize");
    assert_eq!(options.rp.id, "example.com");
    assert_eq!(options.user.name, "alice");
    assert_eq!(options.pub_key_cred_params.len(), 1);
    assert_eq!(options.pub_key_cred_params[0].alg, -7);
}

#[test]
fn request_options_deserialize_from_standard_webauthn_json() {
    let json = r#"{
        "challenge": "Y2hhbGxlbmdlLWJ5dGVz",
        "rpId": "example.com",
        "timeout": 60000,
        "userVerification": "preferred",
        "allowCredentials": [
            { "type": "public-key", "id": "Y3JlZC1pZA" }
        ]
    }"#;
    let options: PublicKeyCredentialRequestOptions =
        serde_json::from_str(json).expect("standard request options JSON must deserialize");
    assert_eq!(options.rp_id, "example.com");
    assert_eq!(options.allow_credentials.len(), 1);
}

/// Pins the exact `clientExtensionResults` key set produced from a REAL
/// `webauthn-rs-proto` credential — not hand-built input JSON, which is why
/// `prf.rs`'s own tests missed the legacy `hmac_get_secret`/`hmacSecret` leak
/// in the first place. `AuthenticationExtensionsClientOutputs` has no
/// `skip_serializing_if`, so serializing it with `hmac_get_secret: None`
/// still emits a literal `null` — asserted below before the fix is applied,
/// to prove this test would have caught it.
#[test]
fn authentication_response_client_extension_results_exclude_legacy_hmac_and_nulls() {
    let credential = PublicKeyCredential {
        id: "cred".to_string(),
        raw_id: Base64UrlSafeData::from(vec![1, 2, 3]),
        response: AuthenticatorAssertionResponseRaw {
            authenticator_data: Base64UrlSafeData::from(Vec::new()),
            client_data_json: Base64UrlSafeData::from(Vec::new()),
            signature: Base64UrlSafeData::from(Vec::new()),
            user_handle: None,
        },
        extensions: AuthenticationExtensionsClientOutputs {
            appid: None,
            hmac_get_secret: None,
        },
        type_: "public-key".to_string(),
    };
    let mut response = serde_json::to_value(&credential).expect("credential must serialize");

    // Confirm the raw serialization really does carry what set_client_extension_results
    // must strip: a null `appid` and a null `hmac_get_secret`.
    assert_eq!(response["extensions"]["appid"], serde_json::Value::Null);
    assert_eq!(
        response["extensions"]["hmac_get_secret"],
        serde_json::Value::Null
    );

    crate::prf::set_authentication_prf(
        &mut response,
        Some(crate::prf::PrfAuthenticationOutput {
            first: b"secret".to_vec(),
            second: None,
        }),
    );

    let results = response["clientExtensionResults"]
        .as_object()
        .expect("clientExtensionResults must be an object");
    let keys: BTreeSet<&str> = results.keys().map(String::as_str).collect();
    assert_eq!(keys, BTreeSet::from(["prf"]));
    assert!(response.get("extensions").is_none());
}

/// Same pin for registration: a real `RegisterPublicKeyCredential` carrying a
/// legacy `hmacSecret: true` (the CTAP2 spelling) and a legitimate `credProps`
/// output must emit exactly `{ credProps, prf }` — never `hmacSecret`.
#[test]
fn registration_response_client_extension_results_exclude_legacy_hmac_secret() {
    let credential = RegisterPublicKeyCredential {
        id: "cred".to_string(),
        raw_id: Base64UrlSafeData::from(vec![1, 2, 3]),
        response: AuthenticatorAttestationResponseRaw {
            attestation_object: Base64UrlSafeData::from(Vec::new()),
            client_data_json: Base64UrlSafeData::from(Vec::new()),
            transports: None,
        },
        type_: "public-key".to_string(),
        extensions: RegistrationExtensionsClientOutputs {
            appid: None,
            cred_props: Some(CredProps { rk: Some(true) }),
            hmac_secret: Some(true),
            cred_protect: None,
            min_pin_length: None,
        },
    };
    let mut response = serde_json::to_value(&credential).expect("credential must serialize");

    // Confirm the raw serialization really does carry the legacy spelling
    // that must be stripped.
    assert_eq!(
        response["extensions"]["hmacSecret"],
        serde_json::Value::Bool(true)
    );

    crate::prf::set_registration_prf(
        &mut response,
        Some(crate::prf::PrfRegistrationOutput { enabled: true }),
    );

    let results = response["clientExtensionResults"]
        .as_object()
        .expect("clientExtensionResults must be an object");
    let keys: BTreeSet<&str> = results.keys().map(String::as_str).collect();
    assert_eq!(keys, BTreeSet::from(["prf", "credProps"]));
    assert!(response.get("extensions").is_none());
}

/// `prf.eval` at registration is not implementable uniformly across backends
/// (§3 of the design doc) and must never be silently accepted; grouped here
/// with the other PRF wire-contract pins rather than in `prf.rs`.
#[test]
fn registration_options_reject_prf_eval() {
    let options = serde_json::json!({
        "extensions": { "prf": { "eval": { "first": "c2FsdDE" } } }
    });
    let err = crate::prf::registration_input_from_options(&options).unwrap_err();
    assert_eq!(err.kind(), "unsupported");
}
