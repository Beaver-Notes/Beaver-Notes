# ADR 0001: Split AppState God Module into Focused State Structs

**Status:** Accepted (2026-07-18)  
**Commit:** `fb532814`  
**Referenced items:** ARCHITECTURE_ASSESSMENT.md smell #1, TECHNICAL_DEBT_AUDIT.md code debt #1

## Context

`AppState` in `src-tauri/src/shared/mod.rs:236-258` was a single struct holding 18+ fields across unrelated concerns: crypto sessions, caches, UI preferences, security lockout state, file paths, and more. Every Rust module imported it to get at one field, creating implicit coupling and making lock-contention reasoning difficult. Unit tests could not construct focused test states without bringing every dependency.

## Decision

Extract the fields into five focused structs, each in its own file (`src-tauri/src/shared/state.rs`):

- **`UiState`** — zoom level, reduced-motion, high-contrast (presentation prefs)
- **`SecurityState`** — failure count, lockout timer, granted paths, transient passphrase
- **`CryptoState`** — `CryptoSession` + asset key cache (behind one `RwLock`)
- **`CacheState`** — decrypted note/asset caches + secure blob cache
- **`FileState`** — pending/open-file tracking, cache/output dirs

`AppState` now composes these structs as named fields (`state.ui`, `state.security`, etc.), plus the existing `DbState` and `UpdaterState` that were already focused enough to keep in place.

## Consequences

**Positive.**
- Commands now access only their relevant substate (`state.crypto.crypto`, `state.security.granted_paths`), making data-flow clearer.
- Lock contention is isolatable per struct — a cache eviction no longer blocks a crypto operation.
- Unit tests can construct e.g. `SecurityState::new()` without spinning up a crypto session.
- `state.rs` (103 lines) is easily grokked; `mod.rs` dropped ~100 lines.

**Negative.**
- ~40 call sites required mechanical accessor renames (`state.field` → `state.substate.field`).
- `FileState` required constructor parameters (dirs), so callers of `AppState::new` needed no change — the split stayed internal.
