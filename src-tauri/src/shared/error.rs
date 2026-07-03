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

impl serde::Serialize for AppError {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
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


