#[cfg(test)]
mod characterization {
    use crate::shared::crypto::keys::{aead_decrypt_bytes, aead_encrypt_bytes};
    use base64::Engine;

    /// Characterization vector for argon2id under the legacy parameters
    /// (t=2, m=32MiB, p=2), pinned explicitly so bumping module defaults does
    /// not invalidate it. Pre-bump vaults must derive the same KEK forever.
    #[test]
    fn derive_kek_argon2id_known_vector() {
        use crate::shared::crypto::keys::derive_kek_argon2id_with_params;

        let salt = [0x42u8; 16];
        let key =
            derive_kek_argon2id_with_params("test-passphrase", &salt, 32 * 1024, 2, 2).unwrap();
        assert_eq!(
            key,
            [
                221, 42, 242, 15, 75, 62, 8, 70, 81, 192, 238, 53, 164, 126, 41, 147, 78, 46, 214,
                162, 6, 159, 190, 121, 43, 176, 60, 127, 207, 195, 201, 2
            ]
        );
    }

    /// The `derive_argon2_key` command is the sole derivation path for
    /// historical v3 Argon2-locked notes via the legacy Electron migration
    /// flow (src/utils/migration/legacyElectron.js): it must stay pinned to
    /// the explicit legacy numbers (m=32768 KiB / t=2 / p=2) even if the
    /// module defaults are bumped again.
    #[tokio::test]
    async fn derive_argon2_key_command_is_pinned_to_legacy_kdf_params() {
        use crate::commands::security::derive_argon2_key;
        use crate::shared::crypto::keys::derive_kek_argon2id_with_params;

        let passphrase = "test-passphrase";
        let salt = [0x42u8; 16];

        let hex_out = derive_argon2_key(passphrase.to_string(), Some(hex::encode(salt)))
            .await
            .expect("command derive");
        let from_command = hex::decode(&hex_out).unwrap();

        // Explicit legacy constants on purpose: module constants would let a
        // defaults bump silently invalidate every historical note.
        let expected = derive_kek_argon2id_with_params(passphrase, &salt, 32768, 2, 2).unwrap();
        assert_eq!(from_command, expected);

        let known_vector: [u8; 32] = [
            221, 42, 242, 15, 75, 62, 8, 70, 81, 192, 238, 53, 164, 126, 41, 147, 78, 46, 214, 162,
            6, 159, 190, 121, 43, 176, 60, 127, 207, 195, 201, 2,
        ];
        assert_eq!(from_command, known_vector);
    }

    /// New vaults must use Amendment 1 KDF parameters (128 MiB, t=3, p=4);
    /// existing vaults are unaffected (per-vault manifest params).
    #[test]
    fn new_manifests_use_amendment1_kdf_params() {
        use crate::shared::crypto::keys::create_encryption_manifest;

        let (manifest, _data, _kek) =
            create_encryption_manifest("personal", "check", "correct horse").unwrap();
        assert_eq!(manifest.argon2_memory_kib, Some(131_072));
        assert_eq!(manifest.argon2_iterations, Some(3));
        assert_eq!(manifest.argon2_parallelism, Some(4));
    }

    /// A vault created under older Argon2id params keeps unlocking: the KEK is
    /// derived from the manifest's stored params, not current constants.
    #[test]
    fn derive_kek_from_manifest_respects_stored_argon2_params() {
        use crate::shared::crypto::keys::{
            create_encryption_manifest, derive_kek_argon2id_with_params, derive_kek_from_manifest,
        };

        let passphrase = "test-passphrase";
        let (mut manifest, _, _) = create_encryption_manifest("app", "check", passphrase).unwrap();
        // Simulate a vault created under the previous (16MiB) parameters.
        manifest.argon2_memory_kib = Some(16 * 1024);
        manifest.argon2_iterations = Some(2);
        manifest.argon2_parallelism = Some(2);

        let salt = hex::decode(manifest.argon2_salt_hex.as_ref().unwrap()).unwrap();
        let from_manifest = derive_kek_from_manifest(&manifest, passphrase).unwrap();
        let expected = derive_kek_argon2id_with_params(passphrase, &salt, 16 * 1024, 2, 2).unwrap();
        assert_eq!(from_manifest, expected);
    }

    /// Sync vault join must derive with the params' stored Argon2 settings —
    /// a WrongPassword here means the derive ignored them and used defaults.
    #[test]
    fn derive_items_key_from_params_respects_stored_argon2_memory() {
        use crate::shared::crypto::keys::{
            create_encryption_manifest, derive_items_key_from_params,
            derive_kek_argon2id_with_params, encrypt_bytes_with_key, KeyParams, PROTOCOL_VERSION,
        };
        use base64::Engine;

        let passphrase = "test-passphrase";
        let (manifest, data_key, _) =
            create_encryption_manifest("app", "check", passphrase).unwrap();

        // Simulate a 16 MiB vault: derive a 16 MiB KEK and wrap the same key.
        let salt = hex::decode(manifest.argon2_salt_hex.as_ref().unwrap()).unwrap();
        let kek_16mb = derive_kek_argon2id_with_params(passphrase, &salt, 16 * 1024, 2, 2).unwrap();
        let wrapped_16mb = encrypt_bytes_with_key(&kek_16mb, &data_key).unwrap();

        let params = KeyParams {
            version: PROTOCOL_VERSION,
            kdf: "argon2id".to_string(),
            salt_hex: manifest
                .argon2_salt_hex
                .clone()
                .unwrap_or(manifest.salt_hex),
            argon2_memory_kib: 16 * 1024,
            argon2_iterations: 2,
            argon2_parallelism: 2,
            wrapped_items_key: wrapped_16mb,
        };

        let (items_key, _kek) = derive_items_key_from_params(&params, passphrase).unwrap();
        assert_eq!(items_key, data_key);

        // Wrong passphrase still fails cleanly.
        assert!(matches!(
            derive_items_key_from_params(&params, "wrong-passphrase"),
            Err(crate::shared::error::AppError::WrongPassword)
        ));
    }

    #[test]
    fn note_content_round_trip() {
        use crate::shared::crypto::keys::{
            decrypt_native_note_content, encrypt_note_content_for_storage,
        };
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

    /// Non-streaming encryptor output (fs:writeFile, migration) can be a
    /// single chunk longer than STREAM_CHUNK_SIZE; streaming decrypt must accept.
    #[test]
    fn asset_streaming_decrypt_accepts_large_single_chunk() {
        use crate::shared::crypto::assets::{
            decrypt_asset_streaming, encrypt_asset_bytes_with_key,
        };
        use crate::shared::crypto::keys::STREAM_CHUNK_SIZE;

        let key = [11u8; 32];
        let plain = vec![0xABu8; STREAM_CHUNK_SIZE + 1024];
        let enc = encrypt_asset_bytes_with_key(&plain, &key).unwrap();

        let dir = std::env::temp_dir().join(format!("asset-stream-test-{}", std::process::id()));
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

    #[test]
    fn vault_proof_is_deterministic_and_domain_bound() {
        use crate::commands::security::vault_proof_impl;

        let a = vault_proof_impl("pw", "ws-1", "blob");
        let b = vault_proof_impl("pw", "ws-1", "blob");
        let c = vault_proof_impl("pw", "ws-2", "blob");
        assert_eq!(a, b);
        assert_ne!(a, c);
    }
}
