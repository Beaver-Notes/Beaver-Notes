#[cfg(test)]
mod characterization {
    use crate::shared::crypto::keys::derive_kek_argon2id;

    /// Characterization vector for argon2id key derivation. The expected bytes
    /// were captured from the original `crypto.rs` before the module split and
    /// must remain identical (no behavior change allowed).
    #[test]
    fn derive_kek_argon2id_known_vector() {
        let salt = [0x42u8; 16];
        let key = derive_kek_argon2id("test-passphrase", &salt).unwrap();
        assert_eq!(
            key,
            [
                161, 89, 29, 42, 191, 198, 18, 46, 235, 81, 99, 169, 119, 148, 147, 236, 183,
                128, 71, 226, 177, 220, 46, 132, 194, 91, 45, 12, 140, 161, 99, 117
            ]
        );
    }

    /// Round-trip: a note encrypted for storage can be decrypted back.
    #[test]
    fn note_content_round_trip() {
        use crate::shared::crypto::keys::{encrypt_note_content_for_storage, decrypt_native_note_content};
        use crate::shared::AppState;
        
        

        let state = AppState::new(std::path::PathBuf::new(), std::path::PathBuf::new(), None);
        // Inject a fake unlocked key + session.
        {
            let mut s = state.crypto.session.write().unwrap();
            s.app_data_key = Some([7u8; 32]);
            s.current_items_key_id = "k1".to_string();
            s.active = true;
        }

        let content = serde_json::json!({"text": "hello", "nested": {"x": 1}});
        let enc = encrypt_note_content_for_storage(&state, &content).unwrap();
        assert!(crate::shared::crypto::keys::note_content_is_native_encrypted(&enc));
        let dec = decrypt_native_note_content(&state, &enc).unwrap().unwrap();
        assert_eq!(dec, content);
    }

    /// Asset round-trip: encrypt/decrypt raw bytes with a key.
    #[test]
    fn asset_bytes_round_trip() {
        use crate::shared::crypto::assets::{
            decrypt_asset_bytes_with_key, encrypt_asset_bytes_with_key, is_encrypted_asset_buffer,
        };
        let key = [3u8; 32];
        let plain = b"binary\x00asset\xFFdata";
        let enc = encrypt_asset_bytes_with_key(plain, &key).unwrap();
        assert!(is_encrypted_asset_buffer(&enc));
        let dec = decrypt_asset_bytes_with_key(&enc, &key).unwrap();
        assert_eq!(dec, plain);
    }

    /// Yjs blob round-trip.
    #[test]
    fn yjs_blob_round_trip() {
        use crate::shared::crypto::assets::{
            decrypt_yjs_blob, encrypt_yjs_blob, is_encrypted_yjs_blob,
        };
        let key = [9u8; 32];
        let data = b"\x01\x02\x03yjs-update-bytes";
        let enc = encrypt_yjs_blob(&key, data).unwrap();
        assert!(is_encrypted_yjs_blob(&enc));
        let dec = decrypt_yjs_blob(&key, &enc).unwrap();
        assert_eq!(dec, data);
    }
}
