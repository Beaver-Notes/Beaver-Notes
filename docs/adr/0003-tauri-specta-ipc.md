# ADR 0003: tauri-specta Codegen Pilot for Workspace Commands

**Status:** Accepted (2026-07-18) — pilot only, full migration deferred  
**Commit:** `bf7f88e7`  
**Referenced items:** ARCHITECTURE_ASSESSMENT.md smell #2, recommendation P2, TECHNICAL_DEBT_AUDIT.md design debt #1

## Context

The IPC bridge (`src/lib/tauri/commands.ts`) had a 117-entry `commandAliases` map with a `normalizePayload` switch statement that manually cased JS camelCase keys to Rust snake_case. Every new command required edits in 3 places (alias, normalize, lib.rs registration). No compile-time validation between Rust command signatures and JS call sites.

## Decision

Introduce `tauri-specta` 2.0.0-rc.25 (with `specta-typescript`) to generate typed bindings from Rust command signatures automatically. A binary (`src-tauri/src/bin/gen-specta.rs`) writes `src/lib/tauri/bindings.ts` on debug builds.

**Pilot scope:** Workspace commands only (`workspace_list`, `workspace_get_active`, `workspace_create`, `workspace_switch`, `workspace_rename`, `workspace_delete`). These were chosen as the simplest family with no complex payloads.

Generated bindings use a `typedError<T, E>` wrapper returning `{status: "ok", data: T} | {status: "error", error: E}`, giving type-safe error handling.

## Consequences

**Positive.**
- Workspace commands no longer pass through the manual bridge — Rust signatures are the single source of truth.
- Generated TypeScript types eliminate runtime key-remapping for this family.
- Proved the toolchain works end-to-end (specta macros, serde attributes, `gen-specta` binary, output commit).

**Negative.**
- Full migration deferred: remaining families (fs, storage, encryption, search, yjs) need `#[serde(rename_all = "camelCase")]` annotations first. The old `normalizePayload` switch in `commands.ts` is the exhaustive list of what needs annotation.
- `AppError`'s `Io(String)` variant (instead of `std::io::Error`) was a workaround for specta — `std::io::Error` lacks specta/Serialize impls.
- Generated `bindings.ts` is committed (not `.gitignore`-d) so the frontend always has a working import — but it must be regenerated when workspace signatures change.
- `specta=2.0.0-rc.25` is a release candidate; upgrade risk if the API changes before stable.
