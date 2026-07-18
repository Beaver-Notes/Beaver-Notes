# Technical Debt Audit: Beaver Notes

## Executive Summary (Updated 2026-07-18)
- **Total debt score: 30/100** (improved from 42 — structural debt substantially resolved)
- **Top 3 risks:**
  1. ~~**Zero unit tests** — any regression ships silently~~ ✅ Vitest + cargo test baseline established; CI gated on both (`7a265756`)
  2. ~~**Vulnerable dependency chain** — mermaid pins dompurify 3.3.3 with 6 active CVEs~~ ✅ Upgraded to mermaid 11.x (`ed662b59`)
  3. **Manual IPC bridge** — 117-entry alias map + `normalizePayload` switch 🔶 Specta pilot replaced workspace family (`bf7f88e7`); remaining 100+ commands still use the old bridge
- **Recommended remaining actions:**
  1. Complete specta migration for remaining command families
  2. Convert remaining JS files to TypeScript (`checkJs: false` still active)
  3. Add integration tests for critical paths (E2E still can't run in CI)

---

## Debt Inventory

### Code Debt

> ✅ Items struck-through below were resolved by the 2026-07-18 codebase restructure.

| # | Issue | Location | Severity | Velocity Impact |
|---|-------|----------|----------|-----------------|
| 1 | ~~**God module** — `AppState` mixes 18+ concerns~~ | ~~`src-tauri/src/shared/mod.rs:236-258`~~ | ~~High~~ | ~~New contributors can't reason about state~~ ✅ `fb532814` |
| 2 | ~~**1329-line export file**~~ | ~~`src/utils/share/exportBulk.js`~~ | ~~High~~ | ~~Hard to test, modify, or parallelize~~ ✅ `726da1f5` |
| 3 | ~~**1210-line toolbar**~~ | ~~`src/components/note/NoteToolbar.vue`~~ | ~~Medium~~ | ~~Slow IDE~~ ✅ `fb48eba6`, `63d45761` |
| 4 | ~~**1140-line crypto module**~~ | ~~`src-tauri/src/shared/crypto.rs`~~ | ~~Medium~~ | ~~Hard to audit, test, or replace~~ ✅ `2d8c855d` |
| 5 | ~~**70 files with `console.log`/`console.error`**~~ | ~~across `src/`~~ | ~~Low~~ | ~~Noise in production~~ ✅ `e976c9a2` (scattered output); oxlint `no-console` rule added |
| 6 | **21+ eslint-disable comments** | `src/components/ui/*.vue`, `src/composable/*.js` | Low | Hidden lint violations accumulate — still open (Task 19 skipped) |

### Design Debt
| # | Issue | Location | Severity | Velocity Impact |
|---|-------|----------|----------|-----------------|
| 1 | **Manual IPC contract** — 117-entry alias map + `normalizePayload` switch; no type checking | `src/lib/tauri/commands.ts:5-352` | High | 🔶 Specta pilot (`bf7f88e7`) replaced for workspace family only |
| 2 | ~~**No TypeScript**~~ | ~~`src/`~~ | ~~Medium~~ | ~~No compile-time type checking~~ ✅ `62624ffb`, `2cb71f23` — IPC layer + all stores converted; remaining JS files under `checkJs: false` |
| 3 | ~~**Version mismatch** — `package.json` = `5.0.0-beta.1`, `Cargo.toml` = `5.0.0`~~ | ~~root files~~ | ~~Low~~ | ✅ `c180ddbd` |
| 4 | ~~**Note store scattered across 6 files**~~ | ~~`src/store/note/`~~ | ~~Medium~~ | ✅ `a05218f9` — consolidated into `index.ts` + 3 focused sub-modules |
| 5 | **37 composables** — some overlap | `src/composable/` | Low | 🔶 `useNoteMenu` deduped in `b7cbe5da`; remaining overlap still open |

### Test Debt
| # | Issue | Location | Severity | Velocity Impact |
|---|-------|----------|----------|-----------------|
| 1 | ~~**Zero unit tests**~~ | ~~project root~~ | ~~**Critical**~~ | ✅ Vitest baseline (`603cdc99`) + cargo test baseline (`b813ff8d`); CI gated on both (`7a265756`) |
| 2 | **E2E tests can't run in CI** | `tests/e2e/` | High | Still open — requires display server |
| 3 | ~~**No Vitest/Jest config**~~ | ~~project root~~ | ~~High~~ | ✅ `yarn test` works (`603cdc99`) |

### Dependency Debt
| # | Package | Current | Latest | Risk |
|---|---------|---------|--------|------|
| 1 | ~~**mermaid**~~ | ~~10.9.1 → 11.x~~ | ~~11.6.0+~~ | ✅ Upgraded `ed662b59` — dompurify CVEs closed |
| 2 | ~~**katex**~~ | ~~0.13.0 → 0.16.22~~ | ~~0.16.21~~ | ✅ Upgraded `bb382c95` |
| 3 | **mousetrap** | 1.6.5 | 1.6.5 | Unmaintained — still open |
| 4 | **yarn** | 1.22.22 | 4.x | Still open (Task 19 skipped) |
| 5 | **eslint** | 8.57.0 | 9.x | 🔶 Lint consolidated on oxlint (`bb382c95`); eslint remains installed but unused — removal deferred (Task 19 skipped) |

### Documentation Debt
| # | Area | Status | Impact |
|---|------|--------|--------|
| 1 | `ARCHITECTURE_ASSESSMENT.md` | Exists but references stale line numbers (e.g., `mod.rs:236-258` is now different) | Misleads new contributors |
| 2 | `ARCHITECTURE.md` | Good high-level overview but missing data flow for sync, import, and PDF export | Contributors unfamiliar with sync architecture |
| 3 | Inline docstrings | Rust side has good doc comments; JS side has almost none | Harder to understand IPC contracts |

### Infrastructure Debt
| # | Issue | Impact | Status |
|---|-------|--------|--------|
| 1 | ~~**No CI test step**~~ | ~~Regressions ship undetected~~ | ✅ `7a265756` — vitest + cargo test gated in CI |
| 2 | ~~**knip can't run**~~ | ~~Dead code detection broken~~ | ✅ `8e3547cb` — typescript devDep added |
| 3 | ~~**No structured error types in Rust**~~ | ~~Hard to distinguish error types~~ | ✅ `b4cd17e2` + batch migration — `AppError` enum with custom Serialize |
| 4 | ~~**`lint-staged` uses eslint, not oxlint**~~ | ~~Two linters coexist~~ | ✅ `bb382c95` — lint-staged consolidated on oxlint |

---

## Impact Assessment
- **Development velocity impact: Medium-High** — The manual IPC bridge and scattered note logic add ~20-30% overhead to every feature touching data. Zero unit tests mean every change requires manual verification.
- **Risk exposure: Medium** — Vulnerable dompurify via mermaid is the highest security risk. The lack of unit tests means regressions are found by users, not developers.
- **Business impact: Medium** — As a beta (5.0.0-beta.1), debt here is acceptable for velocity, but the test gap will compound as the user base grows.

---

## Prioritized Remediation Plan

### ✅ Phase 1: Quick Wins (Completed 2026-07-18)
| Item | Debt Type | Status |
|------|-----------|--------|
| Upgrade `mermaid` to 11.x | Dependency | ✅ `ed662b59` |
| Install `typescript` dev dep so `knip` works | Infrastructure | ✅ `8e3547cb` |
| Align versions: `Cargo.toml` → `5.0.0-beta.1` | Code | ✅ `c180ddbd` |
| Add Vitest + 1 smoke test per Pinia store | Test | ✅ `603cdc99` |
| Remove `console.log` from non-error paths (70 files) | Code | ✅ `e976c9a2` |

### ✅ Phase 2: Strategic Improvements (Completed 2026-07-18)
| Item | Debt Type | Status |
|------|-----------|--------|
| Refactor `AppState` into focused structs | Design | ✅ `fb532814` |
| Extract `NoteToolbar.vue` into smaller components | Code | ✅ `fb48eba6` |
| Consolidate note store | Design | ✅ `a05218f9` |
| Add structured error types (`AppError` enum) to Rust commands | Design | ✅ `b4cd17e2` + batch migration |
| Add cargo test + Vitest to CI pipeline | Infrastructure | ✅ `7a265756` |

### Phase 3: Remaining
| Item | Debt Type | Status |
|------|-----------|--------|
| ~~Introduce TypeScript for frontend~~ | Design | ✅ `62624ffb`, `2cb71f23` — core done; remaining JS files under `checkJs: false` |
| Generate IPC bridge from Rust command signatures | Design | 🔶 Pilot done (`bf7f88e7`); remaining families deferred |
| Split `crypto.rs` into focused modules | Code | ✅ `2d8c855d` |
| Upgrade to Yarn 4 (or npm/pnpm) | Dependency | ❌ open (Task 19 skipped) |
| Migrate ESLint to flat config (v9) | Infrastructure | ❌ open (Task 19 skipped) |
| Complete specta migration for remaining command families | Design | 🔶 open |
| Convert remaining JS files to TS (remove `checkJs: false`) | Design | 🔶 open |

---

## Key Observations (Updated 2026-07-18)

1. ✅ Top-level structure remains clean. All Phase 1-2 structural debt resolved.
2. 🔶 IPC bridge is now the **remaining** velocity bottleneck — specta pilot proven, but 100+ commands still pass through the manual bridge.
3. ✅ Test gap substantially closed — Vitest + cargo test baseline; CI gated. E2E still can't run in CI.
4. ✅ mermaid/dompurify CVEs resolved.
5. 🔶 Full TypeScript migration still in progress (`checkJs: false`); JS files remain.
