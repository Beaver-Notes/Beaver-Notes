use serde::{ser::Serializer, Serialize};

pub type Result<T> = std::result::Result<T, Error>;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[cfg(mobile)]
    #[error(transparent)]
    PluginInvoke(#[from] tauri::plugin::mobile::PluginInvokeError),
    #[cfg(all(desktop, windows))]
    #[error("WebAuthn error: {0:?}")]
    WebAuthn(webauthn_authenticator_rs::error::WebauthnCError),
    #[error(transparent)]
    SerdeJson(#[from] serde_json::Error),
    #[error("No token found")]
    NoToken,
    #[error("Validation error: {0}")]
    Validation(String),
    #[error("Authenticator error: {0}")]
    Authenticator(String),
    #[error("Unsupported on this platform: {0}")]
    Unsupported(String),
    #[cfg(not(any(
        target_os = "android",
        target_os = "ios",
        target_os = "windows",
        target_os = "macos"
    )))]
    #[error(transparent)]
    Ctap2(#[from] authenticator::errors::AuthenticatorError),
    #[cfg(not(any(
        target_os = "android",
        target_os = "ios",
        target_os = "windows",
        target_os = "macos"
    )))]
    #[error(transparent)]
    Cbor2(#[from] serde_cbor_2::Error),
}

impl Error {
    /// Stable, camelCase discriminant sent to the webview. Documented in the
    /// README as a non-exhaustive set; add new kinds in minor releases only.
    pub fn kind(&self) -> &'static str {
        match self {
            Error::Io(_) => "io",
            #[cfg(mobile)]
            Error::PluginInvoke(_) => "platform",
            #[cfg(all(desktop, windows))]
            Error::WebAuthn(_) => "platform",
            Error::SerdeJson(_) => "serialization",
            Error::NoToken => "noToken",
            Error::Validation(_) => "validation",
            Error::Authenticator(_) => "authenticator",
            Error::Unsupported(_) => "unsupported",
            #[cfg(not(any(
                target_os = "android",
                target_os = "ios",
                target_os = "windows",
                target_os = "macos"
            )))]
            Error::Ctap2(_) => "authenticator",
            #[cfg(not(any(
                target_os = "android",
                target_os = "ios",
                target_os = "windows",
                target_os = "macos"
            )))]
            Error::Cbor2(_) => "serialization",
        }
    }
}

impl Serialize for Error {
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut state = serializer.serialize_struct("Error", 2)?;
        state.serialize_field("kind", self.kind())?;
        state.serialize_field("message", &self.to_string())?;
        state.end()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // The webview receives errors as {"kind": ..., "message": ...}. These tests
    // pin that contract; the JS PasskeyError type in guest-js/index.ts and the
    // README's error documentation must stay in sync with it.
    #[test]
    fn serializes_to_kind_and_message() {
        let value: serde_json::Value =
            serde_json::to_value(Error::Validation("bad rp_id".to_string())).unwrap();
        assert_eq!(value["kind"], "validation");
        assert_eq!(value["message"], "Validation error: bad rp_id");
    }

    #[test]
    fn authenticator_error_kind() {
        let value: serde_json::Value =
            serde_json::to_value(Error::Authenticator("no credential id".to_string())).unwrap();
        assert_eq!(value["kind"], "authenticator");
        assert_eq!(value["message"], "Authenticator error: no credential id");
    }

    #[test]
    fn unit_variant_kind_and_message() {
        let value: serde_json::Value = serde_json::to_value(Error::NoToken).unwrap();
        assert_eq!(value["kind"], "noToken");
        assert_eq!(value["message"], "No token found");
    }

    #[test]
    fn io_and_serde_kinds() {
        let io = Error::Io(std::io::Error::other("disk on fire"));
        assert_eq!(io.kind(), "io");
        let bad_json = serde_json::from_str::<serde_json::Value>("{").unwrap_err();
        assert_eq!(Error::SerdeJson(bad_json).kind(), "serialization");
    }

    #[test]
    fn serialized_error_is_an_object_with_exactly_two_fields() {
        let value: serde_json::Value =
            serde_json::to_value(Error::Validation("x".to_string())).unwrap();
        let obj = value
            .as_object()
            .expect("error must serialize to an object");
        assert_eq!(obj.len(), 2);
        assert!(obj.contains_key("kind") && obj.contains_key("message"));
    }
}
