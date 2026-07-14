# Maintainability Review — Beaver Notes

**Date**: 2026-07-13  
**Stack**: Vue 3 (Composition API, Pinia, Vite 5, Yarn 1) + Rust (Tauri 2, rusqlite, yrs 0.27) + SQLite + Yjs 13.6  
**Deploy context**: Prod — both stable and beta workflows produce signed release artifacts on push to `main`  
**Release model**: Push-to-`main` triggers two workflows (stable/beta) differentiated solely by whether `package.json` version contains a `-` pre-release suffix. Both pass through a `validate` job (lint + audit + version consistency) before building. No tests gate the deployed artifact; stable releases are draft-only (manual publish), beta is auto-published.

---

## Grades

| Grade | Score | Key factors |
|-------|-------|-------------|
| **AI-maintainability** | **B– (72/100)** | Highly navigable (clear entry points, consistent patterns, good ARCHITECTURE.md), but 16% of files >400 lines hurt context windows; no shared types between JS ↔ Rust means an agent renaming a field will silently break at runtime; no test gate means broken changes ship |
| **Human-maintainability** | **C+ (65/100)** | Bus-factor 1 for the core codebase; large monolithic files (crypto.rs 1140 lines, mod.rs 1113 lines); duplicated dark-mode CSS patterns; silent decryption-failure path that can corrupt data; FTS rebuild won't index migrated notes |

**Divergence**: AI-maintainability is higher because the codebase follows strong conventions (consistent file naming, clear store/composable/component separation, good architectural docs) which LLMs navigate well. Human-maintainability is lower because the bus factor is critical (1 person wrote ~1000 commits), the largest files exceed comfortable human reading limits, and there are specific correctness bugs that a human must know about (silent decryption corruption, FTS rebuild gap) that no automated check catches.

---

## Measured Spine

### Gate reality

| Gate | Stable CI | Beta CI | Effect if fails |
|------|-----------|---------|-----------------|
| `yarn lint` (oxlint, 7 rules) | ✅ | ✅ | Hard gate — blocks build |
| `yarn audit --audit-level=high` | ✅ | ✅ | Hard gate — blocks build |
| `yarn knip` (dead code) | ✅ | ❌ Not run | Beta ships unchecked |
| `cargo audit` (RUSTSEC) | ✅ | ❌ Not run | Beta ships unchecked |
| Version consistency check | ✅ | ✅ | Hard gate |
| **Tests (any)** | ❌ | ❌ | **No test gate exists** |
| **Type checking** | ❌ | ❌ | No TS used; jsconfig.json is IDE-only |

### Test reality

| Suite | Status | Detail |
|-------|--------|--------|
| E2E (WDIO, 11 specs) | **10 pass, 1 fail** | Shortcuts spec fails (2/4 tests) — `browser.keys()` not detected by Tauri webview in CI. 56/58 tests pass. |
| Rust unit tests | **2 pass, 0 fail** | Only `shared/mod.rs` has `#[test]`. Zero tests in `commands/`, `db.rs`, or `crypto.rs`. |
| CI test gate | **None** | Neither workflow runs any test command. Broken tests produce release artifacts. |

### Test coverage gaps (all critical)

| Area | Coverage |
|------|----------|
| JS↔Rust IPC (117 commands) | **Zero** integration tests |
| Yjs CRDT sync | **Zero** tests |
| Rust backend (crypto, DB, security) | **Zero** `#[test]` in app crate |
| JS unit tests | **Zero** `*.test.js` files |

### Worst dependency vulnerability

| Package | Severity | CVE | CVSS | Action |
|---------|----------|-----|------|--------|
| `lodash-es` (indirect) | **HIGH** | CVE-2026-4800 | 8.1 | Update to ≥4.18.0 |
| Plus 51 moderate, 19 high vulnerabilities across 1070 scanned packages | | | | |

Note: `cargo audit` not installed locally — Rust advisory scanning cannot run outside CI.

### File size distribution

| Threshold | Count | % of source files |
|-----------|-------|-------------------|
| >300 lines | 70 | 24.1% |
| >400 lines | 47 | **16.2%** |
| >800 lines | 10 | 3.4% |
| >1500 lines | 0 | 0% |

### Largest files

| Lines | File | Assessment |
|-------|------|------------|
| 1329 | `src/utils/share/exportBulk.js` | Partially justified — inline CSS strings could be extracted |
| 1174 | `src/components/note/NoteToolbar.vue` | Justified (complex toolbar with 6+ panels) |
| 1140 | `src-tauri/src/shared/crypto.rs` | Justified — full encryption stack |
| 1113 | `src-tauri/src/shared/mod.rs` | **Should be decomposed** — 30+ unrelated struct definitions |
| 1005 | `src/lib/tiptap/exts/paper-block/DrawMode.vue` | Justified (SVG drawing canvas) |
| 965 | `src/components/home/HomeNoteCard.vue` | Could be decomposed — block renders as separate components |
| 907 | `src/pages/settings/Index.vue` | Justified (15+ settings sections) |
| 857 | `src/composable/useOnboardingFlow.js` | Could be decomposed — step logic interleaved with UI text |
| 838 | `src/assets/css/editor.css` | Bloated: ~25 `!important`, ~20 repeated dark-mode color rules |
| 812 | `src/pages/Onboarding.vue` | Justified (10+ step wizard with animations) |

### Bus factor

| Metric | Value |
|--------|-------|
| Total committers (all time) | 15 |
| Committers with >5 commits | **5** (Daniele Rolli: 1000, Daniele-rolli: 185, bigshans: 127, allcontributors[bot]: 34, Danny Schellnock: 7) |
| Effective bus factor | **1** — `bigshans` has 127 commits but only 2 in the last 6 months; Daniele Rolli accounts for ~73% of all commits and ~88% of last-6-months commits |
| Last 6 months | Daniele-rolli: 171, Daniele Rolli: 150, others: ≤2 each |

---

## Static Checks & Dependency Table

| Check | Tool | Gates artifact? | In CI? |
|-------|------|-----------------|--------|
| JS lint | oxlint (7 rules) | ✅ Yes | Both workflows |
| JS lint (pre-commit) | ESLint 8 | ✅ Pre-commit hook | Via husky |
| npm audit | `yarn audit` | ✅ High+ only | Both workflows |
| Dead code | knip 5 | ✅ Stable only | Beta skips |
| Rust audit | cargo-audit | ✅ Stable only | Beta skips |
| Version consistency | Custom script | ✅ Yes | Both workflows |
| **Tests** | — | ❌ No | Neither |
| **Type checking** | — | ❌ No | Neither |

---

## Ranked Enforcement Gaps

| # | Gap | Risk | Effort | Leverage |
|---|-----|------|--------|----------|
| 1 | **No test gate in CI** | Critical — broken code ships | Medium — add `yarn test:e2e` step to validate job | High — catches regressions before release |
| 2 | **No IPC contract enforcement** | High — silent runtime failures | Medium — shared JSON schema or TypeScript types with codegen | High — eliminates entire class of bugs |
| 3 | **Beta skips knip + cargo audit** | Medium — dead code + Rust vulns on beta | Low — add to beta workflow | High — parity between workflows |
| 4 | **No type checking** | Medium — field renames, undefined access | Low — no TypeScript possible; add `vue-tsc` with JSDoc types | Medium |
| 5 | **Only 7 oxlint rules** | Low — many common issues unchecked | Low — expand ruleset | Medium |

### Measured gaps not worth fixing

- **Editor CSS bloated** (838 lines, 25 `!important`) — Low consequence for maintainability; works correctly.
- **`shared/mod.rs` is large** (1113 lines) — Cosmetic; splitting doesn't change functional risk.
- **E2E nav boilerplate** — Extracting helpers saves ~30 lines but the tests already pass.

---

## Cross-Boundary Contract Drift

### Boundary 1: JS ↔ Rust IPC (commands.js → Tauri invoke)

| Aspect | Value |
|--------|-------|
| Enforcement mode | **None** — manual alias map + ad-hoc `normalizePayload` case statements |
| Score | **1/5** — fully silent drift |
| Producer hazards | `src/lib/tauri/commands.js:354` `mapCommand()` falls back to `channel.replace(/[:-]/g, '_')` — any missing alias silently generates a different command name |
| Consumer hazards | `normalizePayload()` default case (line 349) passes `payload ?? {}` with no normalization. A field named `camelCase` on JS side won't match `snake_case` on Rust side unless explicitly handled. 117 aliases maintained by hand. |
| Concrete example | `app:directory` → `app_directory` works by alias. If a new command `workspace:export` is added with parameter `outputDir` in Rust, the JS caller needs an alias entry AND a `normalizePayload` case — both easily forgotten. |
| Cheapest fix | Generate `commands.js` from Rust command signatures via proc-macro or build script. Second best: add a CI step that detects Tauri command name mismatches. |

### Boundary 2: Frontend Store ↔ SQLite KV Schema

| Aspect | Value |
|--------|-------|
| Enforcement mode | **Runtime only** — JSON keys are constructed with template literals on both sides |
| Score | **2/5** — some implicit enforcement via `COLLECTION_NAMESPACES` in Rust |
| Producer hazards | Frontend uses `notes.<id>` and `folders.<id>` patterns — if a new entity type is added without updating Rust's list, it falls through to flat key lookup |
| Consumer hazards | `fts_rebuild()` in `db.rs:276` hardcodes `WHERE key LIKE 'notes.%'` — if the note key prefix changes, FTS rebuild silently returns 0 results |
| Concrete example | The dead namespace `notes-content` in `COLLECTION_NAMESPACES` suggests a past rename that left a stale constant |

### Boundary 3: Yjs ↔ yrs (CRDT binary protocol)

| Aspect | Value |
|--------|-------|
| Enforcement mode | **Schema-versioned binary wire protocol** — Yjs and yrs both implement the same `updates/v1` format |
| Score | **4/5** — strong, but not enforced at build time |
| Producer hazards | `db.rs:375` `decrypt_yjs_blob(...).unwrap_or(blob)` — if decryption fails, the encrypted blob (garbage) is passed to `yrs::Update::decode_v1` which will either panic or produce corrupted CRDT state |
| Concrete example | Wrong key, corrupted DB, or version mismatch → silent data corruption, not a handled error |

---

## Data Model

| Store | Location | Schema | Migrations |
|-------|----------|--------|------------|
| `workspaces/<id>/data.db` | App data dir | 4 tables + FTS5 | v1 (current) — inline DDL in `db.rs` |
| `workspaces/<id>/settings.db` | App data dir | Single kv table | v1 (current) |
| `workspaces.json` | App data dir | Plain JSON file | No schema — read with `serde_json` |

### Active schema (data.db)

- `kv` — `key TEXT PK, value TEXT` — note metadata, folders, labels, preferences
- `note_content` — `id INTEGER PK, note_id TEXT, data BLOB, device TEXT, created_at INTEGER` — append-only Yjs updates
- `yjs_snapshots` — `note_id TEXT PK, data BLOB, updated_at INTEGER` — cached merged CRDT snapshots
- `notes_fts` — FTS5 virtual table — full-text search index

### Schema evolution

- PRAGMA `user_version` is the schema version counter (currently 1)
- Future migrations go in `db.rs:migrate()`'s `if from < 2 { ... }` block
- No migration has been applied since initial schema (v1 is baseline)

### Entities with no live read/write path

| Entity | Status |
|--------|--------|
| `notes-content.<id>` in `COLLECTION_NAMESPACES` | **Dead** — defined in Rust `commands/storage.rs:147` but never written or read by any code path. Likely a remnant from before the Yjs migration. |
| `note_content` table `device` column | **Semi-dead** — always written as `''` by `yjs_append` except from frontend which passes the device name. Could be useful for sync debugging but never queried. |

### Cross-store writes

Only one data store (SQLite), no cross-store consistency concern.

---

## Bus Factor & Knowledge Risk

**Frame**: This is an open-source project (MIT license) with external users (Beaver Notes website, GitHub releases, beta testers). The consequence of loss is real — users depend on this for their notes.

| Risk | Severity | Detail |
|------|----------|--------|
| Author concentration | **Critical** | Daniele Rolli = ~73% of all commits, ~88% of recent commits. The encryption layer (`crypto.rs`, 1140 lines), sync/CRDT layer, DB layer, and most UI have a single knowledgeable person. |
| Recovery | **Good** | MIT license, fully reproducible build (`yarn install --frozen-lockfile` + `tauri build`), all deps pinned in `yarn.lock` + `Cargo.lock`. Any developer can fork and build. |
| Documentation | **Medium** | `ARCHITECTURE.md` (high quality, 14 topics), `CONTRIBUTING.md`, `AI_POLICY.md`. But no migration docs for the encryption/sync internals. |
| Key-person risk | **High** | If Daniele is unavailable, nobody else has worked on the encryption layer, Yjs sync integration, or SQLite schema. The 127 commits from `bigshans` are mostly on the frontend UI, not the backend. |
| Verdict | **Bus factor = 1, real risk** | External users exist, builds are reproducible, but the core data-layer and crypto knowledge is concentrated. |

---

## Duplication Worth Collapsing

| Rank | Item | Location | Saving | Effort |
|------|------|----------|--------|--------|
| 1 | E2E nav + delete helpers | `tests/e2e/*.spec.js` | ~30-40 lines across 6+ specs | Low — extract `tests/e2e/helpers.js` |
| 2 | Editor CSS dark-mode color | `src/assets/css/editor.css` | ~15 lines | Low — single CSS custom property |
| 3 | `shared/mod.rs` structs | `src-tauri/src/shared/mod.rs` | Cosmetic | Medium — extract into `types.rs` |
| 4 | TipTap factory (missed exts) | `mermaid-block`, `math-block` | ~50 lines | Low — apply existing factory pattern |

Already well-deduplicated: file-block extensions (factory applied), utility helpers (dedup commit `0e3ce073`), shared `createProgressState`.

---

## Critic-Driven Investigations

### Confirmed findings

1.  **`db.rs:375` — Silent decryption failure corrupts data** (HIGH)
    ```rust
    Some(k) => decrypt_yjs_blob(&k, &blob).unwrap_or(blob),
    ```
    If decryption fails (wrong key, corrupted DB), the encrypted blob is returned as-is. Downstream `yrs::Update::decode_v1()` either panics or produces corrupted CRDT state. This is a **silent data corruption bug**. The same function (`yjs_get_snapshot` at line 397 and `fold_snapshot` at line 522) properly propagates errors — this is inconsistent.
    
2.  **`fts_rebuild()` doesn't index migrated note bodies** (MEDIUM)
    After Yjs migration, `content` is stripped from KV rows. `fts_rebuild` only extracts body from `value.content`. Migrated notes get empty body text in FTS. Mitigated by incremental sync on save, but a `search_rebuild_index` Tauri command call would silently lose searchability for migrated notes until each is re-saved.

3.  **`beta` workflow skips knip + cargo audit** (MEDIUM)
    Beta releases don't check for dead code or Rust security advisories. Since beta auto-publishes (no draft gate), dead code and unpatched RUSTSEC advisories ship to beta users.

### What remains unmeasured

| Dimension | Potential grade impact | Why not checked |
|-----------|----------------------|-----------------|
| Dependency freshness (yarn outdated) | Low-Medium — 73 advisories already found | npm audit covers known vulns; freshness beyond security is stylistic |
| Rust code review — soundness of unsafe blocks | High — crypto code uses `unsafe` (CBC mode padding, key material handling) | Requires crypto expert manual review; automated tools can't assess `unsafe` correctness |
| Bundle size / dead JS code | Low — vite tree-shaking + knip run | knip failed to run locally (missing TypeScript dep) but runs in stable CI |
| Mobile-specific test pass | Low — would affect Android/iOS users | No mobile emulator available |
| i18n coverage / string externalization | Low — internationalization doesn't affect maintainability score directly | Strings are in Vue SFCs, not a structural concern |
| Accessibility audit | Low — doesn't affect maintainability grade | Not in scope |

---

## Action List (Highest Leverage First)

| # | Action | Phase ref | Risk | Effort |
|---|--------|-----------|------|--------|
| 1 | **Fix silent decryption corruption**: change `db.rs:375` `unwrap_or(blob)` to propagate the error | Critic finding 1 | Critical — data corruption | 1 line change |
| 2 | **Add test gate to CI**: run E2E tests (or at minimum `cargo test`) in both workflows' `validate` job | Gate gap | High — broken code ships | Medium — need headless display for WDIO |
| 3 | **Fix FTS rebuild for migrated notes**: extract `searchText` from KV value as fallback body in `fts_rebuild()` | Critic finding 2 | Medium — silent search gap | Low — <10 lines |
| 4 | **Add knip + cargo audit to beta workflow** for parity with stable | Gate gap | Medium — beta ships unchecked | Low — add 2 CI steps |
| 5 | **Generate IPC command map** from Rust signatures to eliminate manual alias drift | Boundary 1 | High — silent runtime failures | High — build system change |
| 6 | **Expand oxlint ruleset** beyond the current 7 rules to catch common issues | Gate gap | Low — more lint coverage | Low — add rules to `.oxlintrc.json` |
| 7 | **Remove dead `notes-content` namespace** from `COLLECTION_NAMESPACES` | Data model | Low — dead code | Low — 1 line |
| 8 | **Extract E2E helpers** (nav, delete patterns) into shared test files | Duplication | Low — maintainability | Low |
