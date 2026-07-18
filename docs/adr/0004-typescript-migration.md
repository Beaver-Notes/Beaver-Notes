# ADR 0004: Incremental TypeScript Migration

**Status:** Accepted (2026-07-18)  
**Commits:** `62624ffb` (infrastructure), `2cb71f23` (stores)  
**Referenced items:** ARCHITECTURE_ASSESSMENT.md recommendation P4, TECHNICAL_DEBT_AUDIT.md design debt #2

## Context

The entire frontend was plain JavaScript with only a `jsconfig.json` for path aliases. No type checking existed at build time — IPC payload mismatches, missing store properties, and incorrect composable signatures were discovered at runtime. The codebase had 13 Pinia stores, ~37 composables, and 110+ Rust command invocations crossing the IPC boundary.

## Decision

Adopt an incremental, non-blocking migration strategy:

1. **Infrastructure (commit `62624ffb`):** Add `tsconfig.json` with `"allowJs": true, "checkJs": false` so TS files can coexist with JS files without breaking the build. Add `vue-tsc` for type checking. Convert the IPC layer (`src/lib/tauri/commands.ts`, `errors.ts`) to TypeScript — types the manual bridge as a stepping stone toward generated bindings (see ADR 0003).

2. **Stores (commit `2cb71f23`):** Convert all 13 Pinia stores from `.js` to `.ts` in a single wave. The note store (consolidated in Task 11) was the primary target; remaining stores (workspace, settings, folder, label, app, undo, i18n, passwd, note sub-stores) were converted for consistency.

`vue-tsc --noEmit` added as a CI gate alongside existing lint + test steps.

## Consequences

**Positive.**
- Compile-time checking for all Pinia store interfaces — `Note`, `Workspace`, `Folder` etc. match Rust serde payloads.
- IDE autocomplete and refactoring work correctly for converted files.
- `allowJs: true` means migration can continue incrementally file-by-file without blocking development.
- `vue-tsc` catches Vue SFC type errors that plain JS would miss.

**Negative.**
- ~13 store files + IPC layer converted in one commit — large diff that required coordination with the specta pilot landing immediately after.
- Note store sub-modules (`encryption.ts`, `lock.ts`, `backlinks.ts`) had interdependencies that made conversion harder than standalone stores.
- `checkJs: false` means unconverted JS files get no checking — discipline is needed to migrate them over time or risk accumulating a permanent JS/TS split.
- `vue-tsc` adds ~15s to the CI `typecheck` step.
