# Architecture Assessment: Beaver Notes

## Current State

- **Tech stack**: Tauri 2 (Rust) + Vue 3 + Pinia + TipTap (rich-text editor) + SQLite + Yjs CRDT
- **Architectural pattern**: Layered architecture with IPC bridge between frontend and backend
- **Module structure**: Well-organized with clear separation between frontend (src/) and backend (src-tauri/src/)

## Dependency Map

```
┌─────────────────────────────────────────────────────────────────┐
│                        Frontend (Vue 3)                         │
├─────────────────────────────────────────────────────────────────┤
│  Pages → Components → Stores → Lib/tauri/commands.js            │
│                              ↓                                  │
│                    Tauri IPC Bridge (invoke)                     │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                      Backend (Rust/Tauri)                       │
├─────────────────────────────────────────────────────────────────┤
│  Commands → shared/mod.rs → db.rs → SQLite                      │
│           → shared/crypto.rs → Encryption                       │
└─────────────────────────────────────────────────────────────────┘
```

## Architectural Smells

> ✅ Items struck-through below were resolved by the 2026-07-18 codebase restructure. See commits: `fb532814` (AppState split), `a05218f9` (note store consolidation + feature envy fix), `bf7f88e7` (specta pilot — manual alias/normalize fully replaced for workspace commands; remaining families deferred).

| # | Smell | Location | Impact | Effort to Fix |
|---|-------|----------|--------|---------------|
| 1 | ~~**God Module**~~ | ~~`src-tauri/src/shared/mod.rs:236-258`~~ | ~~AppState struct has 18+ fields mixing unrelated concerns (crypto, caching, UI state, file management)~~ | ~~M~~ |
| 2 | ~~**Leaky Abstraction**~~ | ~~`src/lib/tauri/commands.js:117`~~ | ~~117-entry command alias map with manual normalization creates tight coupling between JS and Rust~~ | ~~L~~ |
| 3 | ~~**Shotgun Surgery**~~ | ~~`src/store/note/crud.js`~~ | ~~Note operations scattered across helpers.js, crud.js, search.js, backlinks.js, encryption.js~~ | ~~M~~ |
| 4 | ~~**Feature Envy**~~ | ~~`src/store/note/helpers.js:16-19`~~ | ~~syncFtsIndex directly accesses note properties instead of using store getters~~ | ~~S~~ |
| 5 | **Duplicated Logic** | `src/lib/tiptap/index.js:65-177` | createBaseExtensions creates new extension instances on each call (though memoized at module level) | XS |
| 6 | ~~**Manual Sync**~~ | ~~`src/lib/tauri/commands.js:142-352`~~ | ~~normalizePayload switch statement must be manually updated for every new command parameter~~ | ~~M~~ |

## Recommendations

| Priority | Recommendation | Impact | Effort | Risk | Status |
|----------|----------------|--------|--------|------|--------|
| P1 | **Refactor AppState** | High | M | Low | ✅ `fb532814` |
| P2 | **Generate IPC bridge** | High | L | Medium | 🔶 Pilot done `bf7f88e7` — full migration deferred |
| P3 | **Consolidate note operations** | Medium | M | Low | ✅ `a05218f9` |
| P4 | **Add TypeScript** | Medium | L | Low | ✅ `62624ffb` / `2cb71f23` |
| P5 | **Implement proper error types** | Medium | M | Low | ✅ `b4cd17e2` + batch migration |

## Refactoring Roadmap

### ✅ Phase 1 (Quick Wins — Completed 2026-07-18)
- ~~Add TypeScript configuration and convert critical paths~~ ✅ `62624ffb`, `2cb71f23`
- ~~Create structured error types for Rust commands~~ ✅ `b4cd17e2` + batch migration
- Document IPC contract between frontend and backend (this ADR + ADR 0003)

### ✅ Phase 2 (Strategic — Completed 2026-07-18)
- ~~Refactor AppState into focused state structs~~ ✅ `fb532814`
- ~~Consolidate note operations into a service layer~~ ✅ via store consolidation `a05218f9`
- ~~Implement code generation for IPC bridge~~ 🔶 Pilot `bf7f88e7` — full migration deferred

### Phase 3 (Remaining)
- Migrate remaining command families to specta bindings (beyond workspace pilot)
- Add comprehensive integration tests
- Implement proper dependency injection for testability

## Key Observations

1. **Well-structured codebase** - Clear separation between frontend and backend
2. **Good use of patterns** - Pinia stores, modular Rust commands, CRDT for collaboration
3. **Security-conscious** - Proper encryption architecture with key hierarchy
4. **Missing type safety** - JavaScript IPC bridge lacks compile-time validation
5. **Growing complexity** - AppState and command normalization need refactoring

## Positive Aspects

- **Encryption architecture** is well-designed with proper key hierarchy
- **CRDT integration** with Yjs/yrs provides solid collaboration foundation
- **Multi-workspace support** is cleanly implemented
- **Asset caching** with proper TTL and size limits
- **Path security** with strict access controls

## Technical Debt (Updated 2026-07-18)

1. ~~**IPC Bridge** - 117-entry manual alias map is fragile~~ 🔶 Specta pilot (`bf7f88e7`) replaced workspace family; remaining families still use the old bridge
2. ~~**AppState** - Mixed concerns make testing difficult~~ ✅ `fb532814`
3. ~~**String errors** - Lose context and make debugging harder~~ ✅ `b4cd17e2` + batch migration
4. ~~**No TypeScript** - Runtime errors that could be caught at compile time~~ ✅ `62624ffb`, `2cb71f23`

## Next Steps (Updated 2026-07-18)

1. 🔶 Complete specta migration for remaining command families (beyond workspace pilot)
2. 🔶 Add integration tests for critical paths
3. 🔶 Evaluate dependency injection for Rust testability
4. ✅ ADRs documented in `docs/adr/0001-0004`
5. 🔶 Convert remaining JS files to TypeScript (currently `checkJs: false`)