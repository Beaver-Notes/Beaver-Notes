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

| # | Smell | Location | Impact | Effort to Fix |
|---|-------|----------|--------|---------------|
| 1 | **God Module** | `src-tauri/src/shared/mod.rs:236-258` | AppState struct has 18+ fields mixing unrelated concerns (crypto, caching, UI state, file management) | M |
| 2 | **Leaky Abstraction** | `src/lib/tauri/commands.js:117` | 117-entry command alias map with manual normalization creates tight coupling between JS and Rust | L |
| 3 | **Shotgun Surgery** | `src/store/note/crud.js` | Note operations scattered across helpers.js, crud.js, search.js, backlinks.js, encryption.js | M |
| 4 | **Feature Envy** | `src/store/note/helpers.js:16-19` | syncFtsIndex directly accesses note properties instead of using store getters | S |
| 5 | **Duplicated Logic** | `src/lib/tiptap/index.js:65-177` | createBaseExtensions creates new extension instances on each call (though memoized at module level) | XS |
| 6 | **Manual Sync** | `src/lib/tauri/commands.js:142-352` | normalizePayload switch statement must be manually updated for every new command parameter | M |

## Recommendations

| Priority | Recommendation | Impact | Effort | Risk |
|----------|----------------|--------|--------|------|
| P1 | **Refactor AppState** - Split into focused structs (CryptoState, CacheState, UiState, WorkspaceState) | High | M | Low |
| P2 | **Generate IPC bridge** - Use Tauri's type-safe invoke or code generation to eliminate manual alias map | High | L | Medium |
| P3 | **Consolidate note operations** - Create a NoteService class that encapsulates all note-related operations | Medium | M | Low |
| P4 | **Add TypeScript** - Introduce TypeScript for frontend to catch type mismatches at compile time | Medium | L | Low |
| P5 | **Implement proper error types** - Replace String errors with structured error types in Rust backend | Medium | M | Low |

## Refactoring Roadmap

### Phase 1 (Quick Wins)
- Add TypeScript configuration and convert critical paths
- Create structured error types for Rust commands
- Document IPC contract between frontend and backend

### Phase 2 (Strategic)
- Refactor AppState into focused state structs
- Consolidate note operations into a service layer
- Implement code generation for IPC bridge

### Phase 3 (Long-term)
- Migrate to Tauri 2's type-safe invoke system
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

## Technical Debt

1. **IPC Bridge** - 117-entry manual alias map is fragile
2. **AppState** - Mixed concerns make testing difficult
3. **String errors** - Lose context and make debugging harder
4. **No TypeScript** - Runtime errors that could be caught at compile time

## Next Steps

1. Prioritize P1 (AppState refactoring) for better maintainability
2. Evaluate Tauri 2's type-safe invoke for P2
3. Add integration tests for critical paths
4. Document architecture decisions in ADRs