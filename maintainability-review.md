# Maintainability Review — Beaver Notes

**Date:** 2026-07-13
**Stack:** Tauri 2 (Rust backend + Vue 3 / Pinia / TipTap frontend), SQLite via rusqlite + r2d2, Yjs 13 / yrs 0.27 CRDT sync, AES-GCM + ChaCha20Poly1305 encryption. Desktop (macOS, Windows, Linux) + mobile (Android, iOS).
**Deploy context:** Prod — signed platform bundles published as GitHub draft release (stable) or pre-release (beta). Store submission steps are commented out.
**Release model:** Push to `main` triggers CI; `validate` job runs `yarn lint` + `yarn audit` + version-consistency check (package.json ↔ tauri.conf.json ↔ Cargo.toml); only if `version_match == true` does the build job run. **No tests, no type-check, no Rust audit in CI.**

---

## Grades

| Axis | Grade | Score | Key Factors |
|------|-------|-------|-------------|
| **AI-maintainability** | **B+** | **3.6 / 4.0** | Small-medium files (84% under 300 lines), clear entry points (`src-tauri/src/lib.rs`, `src/index.js`), flat command mapping (`commands.js`), fast feedback (lint only in CI), no type-info for agent to navigate. |
| **Human-maintainability** | **C+** | **2.3 / 4.0** | Bus factor 1 (79% commits by one person), no schema migrations (in-code DDL only), zero unit tests, E2E suite not run in CI with trivially-true assertions, dual lockfiles, no architectural docs. |

**Why they diverge:** The codebase is well-structured for an LLM agent (small files, predictable IPC boundary, flat imports) but fragile for a new human contributor — no test safety net, undocumented CRDT sync architecture, zero CI test execution, and a single point of knowledge risk.

---

## Measured Spine

### Gate Reality

| Gate | What Runs | Location | Gates Deploy? |
|------|-----------|----------|:---:|
| Lint | `oxlint --vue-plugin --max-warnings 0` | `.github/workflows/release.yml:105-106` | Yes (validate job fails) |
| npm audit | `yarn audit --audit-level=high` | `.github/workflows/release.yml:110-111` | Yes (validate job fails) |
| Version consistency | Compare 3 files | `.github/workflows/release.yml:62-84` | Yes (validate job fails) |
| Jurisdiction routing | Stable vs beta | `.github/workflows/release.yml:86-96` | Routes to correct workflow |
| **Tests** | **None** | — | **No** |
| **Type-check (JS/Rust)** | **None** | — | **No** |
| **Cargo audit** | **None** | — | **No** |
| **Clippy / Rust lint** | **None** | — | **No** |

### Test Reality per Unit

| Unit | Type | Tests | CI | Status |
|------|------|-------|----|--------|
| Frontend (Vue/JS) | E2E (WebdriverIO) | 11 spec files | Not run | **Bit-rotten** — 4 tests have `expect(true).toBe(true)`, fragile CSS selectors, deprecated `execCommand` API |
| Rust backend | Unit | 3 functions (path traversal) | Not run | Tests pass locally if Tauri display available |
| Pinia stores | Unit | 0 | — | — |
| TipTap extensions | Unit | 0 | — | — |

### Worst Dependency Vulnerability

npm audit is run in CI (`--audit-level=high`). Rust cargo-audit is **not configured anywhere** — no CI step, no config file. Resolved crate versions (chrono 0.4.44, aes-gcm 0.10, etc.) appear clean today, but there is **no mechanism to detect future RUSTSEC advisories** (confirmed probe #1).

### File Size Distribution (305 source files)

| Bucket | Count | % | Notes |
|--------|------|---|-------|
| XS (<100 lines) | 134 | 43.9% | Well-factored |
| S (100-300) | 103 | 33.8% | |
| M (300-600) | 49 | 16.1% | |
| L (600-1000) | 14 | 4.6% | |
| **XL (1000+)** | **5** | **1.6%** | **See below** |

**XL files (≥1000 lines):**
| File | Lines | Risk |
|------|-------|------|
| `src/utils/share/exportBulk.js` | 1329 | Solo-owned, no tests |
| `src/components/note/NoteToolbar.vue` | 1174 | Heavy single-file component |
| `src-tauri/src/shared/crypto.rs` | 1140 | Core crypto — security-critical |
| `src-tauri/src/shared/mod.rs` | 1113 | Monolithic state/helper module |
| `src/lib/tiptap/exts/paper-block/DrawMode.vue` | 1005 | Drawing canvas, low risk |

### Bus Factor

| Author | Commits | Share |
|--------|---------|-------|
| Daniele Rolli (all aliases) | ~1,175 | ~86% |
| bigshans | 127 | 9.3% |
| Others (14 contributors) | ~60 | ~4.4% |

**Bus factor: 1** — only one person understands the full system.

---

## Static Checks & Dependency Table

| Check | Configured | In CI | Pre-commit | Gates Deploy? |
|-------|:---:|:---:|:---:|:---:|
| Oxlint | Yes | Yes | — | Yes |
| ESLint (legacy) | Yes | No | Yes (lint-staged) | No |
| npm audit | Yes | Yes | No | Yes |
| Cargo audit | **No** | **No** | **No** | **No** |
| TypeScript check | **No** | **No** | **No** | **No** |
| Rust clippy | **No** | **No** | **No** | **No** |
| Rust tests | Partial (3 fns) | **No** | **No** | **No** |
| E2E tests | 11 specs | **No** | **No** | **No** |
| Knip (dead code) | Installed | **No** | **No** | **No** |

**Dependency count:** 100 npm packages (76 deps, 24 devDeps) + 68 Rust crate references. Lockfiles: yarn.lock + Cargo.lock + **package-lock.json (stale by 2.6 days)** — dual lockfile drift confirmed.

---

## Ranked Enforcement Gaps

| Gap | Risk | Effort | Leverage | Notes |
|-----|:----:|:------:|:--------:|-------|
| **No tests in CI** | Critical | Medium | High | Every change is an untested deploy. E2E suite exists but is unmaintained. |
| **No Rust audit** | High | Low | High | `cargo audit` in CI is a 5-line addition. |
| **No schema migrations** | Medium | Medium | Medium | `CREATE TABLE IF NOT EXISTS` in `db.rs:28-54` — schema can silently diverge between versions. No rollback. |
| **No type-check** | Medium | Low | Medium | `vue-tsc` or `tsc --noEmit` would catch import/interface drift. No TS in stack, so this is JS-only. |
| **Knip not run** | Low | Very Low | Low | Already configured. Add a script/CI step. |
| **Dual lockfiles** | Low | Very Low | Medium | Remove package-lock.json and update `.gitignore`. |

---

## Cross-Boundary Contract Drift

### Boundary: Rust Tauri Commands ↔ JS `invokeCommand` (`commands.js`)

**Enforcement mode:** Manual — `commands.js` has a 117-entry alias map + a `normalizePayload` switch with per-command param remapping (camelCase↔snake_case). There is **no shared schema, no generated client, no type checking**.

**Score: 2/5** (some structure, entirely manual)

**Concrete hazards:**
1. **Inconsistent parameter names** — `commands.js:119-127` implements `withKeyVariants` that sends *both* camelCase and snake_case keys. If the Rust handler changes its parameter name, the JS side silently sends the old name and the new one. Neither side fails; the Rust side ignores the extra key.
2. **Silent fallthrough** — `commands.js:349` returns `payload ?? {}` for unknown channels. A typo in the channel name passes an empty object to a Rust command expecting real params, likely producing a confusing runtime error instead of a compile-time one.
3. **Binary data shape** — `normalizeBinaryData` (`commands.js:129-140`) converts binary to `number[]` for the IPC bridge. If a command ever receives raw `ArrayBuffer` instead of `Uint8Array`, the conversion is lossy. Several Yjs commands (`yjs_append`, `yjs_compact`) send binary data through this path.

**Cheapest fix:** Add a tiny JSON Schema or TypeScript interface per command group. Even better: use Tauri's built-in `#[tauri::command]` typing (Rust derives `serde::Deserialize`) and generate the JS bindings. For now, a `.d.ts` file with `invoke` generic overloads would catch most drift.

### Boundary: Yjs ↔ yrs CRDT Format

**Enforcement mode:** Wire-compatible by design — both sides implement the same binary protocol (updates/v1).

**Score: 5/5** — confirmed aligned (yjs 13.6.31 ↔ yrs 0.27.2). No drift risk.

### Boundary: Pinia Store ↔ Rust DB Schema

**Enforcement mode:** None — the stores write JSON blobs via `storage_set` into the KV table. The Rust side stores/retrieves opaque `TEXT` values. There is no shared entity definition, no migration system, and no validation.

**Score: 1/5**

**Concrete hazards:**
1. **Store-internal shape** — `src/store/note.js` writes note JSON with fields like `title`, `content` (ProseMirror JSON), `createdAt`, `updatedAt`. If a store adds a field, old notes in the DB lack it. The Rust side never validates the shape.
2. **Encryption awareness gap** — Yjs blobs are encrypted at rest (`encrypt_yjs_blob` in `db.rs:306`). But the `kv` table values are *not* encrypted — they contain plaintext note JSON. If a developer assumes "all data is encrypted" they'd be wrong.
3. **`db_replace_all` transaction boundary** — `db.rs:127-145` uses a single transaction for the full KV replace, but the Yjs `note_content` and `yjs_snapshots` tables are not included. A settings restore followed by a crash could leave notes orphaned.

**Cheapest fix:** Define a shared JSON schema for note/folder/label entities. Validate on write in Rust. Document the encryption boundary.

---

## Data Model

### Stores: 2 SQLite databases per workspace (`data.db` + `settings.db`)

| DB | Tables | Content |
|----|--------|---------|
| `data.db` | `kv`, `note_content`, `yjs_snapshots`, `notes_fts` | Notes (JSON in kv), Yjs CRDT updates, full-text search index |
| `settings.db` | `kv` | App settings as key-value JSON |

**Schema evolution:** **None** — `db.rs:28-54` uses `CREATE TABLE IF NOT EXISTS`. There are no migrations, no version tracking, no rollback. A new table added in a future version would be created fresh for new workspaces, but existing workspaces would only get it on next DB pool open.

**Dead/deprecated entities:** The `note_content` table still stores individual Yjs update rows (append-only). The `yjs_snapshots` cache is the preferred read path (`db.rs:321` comment: "Kept for backwards compatibility / migration"). After all notes have been compacted via `yjs_compact`, the raw rows in `note_content` are dead data — they're only used to rebuild the snapshot on first read. This is intentional but worth noting.

**Cross-store writes:** Workspace CRUD (`workspace.rs`) creates both `data.db` and `settings.db` in a new directory but does **not** use a saga/outbox pattern. If `data.db` creation succeeds but `settings.db` creation fails, the workspace registry is still updated with an entry pointing to an incomplete directory. The `storage_replace` command (`storage.rs`) operates on one named store at a time — cross-store consistency is not enforced.

---

## Bus Factor & Knowledge Risk

**Bus factor: 1.** The primary author (Daniele Rolli) accounts for ~86% of commits. The second contributor (bigshans, 9.3%) touched mostly specific areas (Rust features) and is now inactive.

**Consequence of loss:** **High** — this is a published, open-source application with external users (GitHub releases, website at beavernotes.com, mobile app store entries pending). It is **not** a personal script or toy project. A bus-factor event would leave:
- No one who understands the CRDT sync architecture (Rust yrs + JS yjs + TipTap collaboration)
- No one who can sign/publish releases (Apple certs, Android keystore, Tauri signing keys)
- No one who understands the encryption layer (key derivation, AEAD nonce strategy, crypto session lifecycle)

**Recoverability:** **Medium** — MIT license, forkable, reproducible build (`yarn install --frozen-lockfile` + `cargo build`). But the encryption keys and signing certificates are in the author's possession. A community fork would need to replace the crypto module and signing infrastructure.

---

## Duplication Worth Collapsing

| Item | Duplicate Lines | Savings | Location |
|------|:---------------:|:-------:|----------|
| Audio/Video/File-block TipTap extensions | ~150 lines of ~168 | ~120 lines | `src/lib/tiptap/exts/{audio,video,file}-block/index.js` — 95% copy-paste |
| Rust pool init pattern (data_pool / settings_pool) | ~40 lines each | ~40 lines | `src-tauri/src/shared/mod.rs:525-541` vs `558-574` — near-identical lazy-init + double-check locking |
| Rust storage commands fallback pattern | ~80 lines duplicated across 4 commands | ~60 lines | `src-tauri/src/commands/storage.rs` — flat key fast path + nested JSON fallback repeated |
| Pinia CRUD stores (folder, note, label) | ~30 lines per store | ~60 lines | Yjs sync pattern repeated in each store |

---

## Critic-Driven Investigations (Confirmed)

| Probe | Finding | Severity | Evidence |
|-------|---------|:--------:|----------|
| Cargo audit absent | Zero Rust vulnerability scanning | **Medium** | No `cargo-audit` CI step, no config, no script. Resolved crates clean today but no detection mechanism. |
| Knip not executed | Dead-code detection tooling installed but completely dormant | **Low** | `knip.json` exists, `knip` in devDependencies, but no script/CI/pre-commit runs it. |
| Dual lockfiles | `package-lock.json` (npm) and `yarn.lock` (yarn) both committed; npm lockfile is 2.6 days stale | **Medium** | Creates resolution ambiguity for contributors. |
| Documentation thin | README accurate but architecturally thin — no CRDT sync, encryption, or plugin docs | **Low** | New contributors have no architecture overview. |

### Still Unmeasured

- **Performance / memory profile** — no profiling data. Could matter for large Yjs documents.
- **Accessibility (a11y)** — not checked. Vue app with rich editor likely has gaps.
- **Mobile-specific testing** — iOS/Android builds exist but no mobile CI or emulator tests.
- **I18n completion** — 13 locales, many with untranslated English sections (confirmed by Phase 1 duplication analysis).
- **iCloud / cloud sync reliability** — the sync engine exists but reliability under network failure was not tested.

---

## Action List (Highest Leverage First)

1. **Add E2E test run to CI** — `yarn test:e2e` in a matrix job. Fix the 4 trivially-true assertions. **Highest risk gap.**
2. **Add `cargo audit` to CI** — 5 lines in `release.yml` validate job. Catches Rust RUSTSEC advisories.
3. **Remove `package-lock.json`** — pick Yarn, delete the other, add to `.gitignore`. Eliminates resolution drift.
4. **Add a schema version to `db.rs`** — `PRAGMA user_version` + migration function. Prevent silent schema drift between versions.
5. **Factory-refactor audio/video/file-block** — follow the `createCallout.js` pattern already in the codebase. ~120 lines saved.
6. **Add `yarn knip` to lint-staged or CI** — tooling already installed, just needs invocation.
7. **Document the CRDT sync + encryption architecture** in a `docs/` file or update README. Single most impactful thing for contributor onboarding.
8. **Add TypeScript interfaces or JSON Schema for the IPC boundary** — start with the Yjs and workspace commands. Prevents silent contract drift.
