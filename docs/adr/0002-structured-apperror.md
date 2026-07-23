# ADR 0002: Structured AppError Serialization over IPC

**Status:** Accepted (2026-07-18)  
**Commits:** `b4cd17e2`, `643e2db5`, `4d3aa30c`, `7861dbed`, `a41dacd9`  
**Referenced items:** TECHNICAL_DEBT_AUDIT.md infra debt #3, ARCHITECTURE_ASSESSMENT.md recommendation P5

## Context

Rust commands returned `Result<T, String>`, losing all error structure on the JS side. Every `catch` had to string-match (e.g., `err.includes("Wrong password")`) to distinguish error types. `std::io::Error` information was discarded during `.to_string()` conversion. ~200 `Result<T, String>` signatures existed across 17 source files.

## Decision

Replace `Result<T, String>` with `Result<T, AppError>` everywhere. `AppError` (defined in `src-tauri/src/shared/error.rs`) is a Rust enum implementing `serde::Serialize` and `specta::Type`:

```rust
pub(crate) enum AppError {
    Io(String),             // was std::io::Error, converted to String for specta compat
    Crypto(String),
    Serialization(String),
    WrongPassword,
    EncryptionLocked,
    Other(String),
}
```

Serialization emits `{"kind": "WrongPassword", "message": "Wrong password."}` over the wire. A custom `Serialize` impl writes `kind` + `message` fields. Frontend helpers `isError(err, kind)` and `errorMessage(err)` in `src/lib/tauri/errors.ts` provide type-safe consumption.

Migration executed in 4 batches by command family (leaf → core → security) to manage risk, since structured errors change IPC rejection values from plain string to `{kind, message}` object.

## Consequences

**Positive.**
- Frontend can discriminate error types with `isError(err, 'WrongPassword')` instead of fragile string matching.
- `std::io::Error` details preserved through IPC (as `Io(String)`).
- Consistent error display pattern: `errorMessage(err)` works with both old strings and new objects.
- ~200 signatures updated; `from` impls for `io::Error`, `serde_json::Error`, `aes_gcm::Error`, etc. make migration ergonomic.

**Negative.**
- Existing catch sites rendering raw `err` in toasts/toast patterns needed updating to use `errorMessage(err)`.
- `Io` variant stores a `String` instead of `std::io::Error` — required for `specta::Type` derive which can't represent `std::io::Error` (not `Serialize`). Error detail is preserved as text.
- Batch migration (4 commits) was necessary because a single commit touching all 17 files risked missing a JS catch site.
