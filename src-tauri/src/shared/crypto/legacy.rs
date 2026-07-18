use aes::cipher::{block_padding::Pkcs7, BlockDecryptMut, KeyIvInit};
use aes::Aes256;
use base64::Engine as _;
use cbc::Decryptor;

use super::super::AppError;

fn evp_bytes_to_key(password: &[u8], salt: &[u8]) -> (Vec<u8>, Vec<u8>) {
    let mut derived = Vec::new();
    let mut prev = [0u8; 16];
    while derived.len() < 48 {
        let mut ctx = md5::Context::new();
        ctx.consume(&prev);
        ctx.consume(password);
        ctx.consume(salt);
        prev = ctx.compute().0;
        derived.extend_from_slice(&prev);
    }
    let key = derived[..32].to_vec();
    let iv = derived[32..48].to_vec();
    (key, iv)
}

pub(crate) fn decrypt_legacy_cryptojs_note(
    ciphertext_b64: &str,
    password: &str,
) -> Result<String, AppError> {
    let raw = base64::Engine::decode(&base64::engine::general_purpose::STANDARD, ciphertext_b64)?;
    if raw.len() < 16 || &raw[..8] != b"Salted__" {
        return Err(AppError::Crypto("Not a valid CryptoJS ciphertext".into()));
    }
    let salt = &raw[8..16];
    let ciphertext = &raw[16..];

    let (key, iv) = evp_bytes_to_key(password.as_bytes(), salt);

    type Aes256CbcDec = Decryptor<Aes256>;
    let mut buf = ciphertext.to_vec();
    let plaintext = Aes256CbcDec::new_from_slices(&key, &iv)
        .map_err(|e| AppError::Crypto(format!("CBC init: {e}")))?
        .decrypt_padded_mut::<Pkcs7>(&mut buf)
        .map_err(|_| AppError::Crypto("Decryption failed".into()))?;

    String::from_utf8(plaintext.to_vec())
        .map_err(|e| AppError::Crypto(format!("UTF-8 decode: {e}")))
}
