#[cfg(test)]
mod characterization {
    use base64::Engine;
    use crate::shared::crypto::keys::{
        aead_decrypt_bytes, aead_encrypt_bytes, derive_kek_argon2id,
    };

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

    /// Sync ciphertext must round-trip and reject any authenticated-byte change.
    #[test]
    fn sync_payload_authenticates_ciphertext() {
        let key = [0x42u8; 32];
        let aad = "remote-note-a-201";
        let plaintext = b"yjs-update";
        let (iv, enc) = aead_encrypt_bytes(&key, plaintext, aad).unwrap();

        assert_eq!(aead_decrypt_bytes(&key, &iv, &enc, aad).unwrap(), plaintext);

        let mut tampered = base64::engine::general_purpose::STANDARD
            .decode(&enc)
            .unwrap();
        tampered[0] ^= 1;
        let tampered = base64::engine::general_purpose::STANDARD.encode(tampered);
        assert!(matches!(
            aead_decrypt_bytes(&key, &iv, &tampered, aad),
            Err(crate::shared::error::AppError::WrongPassword)
        ));
    }

    /// Assets written by the non-streaming encryptor (`encrypt_asset_bytes_with_key`,
    /// used by fs:writeFile and migration) are a single chunk whose length can
    /// exceed STREAM_CHUNK_SIZE. The streaming decryptor must accept them.
    #[test]
    fn asset_streaming_decrypt_accepts_large_single_chunk() {
        use crate::shared::crypto::assets::{
            decrypt_asset_streaming, encrypt_asset_bytes_with_key,
        };
        use crate::shared::crypto::keys::STREAM_CHUNK_SIZE;

        let key = [11u8; 32];
        let plain = vec![0xABu8; STREAM_CHUNK_SIZE + 1024];
        let enc = encrypt_asset_bytes_with_key(&plain, &key).unwrap();

        let dir = std::env::temp_dir().join(format!(
            "asset-stream-test-{}",
            std::process::id()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let src = dir.join("large.bin");
        let out = dir.join("large.dec");
        std::fs::write(&src, &enc).unwrap();

        let result = decrypt_asset_streaming(&src, &out, &key);
        let decrypted = std::fs::read(&out);
        let _ = std::fs::remove_dir_all(&dir);

        result.expect("large single-chunk asset must stream-decrypt");
        assert_eq!(decrypted.unwrap(), plain);
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
