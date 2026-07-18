# Beaver Notes Codebase Restructure — Master Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the structural debt catalogued in `ARCHITECTURE_ASSESSMENT.md` and `TECHNICAL_DEBT_AUDIT.md` — vulnerable dependencies, zero unit tests, the manual 117-entry IPC bridge, the `AppState` god module, oversized files, and missing type safety — ordered risk-first.

**Architecture:** Keep the existing layered Tauri 2 (Rust) ↔ Vue 3/Pinia split. Refactor in place: split `AppState` into focused state structs, consolidate the note store, decompose oversized files, then migrate the frontend to TypeScript and replace the hand-maintained IPC bridge with `tauri-specta` codegen.

**Tech Stack:** Tauri 2, Rust (thiserror 2 already present), Vue 3, Pinia, TipTap, Vitest, tauri-specta, TypeScript, Yarn.

## Global Constraints

- Versions must stay identical across `package.json`, `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json` — CI asserts equality (`release.yml:83-84`). Use `yarn version:bump` for future bumps.
- `yarn lint` = oxlint (`--max-warnings 0`); every task must leave `yarn lint` green.
- No new runtime dependencies without a stated reason in the task.
- All refactors are behavior-preserving unless the task explicitly says otherwise; the frontend must compile (`npx vite build`) after every task.
- Rust visibility stays `pub(crate)`; no public API surface is added.
- Tests are mandatory for any *new* logic (Vitest for JS/TS, `#[cfg(test)]` for Rust). Pure moves/splits need existing E2E + manual smoke only.
- Commit after every task; one task = one commit.

---

## Phase 1 — Risk & Test Baseline (Quick Wins)

### Task 1: Fix mermaid/dompurify CVEs

**Files:**
- Modify: `package.json:130` (`"mermaid": "10.9.1"` → `"^11.6.0"`)
- Modify: `yarn.lock` (via install)

- [ ] **Step 1:** `yarn add mermaid@^11.6.0` then `yarn why dompurify` — verify resolved dompurify ≥ 3.4.7. If mermaid still pins older, add `"resolutions": { "dompurify": "^3.4.7" }` to `package.json`.
- [ ] **Step 2:** Smoke-test mermaid rendering: open a note with a ```mermaid block in dev (`yarn watch`), verify diagram renders (mermaid 11 changed default font/ELK handling — check a flowchart and a sequence diagram).
- [ ] **Step 3:** `yarn audit --audit-level=high` — expect the 6 dompurify advisories gone.
- [ ] **Step 4:** Commit: `fix(deps): upgrade mermaid to 11.x to close dompurify CVEs`

### Task 2: Align version strings

**Files:** Modify `src-tauri/Cargo.toml:3` (`version = "5.0.0"` → `"5.0.0-beta.1"`)

- [ ] **Step 1:** Edit version; run `cargo check --manifest-path src-tauri/Cargo.toml` (lockfile version field updates).
- [ ] **Step 2:** Verify parity locally: package.json, tauri.conf.json, and Cargo.toml all report `5.0.0-beta.1`.
- [ ] **Step 3:** Commit: `chore: align Cargo.toml version with package.json (5.0.0-beta.1)`

### Task 3: Re-enable knip (dead-code detection)

**Files:** Modify `package.json` devDependencies (+`"typescript": "^5.6.0"`)

- [ ] **Step 1:** `yarn add -D typescript@^5.6.0` (devDep only — this does NOT start the TS migration; knip just needs the parser).
- [ ] **Step 2:** `yarn knip` — capture output; save the baseline report as `docs/knip-baseline.txt` so later cleanup tasks can diff against it. Do not fix findings in this task.
- [ ] **Step 3:** Commit: `chore: add typescript devDep to re-enable knip`

### Task 4: Vitest baseline + store smoke tests

**Files:**
- Create: `vitest.config.js` (extends vite config: vue plugin + `@` → `src` alias, `environment: 'happy-dom'`, `globals: true`)
- Create: `tests/unit/setup.js` (Pinia setup + `invokeCommand` mock for `@/lib/tauri/commands`)
- Create: one spec per store — `tests/unit/store/note.spec.js`, `workspace.spec.js`, etc. (enumerate via `ls src/store`)
- Modify: `package.json` scripts (+`"test": "vitest run"`, `"test:watch": "vitest"`)

**Interfaces:**
- Produces: `yarn test` command; `tests/unit/setup.js` used by all later unit tests; `invokeCommand` mock pattern that Phase 3 reuses.

- [ ] **Step 1:** `yarn add -D vitest happy-dom @vue/test-utils @pinia/testing`
- [ ] **Step 2:** Write `vitest.config.js` and setup file with the commands-module mock:
```js
// tests/unit/setup.js
import { vi, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';

vi.mock('@/lib/tauri/commands', () => ({
  invokeCommand: vi.fn(async () => null),
}));
import { invokeCommand } from '@/lib/tauri/commands';

beforeEach(() => {
  setActivePinia(createPinia());
  vi.mocked(invokeCommand).mockReset();
});
```
- [ ] **Step 3:** Write one smoke test per store — instantiate, assert initial state, call one action with the mocked IPC, assert state changed. Keep each spec ≤ 40 lines.
- [ ] **Step 4:** `yarn test` — all green.
- [ ] **Step 5:** Commit: `test: add vitest baseline with store smoke tests`

### Task 5: Rust unit-test baseline

**Files:**
- Modify: `src-tauri/src/shared/error.rs` (append `#[cfg(test)] mod tests`)
- Modify: `src-tauri/src/shared/cache.rs` (append tests: TTL expiry, byte-limit eviction)

- [ ] **Step 1:** Write test for `AppError::WrongPassword` display string; run `cargo test --manifest-path src-tauri/Cargo.toml` — confirm discovery works.
- [ ] **Step 2:** Add cache tests (insert → hit, insert oversized → miss, TTL → miss). These document existing behavior for the Task 10 refactor.
- [ ] **Step 3:** `cargo test` green. Commit: `test: add rust unit-test baseline for error and cache modules`

### Task 6: CI test gates

**Files:** Modify `.github/workflows/release.yml` and `.github/workflows/release-beta.yml`

- [ ] **Step 1:** After the existing `yarn lint` step insert:
```yaml
      - name: Run unit tests
        run: yarn test
      - name: Run Rust tests
        run: cargo test --manifest-path src-tauri/Cargo.toml --locked
```
- [ ] **Step 2:** Verify YAML validity (`npx js-yaml .github/workflows/release.yml > /dev/null`).
- [ ] **Step 3:** Commit: `ci: gate releases on vitest and cargo test`

### Task 7: Purge stray console output

**Files:** ~70 files under `src/` (locate via `rg -l "console\.(log|debug|info)" src/`)

- [ ] **Step 1:** Remove `console.log`/`console.debug`/`console.info` outside catch blocks; keep `console.error` in error paths.
- [ ] **Step 2:** Add oxlint `no-console` rule (allow `error`/`warn`) to prevent regression.
- [ ] **Step 3:** `yarn lint` green; Commit: `refactor: remove debug console output, enforce via oxlint`

### Task 8: Dependency hygiene — katex, lint-staged consolidation

**Files:** `package.json:128` (`katex ^0.13.0` → `^0.16.22`), `package.json` (lint-staged)

- [ ] **Step 1:** `yarn add katex@^0.16.22`; smoke-test a `$...$` math block renders.
- [ ] **Step 2:** Point lint-staged at oxlint to match `yarn lint`: `"lint-staged": { "*.{js,ts,vue}": "oxlint --fix" }` (eslint removal happens in Task 19; here we only stop the double-linter confusion).
- [ ] **Step 3:** Verify pre-commit hook runs (`yarn lint-staged` directly).
- [ ] **Step 4:** Commit: `chore: upgrade katex, consolidate lint-staged on oxlint`

---

## Phase 2 — Structural Refactors

### Task 9: Structured `AppError` over IPC

**Files:**
- Modify: `src-tauri/src/shared/error.rs` — add `kind()` discriminator; change `Serialize` impl to emit `{ "kind": "...", "message": "..." }`
- Modify: Rust commands still returning `Result<T, String>` → `Result<T, AppError>` (find via `rg "Result<.*, String>" src-tauri/src/`)
- Create: `src/lib/tauri/errors.js` — `isError(e, kind)` helper
- Test: `tests/unit/lib/errors.spec.js`; Rust `error.rs` serialization test

**Interfaces:**
- Produces: `AppErrorKind ∈ {Io, Crypto, Serialization, WrongPassword, EncryptionLocked, Other}`; JS `isError(err, 'WrongPassword')` consumed by lock/unlock UI paths.

- [ ] **Step 1:** Rust test: serialized `AppError::WrongPassword` == `{"kind":"WrongPassword","message":"Wrong password."}` — watch fail.
- [ ] **Step 2:** Implement kind + Serialize; Rust test green.
- [ ] **Step 3:** Migrate String-error commands (the `From<String>` impl already exists, so this is mostly signature changes).
- [ ] **Step 4:** Vitest for `isError`; update JS call sites that string-match errors today (`rg "Wrong password" src/`) to use `isError`.
- [ ] **Step 5:** `cargo test && yarn test && yarn lint` green. Commit: `refactor: structured AppError serialization across IPC`

### Task 9b: Migrate `Result<T, String>` → `Result<T, AppError>` by family

**Context:** Task 9 delivered structured serialization but found ~200 `Result<T, String>` sites across 17 files (plan estimated a handful). User decision: migrate by family in 3 batches, one commit each.

**Frontend risk:** structured errors change IPC rejection values from `string` to `{kind, message}`. Batch 1 must first add `errorMessage(err)` to `src/lib/tauri/errors.js` (returns `err?.message ?? String(err)`) with unit tests; each batch then updates frontend catch sites that render raw errors from its families' channels.

**Batch 1 (leaf, ~55 sites):** `commands/dialogs.rs`, `search.rs`, `external.rs`, `menu.rs`, `commands/yjs.rs`, `imports.rs`, `workspace.rs`, `storage.rs`, `secure_blob.rs`, `commands/updates.rs`
**Batch 2 (core commands, ~60):** `commands/fs.rs`, `app.rs`, `pdf.rs`
**Batch 3 (risky core, ~96):** `commands/security.rs`, `shared/mod.rs`, `db.rs`, `bootstrap.rs`

- [ ] Per batch: migrate signatures (`Err("...".to_string())` → `Err(AppError::Other(...))` or `"...".into()`; drop redundant `.map_err(|e| e.to_string())` where a From impl exists); `cargo check` + `cargo test` green; update affected frontend error displays to `errorMessage()`; `yarn test` + `yarn lint` green
- [ ] Commits: `refactor: migrate <batch name> commands to structured AppError`

### Task 10: Split `AppState` god module

**Files:**
- Create: `src-tauri/src/shared/state.rs` containing:
  - `UiState { zoom_level, reduced_motion, high_contrast }`
  - `SecurityState { failure_count, lockout_until, granted_paths, transient_passphrase }`
  - `CryptoState { crypto: RwLock<CryptoSession>, asset_key_cache }`
  - `CacheState { decrypted_notes_cache, decrypted_assets_cache, secure_blobs }`
  - `FileState { pending_open_files, external_open_files, asset_cache_dir, external_open_dir, portable_storage_dir }`
- Modify: `src-tauri/src/shared/mod.rs:236-258` — `AppState` becomes composition of the above + `db` + `updater`
- Modify: every command touching `state.<field>` (find via `rg "state\.(zoom_level|granted_paths|crypto|decrypted_|failure_count|lockout|transient|pending_open|external_open|secure_blobs)" src-tauri/src/`)

**Interfaces:**
- Consumes: existing field semantics/lock types unchanged (same `Mutex`/`RwLock` wrappers, just re-homed).
- Produces: `state.crypto.crypto`, `state.security.granted_paths`, etc. — mechanical accessor rename.

- [ ] **Step 1:** Create `state.rs` with the five structs + `new()` constructors; re-export from `shared/mod.rs`.
- [ ] **Step 2:** Rewrite `AppState` as composition; fix `AppState::new`.
- [ ] **Step 3:** `cargo check` — compiler errors enumerate every call site; fix them mechanically. Commit nothing until green.
- [ ] **Step 4:** `cargo test && cargo clippy --manifest-path src-tauri/Cargo.toml` green.
- [ ] **Step 5:** Manual smoke: encryption unlock/lock, asset insert, zoom persist.
- [ ] **Step 6:** Commit: `refactor: split AppState into focused state structs`

### Task 11: Consolidate note store

**Files:**
- Modify/merge: `src/store/note/crud.js` + `helpers.js` + `search.js` → `src/store/note/index.js` (single store definition; keep section comments)
- Keep as focused modules: `encryption.js`, `lock.js`, `backlinks.js`
- Modify: importers of moved helpers (`rg "from '@/store/note/(helpers|search|crud)'" src/`)
- Test: extend `tests/unit/store/note.spec.js` — CRUD round-trip with mocked IPC, `syncFtsIndex` via store getter (fixes Feature Envy)

- [ ] **Step 1:** Write failing test: `syncFtsIndex` invoked through store action uses getter-derived note (mock getter, assert IPC payload).
- [ ] **Step 2:** Merge files; convert `syncFtsIndex` to take store context instead of reaching into note props.
- [ ] **Step 3:** Update importers; `yarn test && yarn lint` green.
- [ ] **Step 4:** Manual smoke: create/edit/delete/search note, backlinks panel.
- [ ] **Step 5:** Commit: `refactor: consolidate note store, remove feature envy in FTS sync`

### Task 12: Decompose `NoteToolbar.vue` (1210 lines)

**Files:**
- Create: `src/components/note/toolbar/ToolbarFormatting.vue` (bold/italic/underline/strike/highlight/color)
- Create: `src/components/note/toolbar/ToolbarInsert.vue` (image/table/math/mermaid/link)
- Create: `src/components/note/toolbar/ToolbarOverflow.vue` (less-used actions menu)
- Modify: `src/components/note/NoteToolbar.vue` — becomes ~200-line composition root

- [ ] **Step 1:** Extract formatting group with identical props/events (`editor` prop, no behavior change).
- [ ] **Step 2:** Extract insert group; extract overflow.
- [ ] **Step 3:** Verify each TipTap command path manually against a checklist (every button toggles in dev).
- [ ] **Step 4:** Commit: `refactor: split NoteToolbar into focused toolbar components`

### Task 13: Decompose `exportBulk.js` (1329 lines)

**Files:**
- Create: `src/utils/share/export/css.js` (stylesheet constants)
- Create: `src/utils/share/export/highlight.js` (syntax-highlight map)
- Create: `src/utils/share/export/markdown.js` (HTML→md rendering via existing turndown)
- Modify: `src/utils/share/exportBulk.js` — orchestration + zip assembly only
- Test: `tests/unit/utils/exportMarkdown.spec.js` (pure function — no IPC)

- [ ] **Step 1:** Write markdown test against current output snapshot (characterize before moving).
- [ ] **Step 2:** Move constants → `css.js`, `highlight.js`; test still green.
- [ ] **Step 3:** Move renderer → `markdown.js`; test green.
- [ ] **Step 4:** Manual smoke: bulk export a workspace to HTML+md zip, diff against pre-refactor export of the same fixture.
- [ ] **Step 5:** Commit: `refactor: split bulk export into css/highlight/markdown modules`

### Task 14: Split `crypto.rs` (1140 lines)

**Files:**
- Create: `src-tauri/src/shared/crypto/keys.rs` (argon2 derivation, key hierarchy)
- Create: `src-tauri/src/shared/crypto/assets.rs` (asset stream encrypt/decrypt)
- Create: `src-tauri/src/shared/crypto/manifest.rs` (manifest read/write, migration)
- Create: `src-tauri/src/shared/crypto/legacy.rs` (CryptoJS legacy decryption)
- Create: `src-tauri/src/shared/crypto/mod.rs` (re-exports; `CryptoSession` moves here from `shared/mod.rs` — this task lands AFTER Task 10 so it moves exactly once)
- Test: extend Rust tests — round-trip encrypt/decrypt per submodule

- [ ] **Step 1:** Characterization test: current argon2 params derive a known vector — green before moving anything.
- [ ] **Step 2:** Move code per module boundary above; `pub(crate)` re-exports keep call sites unchanged.
- [ ] **Step 3:** `cargo test && cargo clippy` green; manual smoke: enable/unlock/lock encryption, encrypted asset insert+render.
- [ ] **Step 4:** Commit: `refactor: split crypto.rs into keys/assets/manifest/legacy modules`

### Task 15: Composable dedup + knip baseline burn-down

**Files:** `src/composable/useNoteMenu*.js` and knip-baseline findings

- [ ] **Step 1:** Diff `useNoteMenu`, `useNoteMenuActions`, `useNoteMenuState`; merge into one `useNoteMenu.js` with named exports; update importers.
- [ ] **Step 2:** Re-run `yarn knip`, compare to `docs/knip-baseline.txt`; remove confirmed-dead exports only (one commit per subsystem if large).
- [ ] **Step 3:** `yarn test && yarn lint` green; Commit: `refactor: dedupe note-menu composables, remove dead code`

---

## Phase 3 — Type Safety & IPC

### Task 16: TypeScript migration — wave 1 (infrastructure + IPC layer)

**Files:**
- Create: `tsconfig.json` (`"allowJs": true, "checkJs": false, "strict": true`; add `yarn add -D @vue/tsconfig vue-tsc`)
- Rename: `src/lib/tauri/commands.js` → `commands.ts`, add `errors.ts` types
- Modify: `package.json` (+`"typecheck": "vue-tsc --noEmit"`), CI +`yarn typecheck` gate
- Modify: knip config to parse TS

- [ ] **Step 1:** Scaffold tsconfig; `yarn typecheck` passes on pure-JS baseline (allowJs means nothing breaks).
- [ ] **Step 2:** Convert `src/lib/tauri/**` to TS with a `Channel` string-literal union type and payload interfaces per command — this types the *existing* manual bridge so Task 18 has a spec to generate from.
- [ ] **Step 3:** `yarn typecheck && yarn test && yarn lint` green; Commit: `feat: typescript infra + typed IPC channel layer`

### Task 17: TypeScript migration — wave 2 (stores)

**Files:** `src/store/**` → `.ts` (note store first — it's the consolidation winner from Task 11), composables as touched

- [ ] **Step 1:** Convert note store; define `Note`, `NoteMetadata` interfaces matching the Rust serde payloads.
- [ ] **Step 2:** Convert remaining stores one commit each: workspace, settings, sync.
- [ ] **Step 3:** `yarn typecheck` strict green on `src/store`; Commit per store: `feat: migrate <name> store to typescript`

### Task 18: Replace manual IPC bridge with tauri-specta codegen

**Files:**
- Modify: `src-tauri/Cargo.toml` (+`tauri-specta = { version = "2", features = ["derive", "typescript"] }`)
- Modify: `src-tauri/src/lib.rs:98` — wrap `generate_handler!` list in `specta::collect_commands!`; export `bindings.ts` on debug builds
- Create: `src/lib/tauri/bindings.ts` (generated — committed; regenerated via a `yarn gen:bindings` script or a small `src-tauri/src/bin/gen_bindings.rs`)
- Modify: `src/lib/tauri/commands.ts` — shrink to thin re-export; delete `commandAliases` + `normalizePayload` (360 lines → ~30)
- Modify: all `invokeCommand('channel', payload)` call sites → generated `commands.someCommand(args)`

**Interfaces:**
- Consumes: the `Channel`/payload types from Task 16 as the migration checklist (every literal must map to a generated command).
- Produces: `commands.*` typed functions; JS payload key-casing handled by specta/serde annotations (`#[serde(rename_all = "camelCase")]` on Rust args), eliminating `withKeyVariants`.

- [ ] **Step 1:** Add specta; generate bindings for ONE pilot command family (`app:*`); verify generated TS matches Task-16 hand-written types.
- [ ] **Step 2:** Add serde casing attributes where `normalizePayload` currently remaps keys (the `withKeyVariants` calls in commands.js:142-352 are the exhaustive list).
- [ ] **Step 3:** Migrate call sites family-by-family (fs → storage → encryption → search → yjs → workspace), `yarn typecheck && yarn test` after each.
- [ ] **Step 4:** Delete `commandAliases`, `normalizePayload`, `mapCommand`. `rg "commandAliases|normalizePayload" src/` returns nothing.
- [ ] **Step 5:** Full manual smoke + E2E suite locally.
- [ ] **Step 6:** Commit: `feat: generate type-safe IPC bindings with tauri-specta`

### Task 19: Tooling modernization

**Files:** `.yarnrc.yml`, `package.json` (`packageManager` → yarn 4), eslint removal

- [ ] **Step 1:** `yarn set version 4.x`, `yarn install`, verify `yarn dev`/`build`/`test` all work (if PnP breaks Tauri tooling, set `nodeLinker: node-modules` — accepted, documented outcome).
- [ ] **Step 2:** Remove `eslint`, `@babel/eslint-parser`, `eslint-config-prettier`, `eslint-plugin-prettier-vue`, `eslint-plugin-vue` and `.eslintrc*` — oxlint is the sole linter; fix the 21+ `eslint-disable` comments (delete or convert to oxlint equivalents).
- [ ] **Step 3:** CI updated; Commit: `chore: migrate to yarn 4, drop eslint for oxlint`

### Task 20: Documentation refresh

**Files:**
- Modify: `ARCHITECTURE_ASSESSMENT.md`, `TECHNICAL_DEBT_AUDIT.md` — mark resolved items, fix stale line numbers
- Create: `docs/adr/0001-appstate-split.md`, `0002-tauri-specta-ipc.md`, `0003-incremental-typescript.md`
- Modify: `ARCHITECTURE.md` — add data-flow sections for sync, import, PDF export

- [ ] **Step 1:** Write the three ADRs (context/decision/consequences, ≤ 1 page each, referencing the actual commits).
- [ ] **Step 2:** Refresh audit docs with a "Resolved" table + date.
- [ ] **Step 3:** Commit: `docs: ADRs for restructure, refresh architecture docs`

---

## Dependency & Risk Notes

- **Task order matters:** Task 14 (crypto split) must land after Task 10 (AppState split) so `CryptoSession` moves exactly once. Task 18 depends on Task 16's types. Everything else within a phase is parallelizable.
- **E2E gap acknowledged:** E2E can't run in CI (needs display server). Mitigation = the Vitest/cargo gates (Task 6) + manual smoke checklists per refactor task. Headless E2E (xvfb + tauri-driver) is deliberately out of scope — flag as follow-up.
- **Rollback strategy:** each task is one commit; Phase 3 tasks 17-18 should land on a feature branch with `npx vite build` + manual QA before merge.
- **Not included (YAGNI):** dependency-injection framework for Rust — the AppState split delivers most of the testability win; revisit only if tests demand it.

## Agent Routing

- `mechanical` (deepseek-v4-flash-free): Tasks 1-3, 7-8, 15 — mechanical edits, dep bumps, renames.
- `structure` (hy3-free): Tasks 4-6, 9-14, 16-19 — multi-file refactors, type design, codegen.
- Orchestrator (this session): review gates between tasks, plan tracking, Task 20 docs.
