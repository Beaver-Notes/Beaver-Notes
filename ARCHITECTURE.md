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
    fs.rs             # Filesystem operations
    storage.rs        # KV storage commands (storage_get/set/delete)
    security.rs       # Encryption, key derivation, password management
    yjs.rs            # Yjs CRDT sync commands
    workspace.rs      # Multi-workspace CRUD
    dialogs.rs        # Native dialogs
    ...
  shared/
    mod.rs            # AppState, window helpers, constants
    crypto.rs         # Encryption/decryption, key management, asset crypto
    cache.rs          # LRU asset cache

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

### Layers

| Layer | Algorithm | Scope |
|-------|-----------|-------|
| Note content at rest | AES-256-GCM | `note_content` + `yjs_snapshots` blobs (encrypted via `encrypt_yjs_blob`) |
| Asset files | AES-256-CBC + HMAC-SHA256 | Images, attachments (encrypted via asset crypto) |
| Sync payload | XChaCha20-Poly1305 | Cross-device sync transport encryption |
| Key derivation | Argon2id | User passphrase → 256-bit key |
| Password storage | PBKDF2 (100k iterations) | Password hash verification |

### Key hierarchy

```
User passphrase
  └→ Argon2id → master key (256-bit)
       ├→ KEK (key-encryption-key) → wraps/unwraps per-note item keys
       ├→ Asset encryption key
       └→ Sync encryption key
```

### Important boundary

**The `kv` table stores plaintext JSON** — note metadata (title, content ProseMirror JSON, timestamps) is NOT encrypted at rest. Only the Yjs binary blobs in `note_content`/`yjs_snapshots` are encrypted. If you assume "all data is encrypted", this is incorrect.

### Encryption manifest

An `EncryptionManifest` (stored in `settings.db` via the KV layer) tracks:
- Manifest version (currently v4)
- Scope (`app` or `sync`)
- Wrapped key envelopes (nonce + ciphertext)
- Key rotation history (`previous_keys`)
- Lockout state (rate-limiting after failed passphrase attempts)

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
