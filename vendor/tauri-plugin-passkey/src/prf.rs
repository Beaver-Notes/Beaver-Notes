//! The browser `prf` extension, which is this plugin's only PRF spelling.
//!
//! PRF does not travel inside the `webauthn-rs-proto` options, because that crate
//! models the extension as CTAP2 `hmac-secret`. It crosses the `Authenticator`
//! trait as its own typed value, and at that boundary it always means *browser*
//! PRF: salts are the caller's raw `prf.eval.{first,second}` bytes, of any length.
//!
//! Backends that hand the salt to a native WebAuthn layer (ASAuthorization on
//! Apple, Credential Manager on Android) pass it through untouched — those layers
//! apply the spec's derivation themselves. A backend speaking raw CTAP2 must call
//! [`ctap_salt`] first.

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};

/// The caller requested PRF at registration. Carries no salts: evaluating a salt
/// during creation is not supported (see `registration_input_from_options`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PrfRegistrationInput;

/// `prf.eval` — browser-level salts, any length.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PrfAuthenticationInput {
    pub first: Vec<u8>,
    pub second: Option<Vec<u8>>,
}

/// `clientExtensionResults.prf.enabled`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PrfRegistrationOutput {
    pub enabled: bool,
}

/// `clientExtensionResults.prf.results`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PrfAuthenticationOutput {
    pub first: Vec<u8>,
    pub second: Option<Vec<u8>>,
}

/// Derive the CTAP2 `hmac-secret` salt from a browser PRF salt:
/// `SHA-256(UTF8("WebAuthn PRF") || 0x00 || salt)`.
///
/// Only raw-CTAP2 backends need this. Native WebAuthn layers do it internally,
/// and applying it twice yields a different — silently wrong — secret. Used
/// only by the Linux CTAP2 backend, so other targets would otherwise see it
/// as dead code.
#[cfg_attr(
    any(
        target_os = "android",
        target_os = "ios",
        target_os = "windows",
        target_os = "macos"
    ),
    allow(dead_code)
)]
pub fn ctap_salt(salt: &[u8]) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(b"WebAuthn PRF");
    hasher.update([0u8]);
    hasher.update(salt);
    hasher.finalize().into()
}

fn extensions(options: &Value) -> Option<&Map<String, Value>> {
    options.get("extensions").and_then(Value::as_object)
}

fn decode_salt(value: &Value, field: &str) -> crate::Result<Vec<u8>> {
    let encoded = value.as_str().ok_or_else(|| {
        crate::Error::Validation(format!("prf.eval.{field} must be a base64url string"))
    })?;
    URL_SAFE_NO_PAD.decode(encoded).map_err(|e| {
        crate::Error::Validation(format!("prf.eval.{field} is not valid base64url: {e}"))
    })
}

/// Read the `prf` extension from browser creation options.
pub fn registration_input_from_options(
    options: &Value,
) -> crate::Result<Option<PrfRegistrationInput>> {
    let Some(prf) = extensions(options).and_then(|e| e.get("prf")) else {
        return Ok(None);
    };
    if prf.get("eval").is_some() {
        return Err(crate::Error::Unsupported(
            "prf.eval at registration is not supported; register with `prf: {}` and evaluate \
             salts during authentication"
                .into(),
        ));
    }
    Ok(Some(PrfRegistrationInput))
}

/// Read the `prf.eval` salts from browser request options.
pub fn authentication_input_from_options(
    options: &Value,
) -> crate::Result<Option<PrfAuthenticationInput>> {
    let Some(prf) = extensions(options).and_then(|e| e.get("prf")) else {
        return Ok(None);
    };
    let first = prf
        .get("eval")
        .and_then(|e| e.get("first"))
        .ok_or_else(|| {
            crate::Error::Validation("prf.eval.first is required when prf is requested".into())
        })?;
    let second = prf
        .get("eval")
        .and_then(|e| e.get("second"))
        .map(|v| decode_salt(v, "second"))
        .transpose()?;
    Ok(Some(PrfAuthenticationInput {
        first: decode_salt(first, "first")?,
        second,
    }))
}

// Only called from `mobile.rs`, which is `#[cfg(mobile)]` and so does not
// compile on desktop targets; without the attribute rustc would flag these as
// dead code there.
#[cfg_attr(not(mobile), allow(dead_code))]
fn extensions_mut(options: &mut Value) -> Option<&mut Map<String, Value>> {
    let obj = options.as_object_mut()?;
    obj.entry("extensions")
        .or_insert_with(|| Value::Object(Map::new()));
    obj.get_mut("extensions").and_then(Value::as_object_mut)
}

/// Write `extensions.prf = {}` into options bound for a native WebAuthn layer.
#[cfg_attr(not(mobile), allow(dead_code))]
pub fn set_registration_prf_input(options: &mut Value) {
    if let Some(extensions) = extensions_mut(options) {
        extensions.insert("prf".into(), json!({}));
    }
}

/// Write `extensions.prf.eval` into options bound for a native WebAuthn layer.
#[cfg_attr(not(mobile), allow(dead_code))]
pub fn set_authentication_prf_input(options: &mut Value, prf: &PrfAuthenticationInput) {
    let mut eval = Map::new();
    eval.insert("first".into(), json!(URL_SAFE_NO_PAD.encode(&prf.first)));
    if let Some(second) = &prf.second {
        eval.insert("second".into(), json!(URL_SAFE_NO_PAD.encode(second)));
    }
    if let Some(extensions) = extensions_mut(options) {
        extensions.insert("prf".into(), json!({ "eval": Value::Object(eval) }));
    }
}

/// Move the credential's serialized `extensions` to the browser's
/// `clientExtensionResults` key and insert `prf` if there is one.
///
/// `webauthn-rs-proto`'s output extension structs have no `rename_all`/
/// `skip_serializing_if` uniformly applied, so the raw serialization can carry
/// `null` placeholders for extensions the client never used, and — critically —
/// the legacy CTAP2 `hmac_get_secret`/`hmacSecret` spelling. That would leak
/// key-derivation secret material into an undocumented field right alongside
/// `prf`, so both are stripped here regardless of which backend produced the
/// credential. Legitimate non-null outputs (`credProps`, a real `appid`) pass
/// through untouched.
fn set_client_extension_results(response: &mut Value, prf: Option<Value>) {
    let Some(obj) = response.as_object_mut() else {
        return;
    };
    let mut results = obj
        .remove("extensions")
        .and_then(|v| match v {
            Value::Object(map) => Some(map),
            _ => None,
        })
        .unwrap_or_default();
    results
        .retain(|key, value| !value.is_null() && key != "hmac_get_secret" && key != "hmacSecret");
    if let Some(prf) = prf {
        results.insert("prf".into(), prf);
    }
    obj.insert("clientExtensionResults".into(), Value::Object(results));
}

/// Publish `clientExtensionResults.prf.enabled`.
pub fn set_registration_prf(response: &mut Value, prf: Option<PrfRegistrationOutput>) {
    set_client_extension_results(response, prf.map(|p| json!({ "enabled": p.enabled })));
}

/// Publish `clientExtensionResults.prf.results`.
pub fn set_authentication_prf(response: &mut Value, prf: Option<PrfAuthenticationOutput>) {
    let prf = prf.map(|p| {
        let mut results = Map::new();
        results.insert("first".into(), json!(URL_SAFE_NO_PAD.encode(&p.first)));
        if let Some(second) = &p.second {
            results.insert("second".into(), json!(URL_SAFE_NO_PAD.encode(second)));
        }
        json!({ "results": Value::Object(results) })
    });
    set_client_extension_results(response, prf);
}

/// Enforce "unsupported PRF is web-shaped, not silent" for registration: when
/// the caller asked for PRF and no backend produced an output, report the
/// browser-shaped `prf.enabled = false` signal — exactly what a browser
/// reports for an authenticator without hmac-secret — rather than omitting
/// `prf` entirely.
pub fn registration_output_or_disabled(
    requested: bool,
    output: Option<PrfRegistrationOutput>,
) -> Option<PrfRegistrationOutput> {
    match output {
        Some(output) => Some(output),
        None if requested => Some(PrfRegistrationOutput { enabled: false }),
        None => None,
    }
}

/// Enforce the same invariant for authentication: silently returning no secret
/// when the caller passed salts risks unrecoverable user data, so this errors
/// instead of letting the assertion succeed with no `prf` in the response.
pub fn require_authentication_output(
    requested: bool,
    output: Option<PrfAuthenticationOutput>,
) -> crate::Result<Option<PrfAuthenticationOutput>> {
    match output {
        Some(output) => Ok(Some(output)),
        None if requested => Err(crate::Error::Unsupported(
            "PRF was requested but this authenticator/platform did not provide it".into(),
        )),
        None => Ok(None),
    }
}

/// Parse the flat top-level `prf` object the Swift and Kotlin bridges resolve.
/// No `prf` key means the platform didn't attempt PRF (`Ok(None)`); a `prf`
/// key present but malformed is a bridge bug and must not be mistaken for
/// "no PRF" — it is reported as an error instead of silently discarded.
///
/// Only used by the macOS/iOS/Android bridges, so other targets would
/// otherwise see it as dead code.
#[cfg_attr(
    not(any(target_os = "macos", target_os = "ios", target_os = "android")),
    allow(dead_code)
)]
pub fn registration_output_from_bridge(v: &Value) -> crate::Result<Option<PrfRegistrationOutput>> {
    let Some(prf) = v.get("prf") else {
        return Ok(None);
    };
    let enabled = prf.get("enabled").and_then(Value::as_bool).ok_or_else(|| {
        crate::Error::Authenticator("bridge prf output missing/invalid `enabled` field".into())
    })?;
    Ok(Some(PrfRegistrationOutput { enabled }))
}

/// Parse the flat top-level `prf` object the Swift and Kotlin bridges resolve.
/// Same "missing key means no PRF, malformed value is an error" rule as
/// [`registration_output_from_bridge`].
///
/// Only used by the macOS/iOS/Android bridges, so other targets would
/// otherwise see it as dead code.
#[cfg_attr(
    not(any(target_os = "macos", target_os = "ios", target_os = "android")),
    allow(dead_code)
)]
pub fn authentication_output_from_bridge(
    v: &Value,
) -> crate::Result<Option<PrfAuthenticationOutput>> {
    let Some(prf) = v.get("prf") else {
        return Ok(None);
    };
    let decode = |key: &str| -> crate::Result<Option<Vec<u8>>> {
        let Some(s) = prf.get(key).and_then(Value::as_str) else {
            return Ok(None);
        };
        URL_SAFE_NO_PAD.decode(s).map(Some).map_err(|e| {
            crate::Error::Authenticator(format!("bridge prf.{key} is not valid base64url: {e}"))
        })
    };
    let Some(first) = decode("first")? else {
        return Err(crate::Error::Authenticator(
            "bridge prf output is missing the required `first` field".into(),
        ));
    };
    let second = decode("second")?;
    Ok(Some(PrfAuthenticationOutput { first, second }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    // SHA-256("WebAuthn PRF" || 0x00 || "salt1"), computed from the spec definition.
    const SALT1_DERIVED: &str = "2a1990f9c9bbfe1bbf56abee2b5a0f59be5f633a35c2a5f07d85533eeecbdd3c";

    fn hex(bytes: &[u8]) -> String {
        bytes.iter().map(|b| format!("{b:02x}")).collect()
    }

    #[test]
    fn ctap_salt_matches_the_spec_vector() {
        assert_eq!(hex(&ctap_salt(b"salt1")), SALT1_DERIVED);
    }

    #[test]
    fn ctap_salt_accepts_any_input_length() {
        // Browser PRF salts are arbitrary length; the digest is always 32 bytes.
        assert_eq!(ctap_salt(b"").len(), 32);
        assert_eq!(ctap_salt(&[0u8; 64]).len(), 32);
        assert_ne!(ctap_salt(b"a"), ctap_salt(b"b"));
    }

    #[test]
    fn registration_input_detects_prf() {
        let options = json!({ "extensions": { "prf": {} } });
        assert!(registration_input_from_options(&options).unwrap().is_some());
    }

    #[test]
    fn registration_input_absent_without_prf() {
        assert!(registration_input_from_options(&json!({}))
            .unwrap()
            .is_none());
        assert!(
            registration_input_from_options(&json!({ "extensions": {} }))
                .unwrap()
                .is_none()
        );
    }

    #[test]
    fn registration_input_rejects_eval() {
        let options = json!({ "extensions": { "prf": { "eval": { "first": "c2FsdDE" } } } });
        let err = registration_input_from_options(&options).unwrap_err();
        assert_eq!(err.kind(), "unsupported");
    }

    #[test]
    fn authentication_input_decodes_both_salts() {
        let options = json!({
            "extensions": { "prf": { "eval": { "first": "c2FsdDE", "second": "c2FsdDI" } } }
        });
        let input = authentication_input_from_options(&options)
            .unwrap()
            .unwrap();
        assert_eq!(input.first, b"salt1");
        assert_eq!(input.second.as_deref(), Some(&b"salt2"[..]));
    }

    #[test]
    fn authentication_input_accepts_non_32_byte_salts() {
        // "eA" is base64url for a single byte; browser PRF puts no length limit on salts.
        let options = json!({ "extensions": { "prf": { "eval": { "first": "eA" } } } });
        let input = authentication_input_from_options(&options)
            .unwrap()
            .unwrap();
        assert_eq!(input.first, b"x");
        assert!(input.second.is_none());
    }

    #[test]
    fn authentication_input_requires_eval_first() {
        let options = json!({ "extensions": { "prf": {} } });
        let err = authentication_input_from_options(&options).unwrap_err();
        assert_eq!(err.kind(), "validation");
    }

    #[test]
    fn authentication_input_rejects_bad_base64() {
        let options = json!({ "extensions": { "prf": { "eval": { "first": "!!!" } } } });
        let err = authentication_input_from_options(&options).unwrap_err();
        assert_eq!(err.kind(), "validation");
    }

    #[test]
    fn prf_inputs_are_written_into_options_json() {
        let mut options = json!({ "rpId": "example.com" });
        set_registration_prf_input(&mut options);
        assert_eq!(options["extensions"]["prf"], json!({}));

        let mut options = json!({ "rpId": "example.com" });
        set_authentication_prf_input(
            &mut options,
            &PrfAuthenticationInput {
                first: b"salt1".to_vec(),
                second: Some(b"salt2".to_vec()),
            },
        );
        assert_eq!(
            options["extensions"]["prf"]["eval"],
            json!({ "first": "c2FsdDE", "second": "c2FsdDI" })
        );
    }

    #[test]
    fn registration_output_becomes_client_extension_results() {
        // webauthn-rs-proto serializes credential extensions under `extensions`;
        // the browser contract is `clientExtensionResults`.
        let mut response = json!({ "id": "cred", "extensions": { "credProps": { "rk": true } } });
        set_registration_prf(&mut response, Some(PrfRegistrationOutput { enabled: true }));
        assert_eq!(
            response["clientExtensionResults"]["prf"],
            json!({ "enabled": true })
        );
        // pre-existing extension outputs survive the move
        assert_eq!(
            response["clientExtensionResults"]["credProps"],
            json!({ "rk": true })
        );
        assert!(response.get("extensions").is_none());
    }

    #[test]
    fn registration_output_absent_leaves_empty_client_extension_results() {
        let mut response = json!({ "id": "cred", "extensions": {} });
        set_registration_prf(&mut response, None);
        assert_eq!(response["clientExtensionResults"], json!({}));
        assert!(response.get("extensions").is_none());
    }

    #[test]
    fn authentication_output_becomes_prf_results() {
        let mut response = json!({ "id": "cred", "extensions": {} });
        set_authentication_prf(
            &mut response,
            Some(PrfAuthenticationOutput {
                first: b"secret".to_vec(),
                second: None,
            }),
        );
        assert_eq!(
            response["clientExtensionResults"]["prf"]["results"]["first"],
            json!("c2VjcmV0")
        );
        assert!(response["clientExtensionResults"]["prf"]["results"]
            .get("second")
            .is_none());
    }

    #[test]
    fn bridge_outputs_are_parsed_from_the_flat_prf_object() {
        // Both Swift bridges and the Kotlin plugin resolve a flat top-level `prf`.
        let v = json!({ "id": "cred", "prf": { "enabled": true } });
        assert_eq!(
            registration_output_from_bridge(&v).unwrap(),
            Some(PrfRegistrationOutput { enabled: true })
        );

        let v = json!({ "id": "cred", "prf": { "first": "c2VjcmV0", "second": "c2Vjb25k" } });
        assert_eq!(
            authentication_output_from_bridge(&v).unwrap(),
            Some(PrfAuthenticationOutput {
                first: b"secret".to_vec(),
                second: Some(b"second".to_vec()),
            })
        );

        assert!(registration_output_from_bridge(&json!({ "id": "cred" }))
            .unwrap()
            .is_none());
        assert!(authentication_output_from_bridge(&json!({ "id": "cred" }))
            .unwrap()
            .is_none());
    }

    #[test]
    fn bridge_registration_output_errors_on_malformed_enabled() {
        let err = registration_output_from_bridge(&json!({ "prf": { "enabled": "not-a-bool" } }))
            .unwrap_err();
        assert_eq!(err.kind(), "authenticator");
    }

    #[test]
    fn bridge_authentication_output_errors_on_bad_base64() {
        let err =
            authentication_output_from_bridge(&json!({ "prf": { "first": "!!!" } })).unwrap_err();
        assert_eq!(err.kind(), "authenticator");
    }

    #[test]
    fn bridge_authentication_output_errors_when_first_missing() {
        let err =
            authentication_output_from_bridge(&json!({ "prf": { "second": "eA" } })).unwrap_err();
        assert_eq!(err.kind(), "authenticator");
    }

    #[test]
    fn registration_output_or_disabled_reports_false_when_requested_but_missing() {
        assert_eq!(
            registration_output_or_disabled(true, None),
            Some(PrfRegistrationOutput { enabled: false })
        );
    }

    #[test]
    fn registration_output_or_disabled_passes_through_when_present() {
        assert_eq!(
            registration_output_or_disabled(true, Some(PrfRegistrationOutput { enabled: true })),
            Some(PrfRegistrationOutput { enabled: true })
        );
    }

    #[test]
    fn registration_output_or_disabled_stays_none_when_not_requested() {
        assert_eq!(registration_output_or_disabled(false, None), None);
    }

    #[test]
    fn require_authentication_output_errors_when_requested_but_missing() {
        let err = require_authentication_output(true, None).unwrap_err();
        assert_eq!(err.kind(), "unsupported");
    }

    #[test]
    fn require_authentication_output_passes_through_when_present() {
        let output = PrfAuthenticationOutput {
            first: b"secret".to_vec(),
            second: None,
        };
        assert_eq!(
            require_authentication_output(true, Some(output.clone())).unwrap(),
            Some(output)
        );
    }

    #[test]
    fn require_authentication_output_ok_none_when_not_requested() {
        assert!(require_authentication_output(false, None)
            .unwrap()
            .is_none());
    }
}
