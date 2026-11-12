# Feasibility Report — Root-level ProseMirror Virtualization

**Source:** prosemirror-view v1.42.3 (installed via `@tiptap/pm`)
**Fixture:** 3000 blocks / 500 tables / 49,493 DOM elements (`__heavy__`)
**Current cost:** EditorView DOM construction ~1.6s of the ~2s open; CustomTableView = 93 elements/table

---

## 1. How prosemirror-view builds the DOM today (the bottleneck)

`EditorView` construction → `docViewDesc(doc, ...)` (dist/index.js:1518)
1. Creates a root `NodeViewDesc` for the `doc` node.
2. Calls `docView.updateChildren(view, 0)` which runs `ViewTreeUpdater` over **all** top-level document children.
3. `ViewTreeUpdater.addNode` (dist/index.js:1968) calls `NodeViewDesc.create(this.top, node, ..., view, pos)` for **every** top-level node, synchronously, upfront.
4. `NodeViewDesc.create` (dist/index.js:1296) calls `view.nodeViews[node.type.name](node, view, getPos, outerDeco, innerDeco)` — the node view factory — and reads `spec.dom`. For `CustomTableView` that builds `blockContainer` + `innerTableContainer` + `widgetsContainer` + `overlayContainer` ≈ 93 DOM elements **per table**, for all 500 tables, before the first paint.

There is **no lazy path** in the public API. The `nodeViews` factory is invoked for every top-level node on init, and its `dom` is immediately inserted into the editor DOM. That is the ~1.6s cost (≈30µs/node of ProseMirror's own per-node construction, measured separately from layout).

---

## 2. Exact ProseMirror invariants that block pure-API virtualization

These are the invariants a virtualization scheme must either preserve or work around:

| Invariant | Location | Why it blocks lazy rendering |
|---|---|---|
| `NodeViewDesc.create` runs for every top-level node on init | `ViewTreeUpdater.addNode` :1968 → `NodeViewDesc.create` :1296 | Can't defer DOM construction via public API; factory is called synchronously for all nodes. |
| `desc.dom` is required real DOM | `ViewDesc.domFromPos` :922, `descAt` :902, `domFromPos` returns `{node: this.dom, ...}` | `domAtPos(pos)` (EditorView:5794) is used by selection rendering, click handling, `nodeDOM(pos)`. Virtual nodes have no `dom`. |
| `posFromDOM` walks view descs to map DOM→position | `ViewDesc.posFromDOM` :892, EditorView:5820 | Event handlers (click, drop, paste) resolve DOM targets to document positions via the view desc tree. |
| Selection rendered via `domFromPos(anchor/head)` | EditorView `update` ~line 1034 | A collapsed cursor or text selection must resolve to a real DOM node/offset. |
| `NodeViewDesc.update(node)` returns false → view desc destroyed & recreated | `updateNodeAt` :1887, `recreateWrapper` :1952 | There is no public "rematerialize this index" trigger; `update()` only runs when a transaction changes that node. |
| Custom node views read `dom` in constructor | `CustomTableView.constructor` :4-35 | Tables measure/wrap DOM at construction; deferring construction defers this. |

**Conclusion:** It is **not possible** to achieve true root-level virtualization (materialize only visible top-level children, keep full doc in ProseMirror) using only prosemirror-view's public API. You must fork/modify `prosemirror-view`.

---

## 3. Option analysis

### Option A — Fork prosemirror-view (the proposal's approach)
Copy `prosemirror-view` into the repo (e.g. `src/lib/pm-view-fork/`) and add a `virtualizeTopLevel` option.

**Design:**
- `EditorView` accepts `virtualizeTopLevel: { threshold, overscanPx }`.
- In `ViewTreeUpdater`, for top-level nodes outside viewport + overscan: create a **placeholder** `NodeViewDesc` with a zero-size `dom` (`<div style="height:0;overflow:hidden">`), **do not** call the `nodeViews` factory, do not build real DOM.
- Track estimated height per virtual node (default ~300px, or measured after first materialization).
- On scroll/selection, when a virtual node enters the overscan zone: **materialize** it — replace the placeholder desc with a real `NodeViewDesc` via the node view factory, build full DOM, splice into the view tree.
- `domFromPos`/`posFromDOM`/`descAt`: for virtual nodes, return placeholder dom; resolve positions using accumulated estimated heights (proportional scrolling).
- Selection: if selection lands in a virtual node, materialize that node first (synchronously), then render cursor.
- Decorations: skip decorating virtual nodes until materialized.

**Pros:** Full control; keeps complete doc in ProseMirror + Yjs; no format change; supports arbitrary node types; only visible DOM built.

**Cons:** Fork maintenance (security updates, upstream drift); Tiptap bundles `@tiptap/pm` which re-exports prosemirror-view — you'd point the import at the fork; significant surface area (selection, decorations, node views, mutations, copy/paste, input rules all touch `docView`).

### Option B — Public-API placeholder only (no fork)
Return a cheap placeholder DOM (`<div contain-intrinsic-size="auto 300px">`) from `nodeViews` for off-screen nodes, accept that off-screen content never becomes real DOM.

**Pros:** No fork; avoids building 500×93 table DOMs upfront (biggest win).

**Cons:** Cannot materialize later (no clean rematerialize trigger); off-screen tables/paragraphs are inert placeholders — clicking them doesn't edit; breaks selection-in-placeholder, decorations, extensions that read `nodeDOM`. Not a complete solution, only a partial DOM-size win. Rejected as standalone.

### Option C — Virtual-scrolling wrapper outside ProseMirror
Multiple editor instances / windowing.

**Cons:** Proposal explicitly rules out ("Do not create separate Tiptap instances"); breaks single-document selection, undo, Yjs binding, search. Rejected.

---

## 4. Fork-based virtualization — detailed design

### 4.1 Fork location & wiring
- Copy `node_modules/prosemirror-view/dist/*` + source into `src/lib/pm-view-fork/`.
- Update `@tiptap/pm` import path in Beaver-Notes tiptap setup (or alias `prosemirror-view` in Vite config) to resolve to the fork.
- Keep in sync: `package.json` `prosemirror-view` stays as a transitive dep but is shadowed.

### 4.2 Changes to the fork
1. `EditorView` constructor: accept `virtualizeTopLevel` prop; pass to `docViewDesc`.
2. `docViewDesc` / `ViewTreeUpdater`: track viewport rect + overscan; mark top-level nodes as `virtual` vs `materialized`.
3. `NodeViewDesc.create` forked: if virtual, build placeholder dom only, skip `nodeViews` factory call.
4. `ViewTreeUpdater` gains `materialize(index, view)` — replaces placeholder desc at `index` with a real `NodeViewDesc` (calls factory, builds DOM), splices into `this.top.children`, marks changed.
5. `ViewDesc.domFromPos`/`posFromDOM`/`descAt`: handle virtual children — return placeholder dom; resolve position by walking children and summing `contentDOM` height (real) vs `estimatedHeight` (virtual).
6. `EditorView.domAtPos`/`nodeDOM`/`posAtDOM`: delegate as now; virtual nodes return placeholder dom / null for `nodeDOM`.
7. Selection: in `EditorView.update`, before rendering selection, if `selection.from`/`to` fall in a virtual node, call `materialize` for that index first.
8. Scroll handler: on scroll, compute visible range + overscan, materialize newly-visible virtual nodes, de-materialize (optional) far-off-screen nodes back to placeholders to cap DOM.
9. `NodeViewDesc.update` for virtual nodes: N/A (no real view); transactions still flow through Yjs → ProseMirror → view tree reconciliation; virtual nodes that aren't touched stay virtual.

### 4.3 Height / scroll anchoring
- Virtual nodes need an estimated height so scroll position is stable. Default 300px (matches current `contain-intrinsic-size`).
- When a node materializes, measure its real `dom.getBoundingClientRect().height`, update the estimate, adjust scroll position to avoid jump (proportional scroll correction).
- De-materializing far nodes restores placeholder; keep last measured height as estimate.

---

## 5. Risks & incompatibilities

| Area | Risk | Mitigation |
|---|---|---|
| **Selection** | Remote/collab selection lands in virtual node; `domFromPos` returns placeholder | Materialize target node before rendering caret; sync-aware materialization on `selection` transactions |
| **Collaboration (Yjs)** | Remote transactions insert/update blocks anywhere in doc | Yjs drives ProseMirror transactions; view tree reconciles; only touched nodes materialize. Remote selection caret → materialize that node. |
| **Undo/redo** | Undo brings back content in a virtual region | Transactions still flow normally; view desc updates handle doc changes; virtualization is a view-layer concern, invisible to Yjs/ProseMirror state. |
| **Tables (CustomTableView)** | Constructor does DOM measurement/wrap at build | Deferred to materialization time — acceptable; table only becomes interactive when scrolled into view. |
| **Table handle / selection overlay** | Extensions call `view.nodeDOM(pos)` → null for virtual | Guard extensions: if `nodeDOM` returns null, the node is off-screen; skip handle rendering until materialized. Hover → materialize on demand. |
| **Copy/paste / input rules** | Read DOM ranges via `posAtDOM`/`domAtPos` | Virtual nodes in range → materialize affected nodes first, or fall back to ProseMirror document model (no DOM needed for slicing). |
| **Node view `update`/`destroy`** | Custom node views have lifecycle | Materialized nodes use full lifecycle; virtual nodes never constructed so no `destroy` needed. |
| **Fork maintenance** | prosemirror-view updates, security patches | Document the fork; pin version; re-diff on upgrades. |

---

## 6. Effort estimate

| Phase | Work | Estimate |
|---|---|---|
| Fork setup & Vite alias | Copy package, wire imports | 0.5 day |
| Placeholder view descs (skip factory off-screen) | `ViewTreeUpdater` + `NodeViewDesc.create` fork | 1 day |
| Materialize on scroll + height tracking | Scroll handler, materialize(), scroll correction | 1.5 days |
| Selection/caret in virtual nodes | `domFromPos`/`posFromDOM` handling, pre-materialize selection target | 1 day |
| Decorations & extensions guard | Table handle, selection overlay, `nodeDOM` null checks | 0.5 day |
| Bug-fix / polish (click in placeholder, paste near boundary, drag) | — | 1-2 days |
| **Total** | | **~5-7 days** |

---

## 7. Bottom line

**Feasible, but requires forking prosemirror-view.** It is not achievable through Tiptap's public `nodeViews` API alone because prosemirror-view builds real DOM for every top-level node synchronously on init, with no rematerialization hook.

**What you gain:** Initial DOM construction drops from ~49k elements (500 tables × 93 + 3000 blocks) to only the visible ~20-40 blocks (~1-2k elements). EditorView construction falls from ~1.6s toward the measured hand-built baseline (~15-50ms build + layout), so the open becomes dominated by the ~470ms Yjs chunk load rather than editor build.

**What you give up:** A maintained fork of a core dependency; non-trivial edge cases around selection, collaboration carets, and extensions that touch DOM.

**Recommendation:** Before forking, confirm the cheaper wins are exhausted:
1. The sync ping-pong fix (done) stops background DB contention.
2. The `getSnapshots` parallel decode (done) brings mounted-editor chunk load to ~390ms.
3. `content-visibility` removed (done) — scroll no longer jumps.

If the remaining target is sub-500ms *interactive* open (not just first paint), virtualization is the only lever left that attacks the ~1.6s editor build. Say the word and I'll start the fork prototype.
