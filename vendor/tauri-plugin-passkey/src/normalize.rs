//! Reconciles browser WebAuthn JSON with `webauthn-rs-proto`'s deserializer.
//!
//! The one remaining gap: `authenticatorSelection.requireResidentKey` has no serde
//! default in the proto crate, so a spec-compliant client that omits it (the DOM
//! type marks it optional and deprecated) fails to deserialize. PRF is not handled
//! here — see [`crate::prf`].

use serde_json::Value;
use webauthn_rs_proto::{
    AuthenticatorSelectionCriteria, PublicKeyCredentialCreationOptions, ResidentKeyRequirement,
};

/// Android's Credential Manager only creates discoverable credentials, and will
/// not persist the passkey unless a resident key is requested. Fill in the default
/// when the caller said nothing, honour an explicit `preferred`/`required`, and
/// refuse `discouraged` rather than silently doing the opposite.
///
/// Only called from `authenticators::mobile` on `target_os = "android"`; the
/// `mod normalize` in `lib.rs` isn't `pub`, so on other hosts rustc sees this as
/// unreachable and would flag it dead code.
#[cfg_attr(not(target_os = "android"), allow(dead_code))]
pub fn apply_android_resident_key(
    options: &mut PublicKeyCredentialCreationOptions,
) -> crate::Result<()> {
    let selection = options
        .authenticator_selection
        .get_or_insert(AuthenticatorSelectionCriteria {
            authenticator_attachment: None,
            resident_key: None,
            require_resident_key: false,
            user_verification: webauthn_rs_proto::UserVerificationPolicy::Preferred,
        });

    match selection.resident_key {
        Some(ResidentKeyRequirement::Discouraged) => Err(crate::Error::Unsupported(
            "Android Credential Manager only creates discoverable credentials; \
             residentKey \"discouraged\" is not supported"
                .into(),
        )),
        Some(_) => Ok(()),
        // WebAuthn Level 1 compatibility, matching CTAP2's `convert_resident_key`:
        // an explicit `requireResidentKey: true` with `residentKey` absent still
        // means "required" here, not "preferred" — otherwise the same options
        // would mean different things on Android than on Linux.
        None if selection.require_resident_key => {
            selection.resident_key = Some(ResidentKeyRequirement::Required);
            Ok(())
        }
        None => {
            selection.resident_key = Some(ResidentKeyRequirement::Preferred);
            selection.require_resident_key = false;
            Ok(())
        }
    }
}

/// Fill in `requireResidentKey` from `residentKey` when the caller omitted it.
pub fn default_require_resident_key(options: &mut Value) {
    let Some(selection) = options
        .get_mut("authenticatorSelection")
        .and_then(Value::as_object_mut)
    else {
        return;
    };
    if selection.contains_key("requireResidentKey") {
        return;
    }
    // residentKey "required" implies a resident key; anything else does not.
    let required = selection.get("residentKey").and_then(Value::as_str) == Some("required");
    selection.insert("requireResidentKey".into(), Value::Bool(required));
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use webauthn_rs_proto::{AuthenticatorSelectionCriteria, ResidentKeyRequirement};

    fn selection(resident_key: Option<ResidentKeyRequirement>) -> AuthenticatorSelectionCriteria {
        AuthenticatorSelectionCriteria {
            authenticator_attachment: None,
            resident_key,
            require_resident_key: false,
            user_verification: webauthn_rs_proto::UserVerificationPolicy::Preferred,
        }
    }

    fn creation_options(
        selection: Option<AuthenticatorSelectionCriteria>,
    ) -> webauthn_rs_proto::PublicKeyCredentialCreationOptions {
        let mut options: webauthn_rs_proto::PublicKeyCredentialCreationOptions =
            serde_json::from_value(json!({
                "rp": { "id": "example.com", "name": "Example" },
                "user": { "id": "dXNlci1pZA", "name": "alice", "displayName": "Alice" },
                "challenge": "Y2hhbGxlbmdlLWJ5dGVz",
                "pubKeyCredParams": [{ "type": "public-key", "alg": -7 }]
            }))
            .unwrap();
        options.authenticator_selection = selection;
        options
    }

    #[test]
    fn android_defaults_unset_resident_key_to_preferred() {
        let mut options = creation_options(None);
        apply_android_resident_key(&mut options).unwrap();
        assert!(matches!(
            options.authenticator_selection.unwrap().resident_key,
            Some(ResidentKeyRequirement::Preferred)
        ));
    }

    #[test]
    fn android_honours_explicit_require_resident_key_when_resident_key_absent() {
        // `commands.rs`'s `default_require_resident_key` preserves a caller's
        // explicit `requireResidentKey: true` even when `residentKey` is absent;
        // Android must not then downgrade it to "preferred" (that would mean
        // "required" on Linux/CTAP2 but "preferred" on Android for identical
        // input options).
        let mut options = creation_options(Some(AuthenticatorSelectionCriteria {
            authenticator_attachment: None,
            resident_key: None,
            require_resident_key: true,
            user_verification: webauthn_rs_proto::UserVerificationPolicy::Preferred,
        }));
        apply_android_resident_key(&mut options).unwrap();
        assert!(matches!(
            options.authenticator_selection.unwrap().resident_key,
            Some(ResidentKeyRequirement::Required)
        ));
    }

    #[test]
    fn android_preserves_required_resident_key() {
        let mut options = creation_options(Some(selection(Some(ResidentKeyRequirement::Required))));
        apply_android_resident_key(&mut options).unwrap();
        assert!(matches!(
            options.authenticator_selection.unwrap().resident_key,
            Some(ResidentKeyRequirement::Required)
        ));
    }

    #[test]
    fn android_rejects_discouraged_resident_key() {
        let mut options =
            creation_options(Some(selection(Some(ResidentKeyRequirement::Discouraged))));
        let err = apply_android_resident_key(&mut options).unwrap_err();
        assert_eq!(err.kind(), "unsupported");
    }

    #[test]
    fn defaults_require_resident_key_when_absent() {
        let mut options = json!({
            "authenticatorSelection": { "residentKey": "discouraged", "userVerification": "required" }
        });
        default_require_resident_key(&mut options);
        assert_eq!(
            options["authenticatorSelection"]["requireResidentKey"],
            json!(false)
        );
    }

    #[test]
    fn require_resident_key_true_when_resident_key_required() {
        let mut options = json!({ "authenticatorSelection": { "residentKey": "required" } });
        default_require_resident_key(&mut options);
        assert_eq!(
            options["authenticatorSelection"]["requireResidentKey"],
            json!(true)
        );
    }

    #[test]
    fn does_not_clobber_explicit_require_resident_key() {
        let mut options = json!({
            "authenticatorSelection": { "residentKey": "required", "requireResidentKey": false }
        });
        default_require_resident_key(&mut options);
        assert_eq!(
            options["authenticatorSelection"]["requireResidentKey"],
            json!(false)
        );
    }
}
