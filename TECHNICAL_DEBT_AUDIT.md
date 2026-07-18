# Technical Debt Audit: Beaver Notes

## Executive Summary
- **Total debt score: 42/100** (moderate — the codebase is functional but has significant structural debt)
- **Top 3 risks:**
  1. **Zero unit tests** — any regression ships silently; E2E tests can't run in CI
  2. **Vulnerable dependency chain** — mermaid pins dompurify 3.3.3 with 6 active CVEs (moderate severity)
  3. **Manual IPC bridge** — 117-entry alias map + `normalizePayload` switch must stay in sync with 110 Rust commands manually
- **Recommended immediate actions:**
  1. Upgrade mermaid to 11.x (fixes dompurify CVEs) or pin dompurify >=3.4.7
  2. Add Vitest + one smoke test per store to establish unit test baseline
  3. Align version strings: `package.json` says `5.0.0-beta.1`, `Cargo.toml` says `5.0.0`

---

## Debt Inventory

### Code Debt
| # | Issue | Location | Severity | Velocity Impact |
|---|-------|----------|----------|-----------------|
| 1 | **God module** — `AppState` mixes 18+ concerns (crypto, caching, UI state, file mgmt, workspace) | `src-tauri/src/shared/mod.rs:236-258` | High | New contributors can't reason about state; changes ripple everywhere |
| 2 | **1329-line export file** — bulk export logic, CSS constants, highlight maps, markdown rendering all in one | `src/utils/share/exportBulk.js` | High | Hard to test, modify, or parallelize |
| 3 | **1210-line toolbar** — single SFC with template + script + logic | `src/components/note/NoteToolbar.vue` | Medium | Slow IDE, hard to reason about state |
| 4 | **1140-line crypto module** — encryption, key derivation, asset crypto, manifest, legacy migration all in one file | `src-tauri/src/shared/crypto.rs` | Medium | Hard to audit, test, or replace individual algorithms |
| 5 | **70 files with `console.log`/`console.error`** — scattered debug output | across `src/` | Low | Noise in production, no structured logging |
| 6 | **21+ eslint-disable comments** — linting suppressed across UI components and composables | `src/components/ui/*.vue`, `src/composable/*.js` | Low | Hidden lint violations accumulate |

### Design Debt
| # | Issue | Location | Severity | Velocity Impact |
|---|-------|----------|----------|-----------------|
| 1 | **Manual IPC contract** — 117-entry alias map + `normalizePayload` switch; no type checking | `src/lib/tauri/commands.js:5-352` | High | Every new command requires 3 manual edits (alias, normalization, lib.rs registration) |
| 2 | **No TypeScript** — entire frontend is plain JS with `jsconfig.json` only | `src/` | Medium | No compile-time type checking; IDE autocomplete unreliable |
| 3 | **Version mismatch** — `package.json` = `5.0.0-beta.1`, `Cargo.toml` = `5.0.0` | root files | Low | Confusion in release automation and user reporting |
| 4 | **Note store scattered across 6 files** — CRUD, search, lock, encryption, backlinks, helpers | `src/store/note/` | Medium | Finding where logic lives requires traversing 6 files |
| 5 | **37 composables** — some overlap (`useNoteMenu`, `useNoteMenuActions`, `useNoteMenuState`) | `src/composable/` | Low | Discoverability friction for new contributors |

### Test Debt
| # | Issue | Location | Severity | Velocity Impact |
|---|-------|----------|----------|-----------------|
| 1 | **Zero unit tests** — no test framework installed, no `.spec.js` or `.test.js` files outside E2E | project root | **Critical** | Any change can introduce silent regressions |
| 2 | **E2E tests can't run in CI** — require display server (`wdio.conf.mjs` spawns Tauri app) | `tests/e2e/` | High | Release CI has zero test gates |
| 3 | **No Vitest/Jest config** — can't even `yarn test` | project root | High | New contributors can't verify changes locally |

### Dependency Debt
| # | Package | Current | Latest | Risk |
|---|---------|---------|--------|------|
| 1 | **mermaid** | 10.9.1 | 11.6.0+ | Pins dompurify 3.3.3 with **6 active CVEs** (XSS, prototype pollution) |
| 2 | **katex** | 0.13.0 | 0.16.21 | 16 versions behind; likely has bug fixes and security patches |
| 3 | **mousetrap** | 1.6.5 | 1.6.5 | Unmaintained (last commit 2018); no security response |
| 4 | **yarn** | 1.22.22 | 4.x | Yarn 1 is legacy; no PnP, no strict mode, slower installs |
| 5 | **eslint** | 8.57.0 | 9.x | ESLint 8 is EOL; flat config migration needed eventually |

### Documentation Debt
| # | Area | Status | Impact |
|---|------|--------|--------|
| 1 | `ARCHITECTURE_ASSESSMENT.md` | Exists but references stale line numbers (e.g., `mod.rs:236-258` is now different) | Misleads new contributors |
| 2 | `ARCHITECTURE.md` | Good high-level overview but missing data flow for sync, import, and PDF export | Contributors unfamiliar with sync architecture |
| 3 | Inline docstrings | Rust side has good doc comments; JS side has almost none | Harder to understand IPC contracts |

### Infrastructure Debt
| # | Issue | Impact | Remediation |
|---|-------|--------|-------------|
| 1 | **No CI test step** — release workflow runs lint + audit only | Regressions ship to production undetected | Add Vitest + cargo test to CI |
| 2 | **knip can't run** — requires `typescript` package which isn't installed | Dead code detection tooling broken | Install TypeScript or use knip's JS mode |
| 3 | **No structured error types in Rust** — commands return `Result<_, String>` | Hard to distinguish error types on JS side | Create `AppError` enum with `thiserror` |
| 4 | **`lint-staged` uses eslint, not oxlint** — two linters coexist | Confusing; oxlint is the configured `yarn lint` | Consolidate on one linter |

---

## Impact Assessment
- **Development velocity impact: Medium-High** — The manual IPC bridge and scattered note logic add ~20-30% overhead to every feature touching data. Zero unit tests mean every change requires manual verification.
- **Risk exposure: Medium** — Vulnerable dompurify via mermaid is the highest security risk. The lack of unit tests means regressions are found by users, not developers.
- **Business impact: Medium** — As a beta (5.0.0-beta.1), debt here is acceptable for velocity, but the test gap will compound as the user base grows.

---

## Prioritized Remediation Plan

### Phase 1: Quick Wins (1-2 sprints)
| Item | Debt Type | Effort | Impact |
|------|-----------|--------|--------|
| Upgrade `mermaid` to 11.x (fixes dompurify CVEs) | Dependency | S | High — closes 6 security advisories |
| Install `typescript` dev dep so `knip` works | Infrastructure | XS | Medium — re-enables dead code detection |
| Align versions: `Cargo.toml` → `5.0.0-beta.1` | Code | XS | Low — avoids confusion |
| Add Vitest + 1 smoke test per Pinia store | Test | M | High — establishes unit test baseline |
| Remove `console.log` from non-error paths (70 files) | Code | S | Low — cleaner production output |

### Phase 2: Strategic Improvements (3-6 sprints)
| Item | Debt Type | Effort | Impact |
|------|-----------|--------|--------|
| Refactor `AppState` into focused structs (`CryptoState`, `CacheState`, `WorkspaceState`) | Design | M | High — reduces cognitive load for Rust contributions |
| Extract `NoteToolbar.vue` into smaller components | Code | M | Medium — improves maintainability |
| Consolidate note store (merge `crud.js`, `helpers.js`, `search.js` into fewer modules) | Design | M | Medium — reduces shotgun surgery |
| Add structured error types (`AppError` enum) to Rust commands | Design | M | Medium — better error handling on JS side |
| Add cargo test + Vitest to CI pipeline | Infrastructure | M | High — prevents regressions from shipping |

### Phase 3: Long-term (6+ sprints)
| Item | Debt Type | Effort | Impact |
|------|-----------|--------|--------|
| Introduce TypeScript for frontend (incremental) | Design | L | High — compile-time type safety for IPC |
| Generate IPC bridge from Rust command signatures | Design | XL | High — eliminates manual alias map |
| Split `crypto.rs` into focused modules (key-mgmt, asset-crypto, legacy) | Code | L | Medium — easier to audit crypto code |
| Upgrade to Yarn 4 (or npm/pnpm) | Dependency | M | Low — better perf, stricter deps |
| Migrate ESLint to flat config (v9) | Infrastructure | S | Low — ESLint 8 is EOL |

---

## Key Observations

1. **The codebase is well-structured at the top level** — clear separation between frontend (`src/`) and backend (`src-tauri/`), good use of Pinia stores, and a thoughtful encryption architecture.
2. **The IPC bridge is the single biggest velocity bottleneck** — every new Rust command requires manual edits in 3 places with no compile-time validation.
3. **The test gap is the biggest risk** — a project of this complexity (CRDT sync, encryption, multi-workspace) with zero unit tests is a regression waiting to happen.
4. **The mermaid/dompurify CVEs are the most urgent security fix** — 6 moderate-severity vulnerabilities, including prototype pollution and XSS bypass.
