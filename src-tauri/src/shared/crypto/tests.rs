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

    /// derive_argon2_key is sole path for v3 locked notes via legacy migration: pinned to m=32768 KiB/t=2/p=2.
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

    /// Vault join must derive with stored Argon2 settings: WrongPassword means defaults were used.
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

        // Simulate a 128 MiB vault: derive a 128 MiB KEK and wrap the same key.
        let salt = hex::decode(manifest.argon2_salt_hex.as_ref().unwrap()).unwrap();
        let kek_16mb = derive_kek_argon2id_with_params(passphrase, &salt, 128 * 1024, 3, 4).unwrap();
        let wrapped_16mb = encrypt_bytes_with_key(&kek_16mb, &data_key).unwrap();

        let params = KeyParams {
            version: PROTOCOL_VERSION,
            kdf: "argon2id".to_string(),
            salt_hex: manifest
                .argon2_salt_hex
                .clone()
                .unwrap_or(manifest.salt_hex),
            argon2_memory_kib: 128 * 1024,
            argon2_iterations: 3,
            argon2_parallelism: 4,
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

#[cfg(test)]
mod vault_join {
    use crate::shared::crypto::keys::{
        create_encryption_manifest, derive_items_key_from_params, generate_recovery_code,
        key_params_from_manifest, recover_key_from_code, remote_params_differ,
        unlock_key_from_manifest, KeyParams,
    };
    use crate::shared::error::AppError;

    const SCOPE: &str = "app";
    const CHECK: &str = "password-check";
    const PW: &str = "correct horse battery staple";

    #[test]
    fn create_then_unlock_roundtrip() {
        let (manifest, data_key, kek) = create_encryption_manifest(SCOPE, CHECK, PW).unwrap();
        let (key, kek2) = unlock_key_from_manifest(&manifest, PW, SCOPE, CHECK).unwrap();
        assert_eq!(key, data_key);
        assert_eq!(kek2, kek);
    }

    #[test]
    fn unlock_wrong_password_fails_cleanly() {
        let (manifest, _, _) = create_encryption_manifest(SCOPE, CHECK, PW).unwrap();
        assert!(matches!(
            unlock_key_from_manifest(&manifest, "wrong", SCOPE, CHECK),
            Err(AppError::WrongPassword)
        ));
    }

    #[test]
    fn unlock_wrong_scope_fails() {
        let (manifest, _, _) = create_encryption_manifest(SCOPE, CHECK, PW).unwrap();
        assert!(matches!(
            unlock_key_from_manifest(&manifest, PW, "other-scope", CHECK),
            Err(AppError::Crypto(_))
        ));
    }

    #[test]
    fn same_password_two_setups_diverge() {
        // Random salt per setup: same password alone must NEVER be treated as
        // the same vault. Join has to copy params, never re-derive.
        let (_, key_a, _) = create_encryption_manifest(SCOPE, CHECK, PW).unwrap();
        let (manifest_b, key_b, _) = create_encryption_manifest(SCOPE, CHECK, PW).unwrap();
        assert_ne!(key_a, key_b);
        // And B's params unlock B's key, never A's.
        let params_b = key_params_from_manifest(&manifest_b).unwrap();
        let (joined, _) = derive_items_key_from_params(&params_b, PW).unwrap();
        assert_eq!(joined, key_b);
        assert_ne!(joined, key_a);
    }

    #[test]
    fn copied_params_same_password_yield_same_key() {
        // The join primitive: device B adopts A's published params.
        let (manifest_a, key_a, _) = create_encryption_manifest(SCOPE, CHECK, PW).unwrap();
        let params = key_params_from_manifest(&manifest_a).unwrap();
        let (joined, _) = derive_items_key_from_params(&params, PW).unwrap();
        assert_eq!(joined, key_a);
    }

    #[test]
    fn key_params_json_roundtrip() {
        let (manifest, _, _) = create_encryption_manifest(SCOPE, CHECK, PW).unwrap();
        let params = key_params_from_manifest(&manifest).unwrap();
        let raw = serde_json::to_string(&params).unwrap();
        let back: KeyParams = serde_json::from_str(&raw).unwrap();
        assert_eq!(back.wrapped_items_key.nonce, params.wrapped_items_key.nonce);
        assert_eq!(back.wrapped_items_key.cipher, params.wrapped_items_key.cipher);
        assert_eq!(back.salt_hex, params.salt_hex);
        let (joined, _) = derive_items_key_from_params(&back, PW).unwrap();
        let (direct, _) = derive_items_key_from_params(&params, PW).unwrap();
        assert_eq!(joined, direct);
    }

    #[test]
    fn tampered_wrapped_key_fails() {
        let (manifest, _, _) = create_encryption_manifest(SCOPE, CHECK, PW).unwrap();
        let mut params = key_params_from_manifest(&manifest).unwrap();
        let mut cipher = params.wrapped_items_key.cipher.clone();
        let last = cipher.pop().unwrap();
        cipher.push(if last == 'A' { 'B' } else { 'A' });
        params.wrapped_items_key.cipher = cipher;
        assert!(derive_items_key_from_params(&params, PW).is_err());
    }

    #[test]
    fn downgrade_params_rejected() {
        let (manifest, _, _) = create_encryption_manifest(SCOPE, CHECK, PW).unwrap();
        let mut params = key_params_from_manifest(&manifest).unwrap();
        params.argon2_memory_kib = 1024;
        params.argon2_iterations = 1;
        params.argon2_parallelism = 1;
        assert!(matches!(
            derive_items_key_from_params(&params, PW),
            Err(AppError::Crypto(_))
        ));
    }

    #[test]
    fn unsupported_version_kdf_rejected() {
        let (manifest, _, _) = create_encryption_manifest(SCOPE, CHECK, PW).unwrap();
        let mut params = key_params_from_manifest(&manifest).unwrap();
        params.version = 0;
        assert!(derive_items_key_from_params(&params, PW).is_err());
        let mut params = key_params_from_manifest(&manifest).unwrap();
        params.kdf = "pbkdf2".to_string();
        assert!(derive_items_key_from_params(&params, PW).is_err());
    }

    #[test]
    fn remote_params_differ_detects_foreign_vault() {
        let (manifest_a, _, _) = create_encryption_manifest(SCOPE, CHECK, PW).unwrap();
        let (manifest_b, _, _) = create_encryption_manifest(SCOPE, CHECK, PW).unwrap();
        let params_a = key_params_from_manifest(&manifest_a).unwrap();
        let params_b = key_params_from_manifest(&manifest_b).unwrap();
        assert!(!remote_params_differ(&params_a, Some(&manifest_a)));
        assert!(remote_params_differ(&params_b, Some(&manifest_a)));
        assert!(remote_params_differ(&params_a, None));
    }

    #[test]
    fn recovery_code_roundtrip_and_wrong_code_fails() {
        let (mut manifest, data_key, _) = create_encryption_manifest(SCOPE, CHECK, PW).unwrap();
        let code = generate_recovery_code(&mut manifest, &data_key).unwrap();
        assert_eq!(recover_key_from_code(&manifest, &code).unwrap(), data_key);
        assert!(recover_key_from_code(&manifest, &"00".repeat(32)).is_err());
    }

    #[test]
    fn join_decrypt_bridge_two_setups_one_vault() {
        // Full join at crypto level: B adopts A's params, then decrypts bytes
        // A encrypted under the shared items key.
        use crate::shared::crypto::keys::{aead_decrypt_bytes, aead_encrypt_bytes};

        let (manifest_a, key_a, _) = create_encryption_manifest(SCOPE, CHECK, PW).unwrap();
        let params = key_params_from_manifest(&manifest_a).unwrap();
        let (key_b, _) = derive_items_key_from_params(&params, PW).unwrap();
        assert_eq!(key_a, key_b);
        let (iv, enc) = aead_encrypt_bytes(&key_a, b"shared-note-bytes", "n1-1000").unwrap();
        assert_eq!(
            aead_decrypt_bytes(&key_b, &iv, &enc, "n1-1000").unwrap(),
            b"shared-note-bytes"
        );
    }

    #[test]
    fn empty_passphrase_roundtrips_documents_no_policy() {
        // No minimum-password policy exists today: empty passphrase creates a
        // working vault. Pinned so adding a policy later flags this test.
        let (manifest, data_key, _) = create_encryption_manifest(SCOPE, CHECK, "").unwrap();
        let (key, _) = unlock_key_from_manifest(&manifest, "", SCOPE, CHECK).unwrap();
        assert_eq!(key, data_key);
    }

    #[test]
    fn garbage_params_rejected_without_panic() {
        // Garbage params must fail closed before any state is touched (this is
        // the pure gate adopt_key_params delegates to).
        let params = KeyParams {
            version: 255,
            kdf: "none".to_string(),
            salt_hex: "00".to_string(),
            argon2_memory_kib: 0,
            argon2_iterations: 0,
            argon2_parallelism: 0,
            wrapped_items_key: crate::shared::crypto::keys::WrappedKeyEnvelope {
                nonce: String::new(),
                cipher: String::new(),
            },
        };
        assert!(derive_items_key_from_params(&params, PW).is_err());
    }
}
