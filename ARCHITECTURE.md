# Beaver Notes — Architecture Overview

This document describes the high-level architecture for new contributors and AI agents working on the codebase.

## Stack

| Layer | Technology |
|-------|-----------|
| Desktop shell | Tauri 2 (Rust) |
| Frontend | Vue 3 + Pinia + TipTap (rich-text editor) |
| Database | SQLite via rusqlite + r2d2 connection pools |
| Collaboration | Yjs 13 (JS) + yrs 0.27 (Rust) — wire-compatible CRDT protocol |
| Encryption | AES-256-GCM + XChaCha20-Poly1305 (AEAD), Argon2 KDF |
| Build | Yarn 1 (classic), Cargo, Vite |

## Directory Structure

```
src-tauri/src/
  lib.rs              # App entry — plugin registration, invoke handler, run loop
  db.rs               # SQLite pool init, migrations, KV + Yjs helpers
  bootstrap.rs        # App setup, window creation, file-open queue
  secure_blob.rs      # In-memory encrypted blob cache
  commands/
    app.rs            # App lifecycle commands (info, zoom, notifications)
    fs.rs             # Filesystem operations (asset encryption hooks)
    storage.rs        # KV storage commands (storage_get/set/delete, ae:4 row crypto)
    security.rs       # Encryption, key derivation, safe storage, lockout
    yjs.rs            # Yjs CRDT sync commands
    workspace.rs      # Multi-workspace CRUD
    dialogs.rs        # Native dialogs
    ...
  shared/
    mod.rs            # AppState, window helpers, constants
    state.rs          # CryptoSession, SecurityState, CacheState, FileState
    crypto/
      mod.rs          # Encryption module glue
      keys.rs         # Key hierarchy: KDF, KEK/DEK, manifest, rotation, recovery
      assets.rs       # BNA3 asset streaming + BNY1 Yjs blob crypto
      legacy.rs       # CryptoJS (AES-CBC) legacy decryption — migration only
    cache.rs          # LRU decrypted note/asset caches
  secure_blob.rs      # Secure blob store (keyring + encrypted disk fallback)

src/
  index.js            # Frontend entry
  lib/
    tauri/
      commands.js     # IPC bridge — 117-entry command alias map + payload normalization
    tiptap/
      index.js        # TipTap editor setup + extension registration
      exts/           # Custom TipTap extensions (callouts, file-blocks, math, etc.)
  store/              # Pinia stores (note, folder, label, etc.)
  components/         # Vue components
```

## Data Flow

```
Vue Component → Pinia Store → invokeCommand (commands.js) → Tauri IPC → Rust Command → db.rs → SQLite
```

### IPC Boundary (`commands.js`)

The JS→Rust bridge uses Tauri's `invoke` API. `commands.js` maintains:
- A **117-entry alias map** from camelCase JS names to snake_case Rust commands.
- A **`normalizePayload`** switch that remaps params per command (camelCase↔snake_case).
- `withKeyVariants` sends both casing styles for backward compatibility.

**No shared schema or type checking exists.** Changes on either side must be kept in sync manually.

## CRDT Sync (Yjs ↔ yrs)

The real-time collaboration system uses two implementations of the same protocol:

- **JS side:** `yjs` library (v13.6.31) — runs in the browser, manages the editor's in-memory document.
- **Rust side:** `yrs` library (v0.27.2) — runs in the backend, persists updates to SQLite and merges snapshots.

Both encode/decode the same binary format (`updates/v1`), ensuring wire compatibility.

### Sync flow

1. **Editor → Backend (save):** JS calls `yjs_append` with a binary Yjs update blob.
2. **Backend storage:** The raw update is appended to `note_content` (append-only) and folded into a cached merged snapshot in `yjs_snapshots` (O(1) on read).
3. **Backend → Editor (load):** JS calls `yjs_get_snapshot` → Rust decodes all updates via `yrs`, merges into a single state vector, caches the result, and returns the binary snapshot.
4. **Compaction:** `yjs_compact` replaces the append-only history with a single compressed snapshot row.

### Tables involved

| Table | Purpose |
|-------|---------|
| `note_content` | Append-only Yjs binary updates (one row per edit) |
| `yjs_snapshots` | Cached merged snapshot per note (O(1) read) |
| `notes_fts` | Full-text search index (rebuilt from `kv` store) |
| `kv` | Key-value store for note metadata (JSON blobs) |

## Encryption Architecture

> Full, current reference: **[`docs/encryption.md`](docs/encryption.md)** (key hierarchy,
> envelope formats, sequence diagrams, file index, known gaps).

### Layers

| Layer | Algorithm | Scope |
|-------|-----------|-------|
| Note content at rest (Yjs) | AES-256-GCM (`BNY1`) | `note_content` + `yjs_snapshots` blobs |
| Note/KV metadata | XChaCha20-Poly1305 (`ae:4` + per-row AAD) | `data.db` KV rows (`notes.<id>`, `labels`, …) |
| Asset files | AES-256-GCM (`BNA3`, streamed chunks) | Images, attachments in `notes-assets`/`file-assets` |
| Sync payload | XChaCha20-Poly1305 (`v4` + AAD) | Cross-device commits/snapshots |
| Secure blobs | AES-256-GCM (OS keyring master key) | Passphrase auto-unlock, Beaver account session |
| Collaboration | AES-256-GCM (WebCrypto, ML-KEM-derived key) | In-session collab updates |
| Key derivation | Argon2id (16 MiB/2/2) | Passphrase → KEK (manifest v3+) |
| Password storage | Bcrypt | Account-password hash verification |

### Key hierarchy

```
User passphrase
  └→ Argon2id → KEK (key-encryption-key, memory only)
       └→ AES-256-GCM wrap → Items key (DEK, random 32 B)
            ├→ XChaCha20-Poly1305: note content (ae:3), KV rows (ae:4), sync (v4)
            └→ AES-256-GCM: Yjs blobs (BNY1), assets (BNA3)
Recovery code (256-bit) ── wraps DEK → recoveryKek (unlock without passphrase)
OS keyring master key   ── AES-GCM → secure blobs
```

One DEK encrypts everything; passphrase only unwraps the stored DEK, so
passphrase changes re-wrap without re-encrypting data. Key rotation archives the
old DEK into `previous_keys` (decryptable via `kid` lookups).

### At-rest boundaries (important)

- `data.db` KV rows are **encrypted** (`ae:4`) when app encryption is enabled and
  the key is loaded; rows written while locked are plaintext and upgraded on read.
- Note content lives in **Yjs CRDT blobs** (`BNY1`), not KV.
- `settings.db`, the FTS5 search index, and the macOS Spotlight index are
  **plaintext by design** (search trade-off).
- The renderer never holds the KEK/DEK — all at-rest crypto runs in Rust.

### Encryption manifest

Stored at `<appData>/app-crypto/manifest.v2.json` (format version 4). Tracks:
- KDF parameters and salts (Argon2id)
- Wrapped key envelopes (nonce + ciphertext)
- `currentKeyId` + rotation history (`previous_keys`)
- Recovery-key envelope (`recoveryKek`)
- Scope (`app` or `sync`)

A copy of the public KDF params + wrapped DEK is published to
`<syncPath>/BeaverNotesSync/keyParams.json` so a second device can derive the
same key from its passphrase.

## Database Schema

Two SQLite databases per workspace:

| DB | Tables | Path |
|----|--------|------|
| `data.db` | `kv`, `note_content`, `yjs_snapshots`, `notes_fts` | `<workspace>/data/data.db` |
| `settings.db` | `kv` | `<workspace>/settings.db` |

**Schema versioning:** `PRAGMA user_version` is used to track and migrate schema. See `db.rs:open_pool()`.

## Multi-Workspace Architecture

Workspaces are isolated directories, each containing `data.db` + `settings.db`. A registry (managed by `workspace.rs`) tracks all known workspaces. Switching workspaces swaps the active database pool.

## Build & CI

- `yarn lint` (oxlint) — gates every deploy
- `yarn audit` — npm dependency audit
- `cargo audit` — Rust dependency audit (RUSTSEC advisories)
- `yarn knip` — dead code detection
- Version consistency check — `package.json` ↔ `tauri.conf.json` ↔ `Cargo.toml`
- **No tests run in CI** (E2E suite exists but requires a display server)
