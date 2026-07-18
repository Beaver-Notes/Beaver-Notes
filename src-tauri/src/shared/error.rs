use std::fmt;

#[derive(Debug)]
pub(crate) enum AppError {
    Io(std::io::Error),
    Crypto(String),
    Serialization(String),
    WrongPassword,
    EncryptionLocked,
    Other(String),
}

impl fmt::Display for AppError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            AppError::Io(e) => write!(f, "{e}"),
            AppError::Crypto(m) => f.write_str(m),
            AppError::Serialization(m) => f.write_str(m),
            AppError::WrongPassword => f.write_str("Wrong password."),
            AppError::EncryptionLocked => {
                f.write_str("App encryption is locked. Unlock before reading assets.")
            }
            AppError::Other(m) => f.write_str(m),
        }
    }
}

impl AppError {
    pub(crate) fn kind(&self) -> &'static str {
        match self {
            AppError::Io(_) => "Io",
            AppError::Crypto(_) => "Crypto",
            AppError::Serialization(_) => "Serialization",
            AppError::WrongPassword => "WrongPassword",
            AppError::EncryptionLocked => "EncryptionLocked",
            AppError::Other(_) => "Other",
        }
    }
}

impl serde::Serialize for AppError {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeStruct;
        let mut state = serializer.serialize_struct("AppError", 2)?;
        state.serialize_field("kind", self.kind())?;
        state.serialize_field("message", &self.to_string())?;
        state.end()
    }
}

impl From<std::io::Error> for AppError {
    fn from(e: std::io::Error) -> Self {
        AppError::Io(e)
    }
}

impl From<serde_json::Error> for AppError {
    fn from(e: serde_json::Error) -> Self {
        AppError::Serialization(e.to_string())
    }
}

impl From<aes_gcm::Error> for AppError {
    fn from(_e: aes_gcm::Error) -> Self {
        AppError::Crypto("Encryption operation failed.".into())
    }
}

impl From<base64::DecodeError> for AppError {
    fn from(e: base64::DecodeError) -> Self {
        AppError::Crypto(e.to_string())
    }
}

impl From<hex::FromHexError> for AppError {
    fn from(e: hex::FromHexError) -> Self {
        AppError::Crypto(e.to_string())
    }
}

impl From<argon2::password_hash::Error> for AppError {
    fn from(e: argon2::password_hash::Error) -> Self {
        AppError::Crypto(e.to_string())
    }
}

impl<T: fmt::Debug> From<std::sync::PoisonError<T>> for AppError {
    fn from(e: std::sync::PoisonError<T>) -> Self {
        AppError::Other(e.to_string())
    }
}

impl From<argon2::Error> for AppError {
    fn from(e: argon2::Error) -> Self {
        AppError::Crypto(e.to_string())
    }
}

impl From<String> for AppError {
    fn from(s: String) -> Self {
        AppError::Other(s)
    }
}

impl From<&str> for AppError {
    fn from(s: &str) -> Self {
        AppError::Other(s.to_string())
    }
}

impl From<AppError> for String {
    fn from(e: AppError) -> Self {
        e.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn display_wrong_password() {
        assert_eq!(AppError::WrongPassword.to_string(), "Wrong password.");
    }

    #[test]
    fn display_encryption_locked() {
        assert_eq!(
            AppError::EncryptionLocked.to_string(),
            "App encryption is locked. Unlock before reading assets."
        );
    }

    #[test]
    fn display_crypto_carries_message() {
        assert_eq!(
            AppError::Crypto("boom".to_string()).to_string(),
            "boom"
        );
    }

    #[test]
    fn display_serialization_carries_message() {
        assert_eq!(
            AppError::Serialization("bad json".to_string()).to_string(),
            "bad json"
        );
    }

    #[test]
    fn display_other_carries_message() {
        assert_eq!(AppError::Other("oops".to_string()).to_string(), "oops");
    }

    #[test]
    fn display_io_carries_inner_error() {
        let err = AppError::Io(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            "missing file",
        ));
        assert_eq!(err.to_string(), "missing file");
    }

    #[test]
    fn serialize_emits_structured_kind_and_message() {
        let value = serde_json::to_value(AppError::WrongPassword).unwrap();
        assert_eq!(
            value,
            serde_json::json!({ "kind": "WrongPassword", "message": "Wrong password." })
        );
    }

    #[test]
    fn serialize_io_carries_kind_and_inner_message() {
        let err = AppError::Io(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            "missing file",
        ));
        let value = serde_json::to_value(err).unwrap();
        assert_eq!(
            value,
            serde_json::json!({ "kind": "Io", "message": "missing file" })
        );
    }

    #[test]
    fn kind_discriminator_matches_variant_name() {
        assert_eq!(AppError::WrongPassword.kind(), "WrongPassword");
        assert_eq!(AppError::EncryptionLocked.kind(), "EncryptionLocked");
        assert_eq!(AppError::Io(std::io::Error::new(std::io::ErrorKind::Other, "x")).kind(), "Io");
        assert_eq!(AppError::Crypto("x".into()).kind(), "Crypto");
        assert_eq!(AppError::Serialization("x".into()).kind(), "Serialization");
        assert_eq!(AppError::Other("x".into()).kind(), "Other");
    }
}


