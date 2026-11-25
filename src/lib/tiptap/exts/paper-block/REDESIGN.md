# REDESIGN — Apple Notes base (PORTING.md §3)

Redesign of `paper-block` around Apple's model (see `../../../Apple notes REA/PORTING.md`):
no "drawing mode" — **one surface owns the pointer at a time** (`activeTool` persisted,
`paletteVisible`, stroke-in-progress), inline drawing = a node in the same document
(A9–A13), full-screen editor on tap (A11), chrome lock while stroking (A7), find-mode
suppression (A8), scribble handled by gesture scope + focus discipline (A2/A3).

Target file layout (per 2026-11-20 discussion) and **locked contracts**. This document is
the interface source of truth; implementation follows bottom-up: inkCanvas → inkModel(1-3)
→ previewImage → useInkCanvas → submitQueue → useInkModel → paperCore/inkPaper → views.

## Module contracts

### `ink/inkCanvas.js` — DOM + painting primitives
- `px(value)` → `` `${value}px` ``.
- `changeDrawing(canvas, { rect, dpr })` → sizes one `<canvas>` (backing store × dpr,
  CSS px size) and sets its 2d transform to `(dpr,0,0,dpr,0,0)`.
- `class InkCanvas` — wraps 2–3 stacked canvases:
  - **drawing**: committed strokes (this is the bitmap that persists).
  - **subtree**: shape overlays / lasso selection tint (shares drawing's transform).
  - **interactive** (optional): live in-progress stroke; cleared every frame, never
    part of the committed bitmap.
  - `changeDrawing({ rect, dpr })` → sizes all attached canvases.
  - `bounds()` → `drawing.getBoundingClientRect()`.
  - `rounding()` → **device-pixel snap factor** = `dpr` (adjustment from v1 plan:
    `Math.round(1/dpr)` is wrong; culling rects are snapped outward by `dpr`
    (`Math.floor(v*dpr)/dpr`, `Math.ceil(v*dpr)/dpr`) so half-pixel clears never
    leave seams at dpr 2/3).
  - `contextOf(kind)` → 2d ctx or null.
  - `paintStrokes(strokes, bounds, rect)` → clear `rect`, fill strokes intersecting it.
    **Culling expands each stroke's bounds by its strip width** (`round(size * 0.75 + 2)`,
    perfect-freehand outline feather) — plain geometry bounds leave sub-pixel seams
    (adjustment #2: current `renderer.js` flush uses exact bounds and seams on
    highlighter; the margin fixes it).

### `ink/useInkCanvas.js` — per-surface canvas wiring
- `setup(container, drawing, opts)` → `InkCanvas` instance, hidden sentinel div inside
  container + `ResizeObserver` → `fitCanvas` (debounced via rAF; initial 0×0 fire ignored).
- `fitCanvas(...)` exported for direct use in tests.
- `changeDrawing(rect)` public method: `{ rect, dpr }` — **same shape as
  `InkCanvas.changeDrawing`** (adjustment #3: keep one signature everywhere).

### `ink/inkModel.js`
- `makeStroke(id, tool, color, size, opacity, points, extra)` → stroke object.
- `StrokeDrawable.drawStroke(ctx, stroke)` → one fill path (no Path2D; happy-dom safe).
- `import { strokeOutline } from './smoother.js'` (kept — not replaced).

### `ink/inkModel2.js`
- `import { strokeBounds } from './stroke-model.js'` (kept as the bounds source).
- `moveStrokes(strokes, dx, dy)` → `{ strokes, bounds }`; bounds realigned (same order).
- `eraseStrokes(strokes, x, y, radius)` → `{ strokes, bounds, removedIds }`;
  segment splitting via `splitStrokeByEraser` (from `renderer.js` — **moved here**,
  renderer.js retired after the port).

### `ink/inkModel3.js`
- `replaceStrokes(strokes, replaceIds, replacement)` → `{ strokes, bounds }`.
- `ensureUniqueIds(strokes)` → suffix duplicates (`id_2`) — guards paste collisions.

### `ink/previewImage.js`
- `getStroke(stroke, size)` → outline strip polygon (for the tldraw-style static preview).
- `cleanBitmap()` → final clear pass removing fade residue.
- `class PreviewImage` → offscreen bitmap; composite stroke bands; fade-out animation.
- `parsePreviewImage(data)` → same instance from serialized attr.
- Strokes render into the preview at **committed time** (not per frame) — the inline node
  never repaints from Yjs on every keystroke elsewhere in the note.

### `ink/useInkModel.js`
- `actions` = pure names (`move`, `select`, `erase`, `pen`, `shape`, `zoom`) fed to
  snapshot/undo logic; `inkModel` = `{ strokes: [], strokesBounds: [] }`.
- `generateSnapshot(inkModel, selectionIds)` / `restoreSnapshot({ strokes, bounds }, selectionIds)`.

### `ink/submitQueue.js` (new, not in the original list — needed)
- Coalesces rapid stroke commits: consecutive edits to the **same stroke id** merge into
  one transaction; different ids flush FIFO in one transaction.
- Rationale: today every `commit` is its own `updateAttributes` transaction (one history
  entry per stroke + one Yjs op per stroke). Apple's undo granularity is per stroke
  (A21 command stack) and its sync is mergeable data — we match observable behavior with
  one op per completed stroke, not per pointermove.
- Owns **fit-to-document** bookkeeping the same way (height growth folded into the same
  transaction as the stroke that caused it — no flash).

### `paperCore.js` / `inkPaper.js`
- `paperCore.js` = per-surface engine factory: gesture state machine (draw/erase/lasso/
  move-selection — ported from current `PaperSurface.vue`), glued to `useInkCanvas` +
  `useInkModel` + `submitQueue`. No TipTap/Vue imports.
- `inkPaper.js` = `paperCore` + ink specifics: shape recognizer double-tap (keep
  `recognizer.js`), pencil double-tap insert handoff (keep `double-tap-insert.js`),
  image-markup entry (keep `imageMarkup.js`), `useInkInput` scribble policy.

### `ink/useInkInput.js` (new — the scribble answer, Apple A2/A3/A7/A8)
- `beginStroke()` / `endStroke()`: glyph-scoped `setScribbleSuppressed('ink:'+id, …)`
  only while a stroke is in flight (today a *focus* watcher suppresses scribble
  app-wide — the "cannot differentiate" bug). `isFinding` gate blocks begin (A8).
- `strokeActive` drives the chrome lock (A7) via a store flag.

### Views
- `Paper.vue` (NodeView): node attrs (`strokes`, `height`, `paperType`, `preview`) →
  `InkSurface`; resize via `setNodeMarkup` (A10); tap → emit full-screen (A11);
  renders `<InkPreviewImage>` when not editing (A12) and the canvas when editing.
- `InkPreviewImage.vue`: the node's non-editing render — parses `preview` attr, falls
  back to a composited stroke bitmap when absent.
- `PaperToolbar.vue`: unchanged position (fixed bottom, editing-only) — becomes the
  PKToolPicker analog (A5: `activeTool` persisted in localStorage).

## Retired after the port
`ink/renderer.js` (dirty-rect engine → inkCanvas.paintStrokes + inkModel2), old
focus-based scribble watch in `PaperSurface.vue`, per-stroke `updateAttributes` commits
(→ submitQueue), `InkPreview.vue` (→ InkPreviewImage.vue).

## Phase order (each phase leaves the suite green)
A. inkCanvas + useInkCanvas + specs
B. inkModel/2/3 + specs (splitStrokeByEraser moves here)
C. previewImage + InkPreviewImage.vue + specs
D. submitQueue + useInkModel + useInkInput + specs
E. paperCore/inkPaper + Paper.vue/PaperSurface.vue/index.js rewired; old modules deleted
F. full-screen editor on tap (A11) + palette persistence (A5) + chrome lock store wiring

## Test command
`NODE_OPTIONS='--localstorage-file=/tmp/vitest-localstorage' npx vitest run src/lib/tiptap/exts/paper-block`