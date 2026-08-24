# Card Preview Faithful — Design

**Date:** 2026-08-23
**Status:** Approved (brainstorming §§1-3)
**Scope:** Fix duplicate previews on Electron legacy import + make preview blocks faithful to editor while keeping 5-block / 240-char budget. Markdown import (`src/utils/import/helpers.js`) is out of scope.

## 1. Problem

Two independent gaps:

1. **Data — repeats.** Legacy Electron import (`src/utils/migration/legacyElectron.js` → `src/utils/onboarding/legacyContentToYjs.js` → `src/composable/useOnboardingFlow.js` → `seedWorkspaceDocFromData`) seeds the Yjs workspace doc with only 10 `SEED_META_FIELDS` (no `cardPreview`/`preview`). `src/utils/meta/meta-merge.js:30` `mergeNoteEntry` then treats every legacy note as `needsSnapshot`. Both `src/utils/meta/meta-store.js:140` `writeStoresFromWorkspace` and `:272` `backfillNotePreviews` reuse a single `Y.Doc tmp` and `Y.applyUpdate(tmp, snap)` cumulatively (`A, A+B, A+B+C…`). Hydration via `src/utils/storage/serializer.js: hydrateNote` then builds each preview from a superset doc → visually duplicate cards.

2. **Presentation — unfaithful.** `src/utils/note/cardPreview.js` (`MAX_BLOCKS=5`, `MAX_TOTAL=240`) and `src/components/home/HomeNoteCard.vue` preview CSS drifted from editor tokens (`src/assets/css/editor.css` + `src/lib/tiptap/exts/*/tailwind classes`). Preview also drops `column`/`columnContainer`, `horizontalRule`, and `marks`/`mentions` so structure doesn't match the editor.

Flow chosen: **Approach A-faithful (Option One)** — fix data, keep budgets, extend structural coverage, token-align visuals. No miniature editor HTML render. CSS ownership stays with requester.

## 2. Goals / Non-goals

**Goals**
- Every note rendered from its own content only (no cumulative snapshots).
- Preview keeps 5 blocks / 240 chars / per-kind limits (heading 72, paragraph 96, etc.), 1 visible image/table/media + `mediaCount`/`hasMore` pill.
- Preview blocks cover editor nodes faithfully: headings, paragraphs, quotes, code, lists, tasks, images, tables, `MEDIA_TYPES` (audio/video/file/mermaid/math/paper), callouts, plus `column` unwrapping and `horizontalRule`.
- Visual tokens faithfully match editor (when owner applies them).
- `MEDIA_TYPES` labels respect current locale, not import-time locale.

**Non-goals**
- Changing budgets, card shell (`h-[140px] overflow-hidden`, `eio-fade-y-4`), generic `Card.vue` wrapper, markdown import path, Yjs schema, or adding deps. No `<iframe>`/ProseMirror miniature.

## 3. Architecture

```
Editor TipTap JSON  ──► cardPreview.js::buildCardPreview/buildNotePreview
                         │ visitNode / extractInlineText (5/240 budget)
                         ▼
store/note/index.ts:persist() ──► Yjs workspace-doc (NOTE_META_FIELDS includes cardPreview)
                         ▲                    │
legacyElectron ──────────┘    seedWorkspaceDocFromData / mergeNoteEntry / writeStoresFromWorkspace / backfillNotePreviews
                                                  │
                                            hydrateNote ◄── fix accumulation here
                                                  ▼
                                         HomeNoteCard.vue preview-stack (per-kind block-card)
```

Only the legacy Electron onboarding path is touched for the data fix. The preview pipeline itself is extended minimally.

## 4. Component 1 — Data fix (repeat previews)

**Files:** `src/utils/meta/meta-store.js`, `src/utils/meta/meta-merge.js`, `src/utils/storage/serializer.js`, `src/utils/onboarding/legacyContentToYjs.js`, `src/utils/migration/legacyElectron.js`

**Changes**
1. `meta-store.js:272` `backfillNotePreviews` and `:140` `writeStoresFromWorkspace`: allocate a **fresh `Y.Doc` per snapshot iteration** (create inside loop, `destroy()` after). Remove the shared-`tmp` accumulation. This is the root fix — one new doc per note.
2. `meta-store.js:199` `SEED_META_FIELDS` + `meta-merge.js:30` `isContentLike`/`mergeNoteEntry`: include `cardPreview` (and `preview` alias if present) in the seeded fields, or ensure `hydrateNote` regenerates a missing preview so future seeds don't force the snapshot path. Belt-and-suspenders: seed it *and* regenerate if absent.
3. `legacyContentToYjs.js` / `legacyElectron.js`: after seeding, persist `cardPreview` into the meta map so `backfillNotePreviews` becomes a no-op for already-seeded notes.
4. No change to `cardPreview.js` budgets in this component.

**Error handling:** If a snapshot fails to decode, skip that note and leave `EMPTY_CARD_PREVIEW` — don't abort the batch. Existing `NOTE_META_FIELDS` write stays atomic per note.

## 5. Component 2 — Visual fidelity (owner-handled)

**File:** `src/components/home/HomeNoteCard.vue:428-908`

**Change:** Comment out all `.note-card-preview-*` rules. Keep base chrome (`.note-card`, `__title`, `__label`, `__action`, hover/active, touch fallbacks). Leave a `TODO(you)` header pointing to the two canonical sources:

- **Source A — `src/assets/css/editor.css`** — rounded `.75rem` (`--float-radius`), `ProseMirror pre`/`inline-code` `bg-neutral-50/dark:neutral-900`, blockquote, `tableWrapper` (`border-neutral-200/dark:700`, `th bg-neutral-100`), column tokens, `bn-image-node` frame.
- **Source B — `src/lib/tiptap/exts/*/tailwind classes`** — actual editor node styling: `callouts/*`, `code-block/*`, `table/*`, `multi-column/*`, `image.js`, `mermaid-block/*`, `math-block/*`, `file-block/*` (`create-file-block.js`), `paper-block/*`, etc. These are the faithful tokens to copy.

Shell preserved: `data-preview-shell` `h-[140px] overflow-hidden` + `eio-fade-y-4` + `note-card-preview-stack` layout.

Template stays as-is; per-kind class hooks remain (`is-heading`, `is-quote`, `is-code`, `is-media tone-*`, `is-task`, `is-table`, `is-callout`, `tone-*`).

## 6. Component 3 — Structural fidelity + bounds

**File:** `src/utils/note/cardPreview.js`

** invariants preserved:** `MAX_BLOCKS=5`, `MAX_TOTAL=240`, per-kind char limits (heading 72 / paragraph 96 / quote 96 / code 120 / table cell ~32 etc.), single visible image/table/media else `mediaCount`+`hasMore`, `EMPTY_CARD_PREVIEW` frozen, `buildCardPreview`/`buildNotePreview`/`visitNode`/`extractInlineText` shape.

**Changes**
1. **MEDIA_TYPES i18n closure:** Replace module-level `translations.value` capture with a factory `getMediaTypes()` (or accept `t` param) that reads the current locale at call time. Keeps the module pure and fixes stale labels after language switch.
2. **`visitNode` extensions:**
   - `column` / `columnContainer` / `columns` (editor `div[data-type='column*']`): unwrap — recurse into `node.content` as for `doc`, no new block kind, still budget-capped.
   - `horizontalRule`: push `{kind:'paragraph', text:'—'}` (minimal visible separator within budget) or skip with budget accounting so adjacent paragraphs don't merge silently.
   - Existing `bulletList`/`orderedList`/`listItem`/`taskList`/`taskItem` remain; `orderedList` unwraps like `bulletList` but preserves numbering via prefix in `text` if desired (optional).
3. **`extractInlineText`:**
   - Walk `node.content` fully including `hardBreak` → `' \n'`-ish (or space) instead of `''`.
   - Handle `mention` / `noteLink` / `text` with `marks` (bold/italic/highlight) — text extraction already via `node.text`; ensure marks don't cause drops. No mark serialization needed for the 240-char budget.

## 7. Data flow after fix

Legacy Electron import → `seedWorkspaceDocFromData` now seeds `cardPreview` → `mergeNoteEntry` no longer forces snapshot → `hydrateNote` only regenerates preview if truly missing → `writeStoresFromWorkspace`/`backfillNotePreviews` decode each snapshot in isolation → `HomeNoteCard` renders per-note blocks (max 5, 240 chars). No cumulative doc.

## 8. Testing

- **Unit (cardPreview.js):** column unwrap, `horizontalRule`, `hardBreak`, `mention`/`noteLink` text, `getMediaTypes` locale switch, 5/240 cap, single visible media + `mediaCount`, empty doc → `EMPTY_CARD_PREVIEW`.
- **Integration (meta-store):** three sequential legacy snapshots → assert each `hydrateNote(...).cardPreview.blocks[0].text` distinct (regression for the repeat bug). Mock `Y.Doc` apply sequence.
- **No visual snapshot** for CSS (owner's domain). Manual check: card stack visually matches editor tokens when owner applies Source A/B.

## 9. Rollout / Risks

- Smallest diff wins: data fix is a loop-scope `new Y.Doc()` move + field list addition; structural fix is 2-3 `case` branches + factory wrapper. No migration.
- Risk: fresh `Y.Doc` per note is slightly more allocs on large legacy imports (tens of notes) — negligible vs correctness.
- Fallback: if `cardPreview` missing on old installs, `buildNotePreview` regenerates on next `persist()` — self-healing.

## 10. Open decisions

None. All three sections approved 2026-08-23. CSS application is deferred to owner per explicit request.
