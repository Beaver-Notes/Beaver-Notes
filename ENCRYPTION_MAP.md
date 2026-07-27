# Beaver Notes — Encryption Logic Map

> Generated from codebase analysis. Covers all encryption/decryption paths,
> key hierarchy, data formats, and the frontend↔Rust backend boundary.

---

## 1. High-Level Architecture

Beaver Notes uses a **three-layer encryption stack**:

| Layer | Algorithm | Purpose |
|-------|-----------|---------|
| **Note content at rest** | AES-256-GCM | Encrypts Yjs binary blobs (`note_content`, `yjs_snapshots`) |
| **Asset files** | AES-256-GCM | Images, attachments (encrypted via asset crypto) |
| **Sync payload** | XChaCha20-Poly1305 (AEAD) | Cross-device sync transport encryption |
| **Key derivation** | Argon2id | User passphrase → 256-bit key |
| **Password storage** | bcrypt (10 rounds) | Password hash verification |
| **Safe storage** | AES-256-GCM (master key) | Encrypts blobs in keyring/file |

### Key Insight (from ARCHITECTURE.md)

> The `kv` table stores **plaintext JSON** — note metadata (title, content ProseMirror JSON, timestamps) is **NOT** encrypted at rest. Only the Yjs binary blobs in `note_content`/`yjs_snapshots` are encrypted.

---

## 2. Key Hierarchy

```
User passphrase
    │
    └── Argon2id KDF ──→ Master Key (256-bit)
            │
            ├── KEK (Key-Encryption-Key) → wraps/unwraps per-note items keys
            │       │
            │       └── Items Key (256-bit) → encrypts/decrypts note content
            │               └── Key ring: current key + previous keys (for rotation)
            │
            ├── Asset encryption key (same as items key)
            │
            └── Sync encryption key (same as items key, used with XChaCha20-Poly1305)
```

### Key Files

- **`src-tauri/src/shared/crypto/keys.rs`**: All key derivation, wrapping, and rotation logic.
- **`src-tauri/src/shared/state.rs`**: `CryptoSession` struct holds the in-memory key state.
- **`src-tauri/src/shared/mod.rs`**: Defines `APP_ENCRYPTION_SCOPE`, `NOTE_AAD`, `ALLOWED_BLOB_KEYS`, lockout constants.

---

## 3. Frontend Crypto Modules

### 3.1 `src/utils/crypto/constants.js`
| Export | Value | Purpose |
|--------|-------|---------|
| `ALGO_AES_GCM` | `'AES-GCM'` | Algorithm name |
| `ALGO_HKDF` | `'HKDF'` | Key derivation |
| `ALGO_PBKDF2` | `'PBKDF2'` | Key derivation (legacy) |
| `HASH_SHA_256` | `'SHA-256'` | Hash algorithm |
| `KEY_LENGTH_256` | `256` | Key size in bits |
| `IV_LENGTH_BYTES` | `12` | Nonce/IV size |
| `SALT_LENGTH_BYTES` | `32` | Salt size |
| `PBKDF2_ITERATIONS` | `100_000` | KDF iterations |
| `ENVELOPE_VERSION` | `2` | Note envelope v2 (PBKDF2-based) |
| `NOTE_ENVELOPE_VERSION_ARGON2` | `3` | Note envelope v3 (Argon2id-based) |
| `BASE64_CHUNK_SIZE` | `0x8000` | Chunk size for base64 encoding |
| `WORKER_POOL_MAX` | `4` | Max Web Workers for crypto |

### 3.2 `src/utils/crypto/codec.js`
- `hexToBuf(hex)` / `bufToHex(buf)`: Hex ↔ Uint8Array conversion.
- `bufToBase64(buf)` / `base64ToBuf(b64)`: Base64 ↔ Uint8Array conversion.
- **Web Worker pool**: Spawns up to 4 Web Workers (capped at `navigator.hardwareConcurrency`) for off-thread crypto operations.
- `deriveAesGcmKeyFromPassphrase(passphrase, saltBuf)`: PBKDF2 key derivation via worker.
- `encryptStringOnWorker(keyRaw, plaintext)`: AES-GCM encrypt via worker. Returns `{nonce, cipher}`.
- `decryptStringOnWorker(keyRaw, nonceHex, cipherB64)`: AES-GCM decrypt via worker.

### 3.3 `src/utils/crypto/worker.js`
Web Worker that handles:
- **`deriveKey`**: PBKDF2-SHA256 passphrase → AES-GCM key.
- **`encrypt`**: AES-GCM encrypt with random 12-byte IV. Returns `{nonce, cipher}` (base64).
- **`decrypt`**: AES-GCM decrypt given `keyRaw`, `nonceHex`, `cipherB64`.

### 3.4 `src/utils/crypto/encryption.js`
The **main orchestrator** for app-level encryption. Manages state and delegates to Rust.

| Function | Purpose |
|----------|---------|
| `isEncryptionEnabled()` | Returns whether encryption is configured |
| `isKeyLoaded()` | Returns whether the key is unlocked in memory |
| `ensureKeyReadyForWrite()` | Throws if encryption is not enabled or key is locked |
| `setupEncryption(passphrase)` | Creates a new encryption manifest (first-time setup) |
| `verifyPassphrase(passphrase)` | Verifies passphrase against manifest, unlocks key |
| `tryRestoreKeyFromSafeStorage()` | Auto-unlock from secure blob on app restore |
| `encryptionIsConfigured()` | Checks if manifest exists |
| `encryptContent(contentObj)` | JSON-stringifies content, encrypts via `encryptNotePayload` |
| `decryptContent(contentVal)` | Decrypts envelope, JSON-parses result |
| `isEncryptedContent(contentVal)` | Checks `ae === 1, 2, or 3` |
| `lockEncryptionKey()` | Locks key, clears caches, clears sync key |

**Re-exports**: `encryptContent` as `encryptPayload`, `decryptContent` as `decryptPayload`.

### 3.5 `src/utils/crypto/noteCrypto.js`
Per-note password-level encryption (for locked notes).

| Function | Purpose |
|----------|---------|
| `encryptNoteWithPassword(plaintext, password)` | Encrypts with Argon2id-derived key, envelope v3 format |
| `decryptNoteWithPassword(ciphertext, password)` | Decrypts v3 (Argon2id) or legacy CryptoJS (v2, PBKDF2) envelopes |

**Envelope v3 format**: `{ v: 3, salt: hex, iv: hex, cipher: base64 }` — Argon2id KDF + AES-256-GCM.
**Legacy v2 format**: `{ v: 2, salt: hex, iv: hex, cipher: base64 }` — PBKDF2 + AES-256-GCM.
**Legacy CryptoJS format**: Base64 string starting with `U2FsdGVk` (Salted__ magic bytes).

### 3.6 `src/utils/crypto/safeStorageBlob.js`
Wraps the Rust `safeStorage` Tauri commands for encrypting/decrypting blobs stored in the secure keyring.

| Function | Purpose |
|----------|---------|
| `storeSecureBlob(key, plainText)` | Encrypts string, stores in keyring |
| `persistSecureBlobInBackground(key, plainText)` | Fire-and-forget version |
| `loadSecureBlob(key)` | Fetches blob, decrypts |
| `clearSecureBlob(key)` | Removes blob from keyring |

### 3.7 `src/utils/crypto/collab.js`
E2E encryption helpers for note collaboration. AES-256-GCM with AAD binding.

| Function | Purpose |
|----------|---------|
| `importCollabKey(hexKey)` | Import 64-char hex key as CryptoKey |
| `encryptUpdate(key, plaintext, aad)` | AES-256-GCM encrypt with AAD. Returns IV+ciphertext |
| `decryptUpdate(key, data, aad)` | AES-256-GCM decrypt with AAD |
| `isValidCollabKey(hex)` | Validates 64-char hex format |

### 3.8 `src/utils/note/contentSecurity.js`
Content security/sanitization (not encryption per se, but related to secure content handling). Sanitizes HTML/ProseMirror content to prevent XSS — strips dangerous iframe/inline sources, restricts image/media to safe prefixes.

### 3.9 `src/utils/sync/crypto.js`
Sync-layer encryption wrapper. Delegates to Rust for actual crypto.

| Function | Purpose |
|----------|---------|
| `ensureSyncKeyReadyForWrite()` | Checks sync key is ready; throws if locked |
| `encryptJSON(obj, aad)` | Encrypts JSON payload with AAD binding (XChaCha20-Poly1305) |
| `decryptJSON(raw, aad)` | Decrypts sync envelope v4; throws `SyncCryptoError` on failure |
| `syncAssetName(localFilename)` | Appends `.enc` extension when encryption is enabled |
| `localAssetName(syncFilename)` | Strips `.enc` extension |
| `clearSyncKey()` | No-op (key lives in Rust) |

### 3.10 `src/composable/useNoteEncryption.js`
Vue composable for per-note password locking flow. Integrates `useNoteEncryption` with `usePasswordStore` and `useNoteStore`.

### 3.11 `src/composable/useSettingsSecurity.js`
Vue composable for encryption settings UI. Handles:
- Setting/changing/resetting app password
- Changing encryption passphrase (re-wraps key, does NOT re-encrypt notes)
- Locking encryption now

### 3.12 `src/store/passwd.ts` (Pinia store)
Manages the app password:
- `retrieve()`: Reads encrypted password file, decrypts, returns hash
- `setAppPassword(password)`: Hashes with bcrypt, encrypts, persists to `password.enc`
- `isValidPassword(enteredPassword)`: Verifies against bcrypt hash, tracks failures
- `resetPassword(current, new)`: Re-encrypts all locked notes with new password
- `importAppPassword(rawHash)`: Imports legacy bcrypt hash

### 3.13 `src/store/note/encryption.ts`
Batch migration helpers:
- `decryptAllNotesForAppEncryption()`: Decrypts all notes for migration (with progress)
- `persistAllNotesForAppEncryption()`: Re-encrypts all notes after enabling encryption

### 3.14 `src/lib/native/security.js`
Tauri bridge — maps frontend function calls to Rust `#[tauri::command]` invocations. This is the **only** path between frontend and backend crypto.

---

## 4. Rust Backend Crypto Modules

### 4.1 `src-tauri/src/shared/crypto/mod.rs`
Module root — declares submodules and re-exports:
- `keys` → all key derivation, envelope, manifest logic
- `assets` → asset encryption/decryption, Yjs blob encryption
- `legacy` → deprecated CryptoJS migration

### 4.2 `src-tauri/src/shared/crypto/keys.rs` (core, ~838 lines)

#### Constants
| Constant | Value | Purpose |
|----------|-------|---------|
| `PBKDF2_ITERATIONS` | `100_000` | KDF iterations for PBKDF2 |
| `ARGON2_MEMORY_KIB` | `16 * 1024` (16 MiB) | Argon2id memory cost |
| `ARGON2_ITERATIONS` | `2` | Argon2id iterations |
| `ARGON2_PARALLELISM` | `2` | Argon2id parallelism |
| `ENCRYPTION_MANIFEST_VERSION` | `4` | Latest manifest version |
| `APP_PASSWORD_CHECK` | `"BeaverNotes-app-manifest-v4"` | Password verification string |
| `APP_ENCRYPTION_SCOPE` | `"app"` | Scope identifier for key derivation |
| `STREAM_CHUNK_SIZE` | `256 * 1024` (256 KiB) | Asset streaming chunk size |
| `NOTE_AAD` | `"beaver-notes:note-content:v1"` | AAD for note content encryption |
| `SYNC_ROOT_DIR` | `"BeaverNotesSync"` | Sync folder name |
| `PROTOCOL_VERSION` | `4` | Sync envelope version |
| `SYNC_KEY_PARAMS_FILE` | `"keyParams.json"` | Shared key params filename |

#### Key Types
- **`WrappedKeyEnvelope`**: `{ nonce: hex, cipher: base64 }` — AES-256-GCM wrapped key.
- **`PreviousWrappedKey`**: `{ id, nonce, cipher }` — Rotated-out items key, wrapped with KEK.
- **`EncryptionManifest`**: The on-disk manifest (`app-crypto/manifest.v2.json`) containing:
  - `version`, `scope`, KDF params (salt, argon2 params)
  - `password_check` — wrapped verification blob
  - `wrapped_key` — items key wrapped with KEK
  - `current_key_id` — ID of the current items key
  - `previous_keys` — ring of archived items keys
- **`SyncEnvelope`**: `{ v, iv, enc }` — XChaCha20-Poly1305 sync payload envelope.
- **`KeyParams`**: Shared key distribution params for cross-device sync.

#### Key Functions

| Function | Purpose |
|----------|---------|
| `derive_kek(passphrase, salt)` | PBKDF2-SHA256 → 32-byte KEK (legacy, v1-v2 manifests) |
| `derive_kek_argon2id(passphrase, salt)` | Argon2id → 32-byte KEK (v3+ manifests) |
| `derive_kek_from_manifest(manifest, passphrase)` | Auto-detects KDF version from manifest |
| `random_key()` | Generates random 32-byte key |
| `random_nonce()` | Generates random 12-byte nonce |
| `encrypt_bytes_with_key(key, plain)` | AES-256-GCM encrypt → `WrappedKeyEnvelope` |
| `decrypt_bytes_with_key(key, envelope)` | AES-256-GCM decrypt → plaintext bytes |
| `aead_encrypt_json(key, value, aad)` | XChaCha20-Poly1305 encrypt JSON → `SyncEnvelope` |
| `aead_decrypt_json(key, envelope, aad)` | XChaCha20-Poly1305 decrypt → JSON value |
| `create_encryption_manifest(scope, passwordCheck, passphrase)` | Creates new manifest + data key |
| `unlock_key_from_manifest(manifest, passphrase, scope, check)` | Unlocks data key from manifest |
| `encrypt_note_content_for_storage(state, content)` | Encrypts note content with current items key, `ae:3` envelope |
| `decrypt_native_note_content(state, content)` | Decrypts `ae:2` or `ae:3` note content |
| `encrypt_note_row_for_storage(state, key, value)` | Auto-encrypts note rows on write |
| `decrypt_note_row_from_storage(state, key, value)` | Auto-decrypts note rows on read |
| `rotate_items_key(app, state)` | Key rotation: archives current key, generates new one |
| `publish_key_params(app, state)` | Writes shared key params to sync folder |
| `read_key_params(app, state)` | Reads shared key params from sync folder |
| `adopt_key_params(app, state, params, passphrase)` | Joins a sync group by adopting remote key params |
| `populate_key_ring(state, manifest, kek)` | Loads previous keys into in-memory ring |
| `read_master_key()` | Reads master key from keyring (or file fallback) |
| `safe_storage_encrypt_bytes(bytes)` | AES-256-GCM encrypt for safe storage |
| `safe_storage_decrypt_bytes(value)` | AES-256-GCM decrypt for safe storage |

### 4.3 `src-tauri/src/shared/crypto/assets.rs` (~275 lines)

Asset and Yjs blob encryption:

| Function | Purpose |
|----------|---------|
| `encrypt_asset_bytes_with_key(plain, key)` | AES-256-GCM → `BNA2` magic + nonce + tag + ciphertext |
| `decrypt_asset_bytes_with_key(encrypted, key)` | Decrypts `BNA2`/`BNA1` prefixed assets |
| `encrypt_asset_streaming(input, output, key)` | Streaming encrypt for large assets (chunks with derived nonces) |
| `decrypt_asset_streaming(input, output, key)` | Streaming decrypt for large assets |
| `encrypt_yjs_blob(key, data)` | AES-256-GCM → `BNY1` magic + nonce + ciphertext |
| `decrypt_yjs_blob(key, data)` | Decrypts `BNY1`-prefixed Yjs blobs |
| `is_encrypted_yjs_blob(data)` | Checks for `BNY1` magic prefix |
| `encrypt_asset(app, state, targetPath, input, skip)` | Conditional encrypt for local assets |
| `decrypt_asset(app, state, targetPath, input)` | Conditional decrypt for local assets |

### 4.4 `src-tauri/src/shared/crypto/legacy.rs` (~49 lines)

Deprecated CryptoJS migration:
- `decrypt_legacy_cryptojs_note(ciphertext_b64, password)`: Decrypts the old Electron-era CryptoJS format (AES-256-CBC with EVP_BytesToKey derivation).

### 4.5 `src-tauri/src/shared/crypto/tests.rs`

Characterization tests:
- `derive_kek_argon2id_known_vector`: Validates Argon2id KDF output matches a known vector.
- `note_content_round_trip`: Encrypts then decrypts note content.
- `asset_bytes_round_trip`: Encrypts then decrypts asset bytes.
- `yjs_blob_round_trip`: Encrypts then decrypts a Yjs blob.

### 4.6 `src-tauri/src/secure_blob.rs`
Secure blob cache for in-memory encrypted blob storage.

---

## 5. Tauri Command Handlers (Encryption-Related)

Defined in `src-tauri/src/commands/security.rs` (~734 lines):

| Command | Signature | Purpose |
|---------|-----------|---------|
| `asset_crypto_migrate_dir` | `(app, state, encrypt_at_rest)` | Migrates assets between encrypted/unencrypted states |
| `encryption_get_state` | `(app, state)` | Returns `{ enabled, unlocked, app_enabled, app_unlocked }` |
| `encryption_submit_password` | `(app, state, password, createIfMissing)` | Unlock or create encryption manifest |
| `encryption_enable` | `(app, state, password)` | Enable encryption (first time) |
| `encryption_unlock` | `(app, state, password)` | Unlock existing encryption |
| `encryption_lock` | `(state)` | Zero out `CryptoSession` (lock key from memory) |
| `encryption_encrypt_note_payload` | `(state, plain_json)` | Encrypt note content → `{ ae:3, iv, cipher }` |
| `encryption_decrypt_note_payload` | `(state, payload)` | Decrypt `ae:3` envelope → plaintext JSON |
| `sync_encrypt_payload` | `(app, state, json, aad)` | XChaCha20-Poly1305 encrypt sync payload |
| `sync_decrypt_payload` | `(app, state, enc, aad)` | XChaCha20-Poly1305 decrypt sync payload |
| `sync_key_ready` | `(state)` | Checks if sync key is loaded |
| `encryption_rotate_key` | `(app, state)` | Rotate items key |
| `encryption_reconcile_key_params` | `(app, state, passphrase)` | Sync key params between devices |
| `safe_storage_is_available` | `(state)` | Checks if secure storage is available |
| `safe_storage_encrypt` | `(plain_text)` | AES-256-GCM encrypt string |
| `safe_storage_decrypt` | `(encrypted_base64)` | AES-256-GCM decrypt string |
| `safe_storage_store_blob` | `(state, key, blob)` | Store encrypted blob in cache |
| `safe_storage_fetch_blob` | `(state, key)` | Fetch encrypted blob from cache |
| `safe_storage_clear_blob` | `(state, key)` | Remove blob from cache |
| `asset_crypto_set_passphrase` | `(state, passphrase)` | Set transient passphrase for migration |
| `asset_crypto_clear_passphrase` | `(state)` | Clear transient passphrase |
| `passwd_hash` | `(password)` | bcrypt hash password |
| `passwd_compare` | `(password, hash)` | Verify bcrypt hash |
| `passwd_record_failure` | `(state)` | Track failed unlock attempts, enforce lockout |
| `passwd_reset_failures` | `(state)` | Reset failure counter |
| `is_encrypted_asset` | `(path)` | Check if asset file is encrypted (deprecated) |
| `encryption_decrypt_asset_stream` | `(app, state, path)` | Decrypt asset stream (streaming or bulk) |
| `encryption_encrypt_asset_stream` | `(app, state, path)` | Encrypt asset stream |
| `encryption_cache_decrypted_note` | `(state, noteId, content)` | Cache decrypted note content |
| `encryption_get_cached_decrypted_note` | `(state, noteId)` | Retrieve cached decrypted note |
| `encryption_clear_decrypted_caches` | `(state)` | Clear note + asset decryption caches |
| `decrypt_legacy_cryptojs_note` | `(ciphertext_b64, password)` | Migrate from CryptoJS format |
| `derive_argon2_key` | `(passphrase, salt?)` | Derive Argon2id key (for note-level encryption) |

---

## 6. Encryption Data Envelopes

### 6.1 Note Content Envelope (v3 — current)
```json
{
  "ae": 3,
  "iv": "<hex-nonce-12-bytes>",
  "cipher": "<base64-aes-gcm-ciphertext>",
  "kid": "<optional-items-key-id-for-rotation>"
}
```
- Algorithm: AES-256-GCM
- KDF: Argon2id (from passphrase)
- AAD: `"beaver-notes:note-content:v1"`

### 6.2 Note Content Envelope (v2 — legacy, still decryptable)
```json
{
  "ae": 2,
  "iv": "<hex-nonce-12-bytes>",
  "cipher": "<base64-aes-gcm-ciphertext>"
}
```
- Algorithm: AES-256-GCM
- KDF: PBKDF2 (legacy)

### 6.3 Sync Envelope (v4 — current)
```json
{
  "v": 4,
  "iv": "<hex-nonce-24-bytes>",
  "enc": "<base64-xchacha20-poly1305-ciphertext>"
}
```
- Algorithm: XChaCha20-Poly1305
- AAD: file stem / commit ID / snapshot marker

### 6.4 Asset Envelope
```
[BNA2|BNA3|BNA1] [12-byte nonce] [16-byte tag] [ciphertext...]
```
Streaming variant (v3):
```
BNY1 [12-byte nonce_seed] [4-byte chunk_len] [ciphertext] [16-byte tag] ...
```

### 6.5 Locked Note Envelope (per-note password)
```json
{
  "v": 3,
  "salt": "<hex-32-bytes>",
  "iv": "<hex-12-bytes>",
  "cipher": "<base64-aes-gcm-ciphertext>"
}
```
- KDF: Argon2id (per-note)
- Algorithm: AES-256-GCM

### 6.6 Legacy CryptoJS Envelope
```
U2FsdGVk... (base64, starts with "Salted__" magic bytes)
```
- Algorithm: AES-256-CBC
- KDF: EVP_BytesToKey (MD5-based)

---

## 7. Flow Diagrams

### 7.1 App Encryption Setup Flow
```
User sets passphrase
  → frontend: setupEncryption(passphrase)
    → Rust: encryption:submitPassword / encryption:enable
      → create_encryption_manifest(scope, passwordCheck, passphrase)
        → Argon2id(passphrase, random_salt) → KEK
        → random_key() → data_key (items key)
        → encrypt_bytes_with_key(KEK, data_key) → wrapped_key
        → encrypt_bytes_with_key(data_key, passwordCheck) → password_check
        → write encryption manifest to app-crypto/manifest.v2.json
      → cache data_key in CryptoSession
      → set app_data_key, active = true
```

### 7.2 App Encryption Unlock Flow
```
User enters passphrase
  → frontend: verifyPassphrase(passphrase)
    → Rust: encryption:submitPassword
      → load encryption manifest from disk
      → derive_kek_from_manifest(manifest, passphrase) → KEK
      → decrypt_bytes_with_key(KEK, manifest.wrapped_key) → items_key
      → decrypt_bytes_with_key(items_key, manifest.password_check) → verify
      → cache KEK in master_key_cache, items_key in app_data_key
      → populate_key_ring: load previous_keys into items_keys map
      → set active = true
```

### 7.3 Note Encrypt/Decrypt Flow
```
WRITE (note save):
  noteStore.save(note)
    → serializer.encryptNoteForStorage(note)
      → encryptContent(content)  [frontend]
        → backend: encryption:encryptNotePayload(plainJson)
          → encrypt_note_content_for_storage(state, content)
            → aead_encrypt_json(items_key, content, NOTE_AAD)
            → return { ae:3, iv, cipher, kid }
    → save to SQLite note_content blob

READ (note load):
  noteStore.load(note)
    → serializer.decryptNoteForMemory(note)
      → decryptContent(note.content)  [frontend]
        → backend: encryption:decryptNotePayload(payload)
          → decrypt_native_note_content(state, content)
            → lookup items_key by kid (or current key)
            → aead_decrypt_json(items_key, envelope, NOTE_AAD)
            → return plaintext JSON
```

### 7.4 Sync Encrypt/Decrypt Flow
```
SYNC WRITE:
  sync:push(commit)
    → encryptJSON(obj, aad)  [frontend]
      → backend: sync:encryptPayload(json, aad)
        → aead_encrypt_json(items_key, value, aad)
        → return SyncEnvelope { v:4, iv, enc }
    → write to sync file

SYNC READ:
  sync:pull(commit)
    → decryptJSON(raw, aad)  [frontend]
      → backend: sync:decryptPayload(enc, aad)
        → parse SyncEnvelope
        → aead_decrypt_json(items_key, envelope, aad)
        → return plaintext JSON
```

### 7.5 Asset Encrypt/Decrypt Flow
```
WRITE (asset save):
  writeFile(path, data)
    → assetCrypto:encryptAssetStream(path)
      → encrypt_asset_streaming(input, output, key)
        → chunk-by-chunk AES-256-GCM with derived nonces

READ (asset load):
  readFile(path)
    → assetCrypto:decryptAssetStream(path)
      → decrypt_asset_streaming(input, output, key)
        → chunk-by-chunk AES-256-GCM with derived nonces
        → write decrypted to cache
```

### 7.6 Key Rotation Flow
```
User triggers key rotation
  → frontend: encryption_rotate_key()
    → Rust: rotate_items_key(app, state)
      1. Snapshot current key + KEK from CryptoSession
      2. Wrap old key with KEK → push to manifest.previous_keys
      3. Generate new random items key
      4. Wrap new key with KEK → replace manifest.wrapped_key
      5. Update current_key_id in manifest
      6. Update app_data_key in CryptoSession
      7. Persist updated manifest to disk
```

---

## 8. Security Controls

### 8.1 Lockout Mechanism
- After `LOCKOUT_THRESHOLD` (5) consecutive failures, unlock is rate-limited.
- Lockout duration starts at `LOCKOUT_BASE_SECS` (30s), extends with each failure.
- Maximum lockout: `LOCKOUT_MAX_SECS` (300s = 5 minutes).

### 8.2 Secure Storage
- Master key stored in OS keyring (via `keyring` crate) when available.
- Fallback: file-based master key at `app_data_dir/com.beaver-notes.beaver-notes/master.key` with `0o600` permissions.
- Keyring key is base64-encoded, 32 bytes.

### 8.3 Allowed Blob Keys
Only 4 keys are allowed for secure blob storage:
- `encryptionPassphraseBlob` — stores the passphrase for auto-unlock
- `beaverAccountSession` — account session data
- `beaverAccountProfile` — account profile data
- `beaverAccountDeviceId` — device identifier

### 8.4 Asset Path Validation
All asset operations are gated by `is_local_asset_path()` which verifies the resolved path is within the app's `notes-assets/` or `file-assets/` directories, preventing path traversal.

---

## 9. Migration Path

| From | To | Mechanism |
|------|-----|-----------|
| CryptoJS (AES-256-CBC, EVP_BytesToKey) | AES-256-GCM (Argon2id) | `decrypt_legacy_cryptojs_note()` + re-encrypt |
| PBKDF2 KDF (manifest v2) | Argon2id KDF (manifest v3+) | New manifest on next passphrase change |
| No encryption | AES-256-GCM note content | `setupEncryption()` creates manifest |
| Single items key | Rotating items key ring | `rotate_items_key()` preserves old keys |

---

## 10. File Inventory

### Frontend (14 files)
| File | Role |
|------|------|
| `src/utils/crypto/constants.js` | Shared constants |
| `src/utils/crypto/codec.js` | Encoding helpers + Web Worker pool |
| `src/utils/crypto/worker.js` | Off-thread PBKDF2 + AES-GCM |
| `src/utils/crypto/encryption.js` | App-level encryption orchestrator |
| `src/utils/crypto/noteCrypto.js` | Per-note password encryption |
| `src/utils/crypto/safeStorageBlob.js` | Secure blob store wrapper |
| `src/utils/crypto/collab.js` | E2E collaboration encryption |
| `src/utils/note/contentSecurity.js` | Content sanitization |
| `src/utils/sync/crypto.js` | Sync encryption wrapper |
| `src/lib/native/security.js` | Tauri bridge for crypto commands |
| `src/composable/useNoteEncryption.js` | Vue composable for note unlock |
| `src/composable/useSettingsSecurity.js` | Vue composable for encryption settings |
| `src/store/passwd.ts` | App password (bcrypt) store |
| `src/store/note/encryption.ts` | Batch encryption migration helpers |

### Rust Backend (6 files)
| File | Role |
|------|------|
| `src-tauri/src/shared/crypto/mod.rs` | Module root |
| `src-tauri/src/shared/crypto/keys.rs` | Key derivation, envelopes, manifest, wrap/unwrap |
| `src-tauri/src/shared/crypto/assets.rs` | Asset + Yjs blob encryption |
| `src-tauri/src/shared/crypto/legacy.rs` | CryptoJS migration |
| `src-tauri/src/shared/crypto/tests.rs` | Characterization tests |
| `src-tauri/src/commands/security.rs` | Tauri command handlers (all encryption endpoints) |

### Shared State (3 files)
| File | Role |
|------|------|
| `src-tauri/src/shared/mod.rs` | AppState, CryptoSession, constants |
| `src-tauri/src/shared/state.rs` | State structs (CryptoState, SecurityState, CacheState) |
| `src-tauri/src/shared/error.rs` | AppError enum with encryption variants |