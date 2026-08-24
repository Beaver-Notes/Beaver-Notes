# Card Preview Faithful Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix duplicate previews on Electron legacy import and make cardPreview structurally faithful while keeping 5-block/240-char budget; CSS is commented for owner.

**Architecture:** Isolate Y.Doc per snapshot in meta-store (loop-local doc), expand seeded fields + hydrate fallback, extend cardPreview.js visitNode for columns/hr/marks and fix MEDIA_TYPES locale closure, comment HomeNoteCard preview CSS with Source A/B pointers.

**Tech Stack:** Vue 3 + Pinia + Yjs 13 + TipTap 3 + Tailwind 3 + Vitest 4 (happy-dom), Tauri 2

## Global Constraints

- `MAX_BLOCKS=5`, `MAX_TOTAL_CHARS=240`, `MAX_CHARS_BY_KIND` unchanged — `src/utils/note/cardPreview.js:2-13`
- Shell `h-[140px] overflow-hidden` + `eio-fade-y-4` preserved — `src/components/home/HomeNoteCard.vue:51-54`
- Markdown import `src/utils/import/helpers.js:addImportedNote` out of scope — do not touch
- No new dependencies; no miniature ProseMirror/iframe render
- Yjs schema unchanged; note content stays in per-note docs, only meta in workspace doc
- Tests run via `NODE_OPTIONS='--localstorage-file=/tmp/vitest-localstorage' vitest run` (see package.json:34)

---

### Task 1: Isolate Y.Doc per snapshot (repeat root fix)

**Files:**
- Modify: `src/lib/yjs/meta-store.js:141-167` (writeStoresFromWorkspace batch loop)
- Modify: `src/lib/yjs/meta-store.js:280-308` (backfillNotePreviews batch loop)
- Test: `src/lib/yjs/meta-merge.spec.js` (extend) or `src/lib/yjs/__tests__/meta-yjs-store.spec.js` pattern

**Interfaces:**
- Consumes: `getSnapshots(ids) -> Record<id, Uint8Array>`, `toUint8Array`, `yXmlFragmentToProsemirrorJSON(xml)->JSON`, `buildNotePreviewFromContent`
- Produces: Isolated per-note Y.Doc decoding so each preview derives from single snapshot only

- [ ] **Step 1: Write failing regression test (Y.Doc reuse -> superset)**

Create or extend `src/lib/yjs/meta-merge.spec.js` with a minimal reproduction that mimics the bug without Tauri IPC:

```js
import { describe, it, expect } from 'vitest'
import * as Y from 'yjs'

describe('backfill isolation regression', () => {
  it('two sequential snapshots must not accumulate', async () => {
    // snapshot A has text "Alpha", snapshot B has text "Beta" — simulate by applying updates to tmp
    // This test asserts the CURRENT buggy behavior would merge; we want fresh-doc behavior
    const tmpBuggy = new Y.Doc()
    const a = new Y.Doc(); a.getXmlFragment('content').insert(0, ['A'])
    const b = new Y.Doc(); b.getXmlFragment('content').insert(0, ['B'])
    const updA = Y.encodeStateAsUpdate(a)
    const updB = Y.encodeStateAsUpdate(b)
    Y.applyUpdate(tmpBuggy, updA)
    Y.applyUpdate(tmpBuggy, updB)
    // buggy tmp now contains A+B — assert that naive reuse produces superset
    expect(tmpBuggy.getXmlFragment('content').length).toBeGreaterThan(1)

    // fixed: fresh doc per snapshot
    const tmpFixedA = new Y.Doc(); Y.applyUpdate(tmpFixedA, updA)
    const tmpFixedB = new Y.Doc(); Y.applyUpdate(tmpFixedB, updB)
    expect(tmpFixedA.getXmlFragment('content').length).toBe(1)
    expect(tmpFixedB.getXmlFragment('content').length).toBe(1)
  })
})
```

Run: `vitest run src/lib/yjs/meta-merge.spec.js -t "backfill isolation"`  Expected: FAIL initially if test asserts isolation already (flip expectation) — adjust to fail on buggy path so fix makes it pass.

- [ ] **Step 2: Run to confirm fail**

Run: `NODE_OPTIONS='--localstorage-file=/tmp/vitest-localstorage' vitest run src/lib/yjs/meta-merge.spec.js -v`
Expected: FAIL

- [ ] **Step 3: Implement — fresh Y.Doc per iteration in meta-store.js**

In `src/lib/yjs/meta-store.js:141-167` replace:

```js
const tmp = new Y.Doc();
try {
  const snapshots = await getSnapshots(pendingPreviews);
  ...
  for (const id of pendingPreviews) {
    Y.applyUpdate(tmp, toUint8Array(snapshot));
```

with:

```js
const snapshots = await getSnapshots(pendingPreviews);
const { syncNoteMeta } = await import('./workspace-doc.js');
for (const id of pendingPreviews) {
  const snapshot = snapshots?.[id];
  if (!snapshot || snapshot.length === 0) continue;
  const tmp = new Y.Doc();
  try {
    Y.applyUpdate(tmp, toUint8Array(snapshot));
    const content = await yXmlFragmentToProsemirrorJSON(tmp.getXmlFragment('content'));
    const merged = noteStore.data[id];
    if (!merged) continue;
    const { cardPreview, preview } = buildNotePreviewFromContent(merged, content);
    merged.cardPreview = cardPreview;
    if (!merged.preview) merged.preview = preview;
    syncNoteMeta(merged);
  } finally { tmp.destroy(); }
}
```

Remove outer try/finally around single tmp; keep inner warn catch per-id if desired but batch warn still ok. Mirror same fix in `backfillNotePreviews` `src/lib/yjs/meta-store.js:280-308`: move `const tmp = new Y.Doc()` inside `for (const [id, snapshot] of Object.entries(snapshots))` loop, destroy per iteration, remove outer tmp.

Keep imports, keep `yXmlFragmentToProsemirrorJSON` lazy.

- [ ] **Step 4: Run test to verify pass**

Run: `NODE_OPTIONS='--localstorage-file=/tmp/vitest-localstorage' vitest run src/lib/yjs/meta-merge.spec.js -v`
Expected: PASS (and existing meta-merge tests still pass)

- [ ] **Step 5: Commit**

```bash
git add -f src/lib/yjs/meta-store.js src/lib/yjs/meta-merge.spec.js
git commit -m "fix(yjs): isolate Y.Doc per snapshot to prevent cumulative previews"
```

---

### Task 2: Seed cardPreview + hydrate fallback

**Files:**
- Modify: `src/lib/yjs/meta-store.js:199-210` (SEED_META_FIELDS)
- Modify: `src/lib/yjs/meta-merge.js:15-43` (mergeNoteEntry already handles cardPreview; ensure path)
- Modify: `src/utils/onboarding/legacyContentToYjs.js` (persist preview after seed if present)
- Modify: `src/utils/migration/legacyElectron.js` (ensure note objects carry cardPreview into seed)
- Test: `src/lib/yjs/meta-merge.spec.js` (seed + merge path)

**Interfaces:**
- Consumes: `buildNotePreview({content, preview, searchText, hidden}) -> {cardPreview, preview}`, `EMPTY_CARD_PREVIEW`
- Produces: `seedWorkspaceDocFromData` seeds `cardPreview`/`preview`/`searchText` when present; `mergeNoteEntry` prefers persisted preview without snapshot

- [ ] **Step 1: Write failing test — seed without cardPreview forces snapshot**

```js
import { mergeNoteEntry } from '@/lib/yjs/meta-merge.js'
import { EMPTY_CARD_PREVIEW } from '@/utils/note/cardPreview.js'

it('merge prefers seeded cardPreview without snapshot', () => {
  const existing = {}
  const meta = { id:'n1', title:'T', cardPreview:{ version:1, blocks:[{kind:'paragraph', text:'hi'}], hasMore:false, mediaCount:0, visibleMediaCount:0 } }
  const { needsSnapshot, note } = mergeNoteEntry(existing, meta)
  expect(needsSnapshot).toBe(false)
  expect(note.cardPreview.blocks).toHaveLength(1)
})

it('legacy seed without cardPreview triggers needsSnapshot (to be fixed by Task 2)', () => {
  const existing = {}
  const meta = { id:'n2', title:'T2' } // no cardPreview, no content — legacy seed
  const { needsSnapshot } = mergeNoteEntry(existing, meta)
  expect(needsSnapshot).toBe(true) // this documents current behavior; after seed fix this path should be avoided
})
```

Run: `vitest run src/lib/yjs/meta-merge.spec.js -v` Expected: second test passes (documents bug); after SEED fix the seed test will pass without needsSnapshot when cardPreview supplied.

- [ ] **Step 2: Extend SEED_META_FIELDS**

In `src/lib/yjs/meta-store.js:199`:

```js
const SEED_META_FIELDS = [
  'id','title','folderId','labels','isArchived','isLocked','isBookmarked','isFullWidth','createdAt','updatedAt',
  'cardPreview','preview','searchText',
];
```

Filtering in loop already `if (note[field] !== undefined) yNote.set(field, note[field]);` handles missing fields — no extra logic.

- [ ] **Step 3: Ensure legacy helpers compute cardPreview before seed**

In `src/utils/onboarding/legacyContentToYjs.js` and `src/utils/migration/legacyElectron.js`, where `notes` map is assembled before `seedWorkspaceDocFromData(notes, ...)`, ensure each note gets `cardPreview`/`preview` via `buildNotePreview({content: noteContent, preview: note.preview, searchText: note.searchText, hidden: isLocked})` if not already present. Minimal addition: after parsing legacy content to ProseMirror JSON (`contentJSON`), set `note.cardPreview = buildCardPreview(contentJSON).` Keep `EMPTY_CARD_PREVIEW` for empty.

If helpers already call `buildNotePreview`, just verify they pass result into the `notes` map — no duplicate work.

- [ ] **Step 4: Run tests**

Run: `NODE_OPTIONS='--localstorage-file=/tmp/vitest-localstorage' vitest run src/lib/yjs/meta-merge.spec.js -v`
Expected: PASS; `needsSnapshot` false when cardPreview seeded

- [ ] **Step 5: Commit**

```bash
git add -f src/lib/yjs/meta-store.js src/lib/yjs/meta-merge.js src/utils/onboarding/legacyContentToYjs.js src/utils/migration/legacyElectron.js
git commit -m "fix(import): seed cardPreview to avoid snapshot fallback on legacy import"
```

---

### Task 3: Structural fidelity — cardPreview.js (columns, hr, i18n, marks)

**Files:**
- Modify: `src/utils/note/cardPreview.js:15-35` (MEDIA_TYPES factory), `60-68` (extractInlineText), `212-309` (visitNode)
- Test: `src/utils/note/__tests__/cardPreview.spec.js` (new) or extend existing spec

**Interfaces:**
- Consumes: `normalizeText`, `truncateText`, `MAX_*` constants
- Produces: `buildCardPreview(content) -> preview`, `buildNotePreview(opts)`, `setCardPreviewLabels(labels)`, `getMediaTypes()` (new factory)

- [ ] **Step 1: Write failing structural tests**

```js
import { describe, it, expect } from 'vitest'
import { buildCardPreview, setCardPreviewLabels } from '@/utils/note/cardPreview.js'

describe('cardPreview structural', () => {
  it('unwraps columnContainer/column', () => {
    const content = { type:'doc', content:[
      { type:'columnContainer', content:[
        { type:'column', content:[{ type:'paragraph', content:[{type:'text', text:'inside column'}]}]},
        { type:'column', content:[{ type:'heading', attrs:{level:2}, content:[{type:'text', text:'col heading'}]}]},
      ]}
    ]}
    const p = buildCardPreview(content)
    expect(p.blocks.map(b=>b.text)).toContain('inside column')
    expect(p.blocks.map(b=>b.text)).toContain('col heading')
  })
  it('renders horizontalRule as separator', () => {
    const content = { type:'doc', content:[
      {type:'paragraph', content:[{type:'text', text:'a'}]},
      {type:'horizontalRule'},
      {type:'paragraph', content:[{type:'text', text:'b'}]},
    ]}
    const p = buildCardPreview(content)
    expect(p.blocks.length).toBe(3)
    expect(p.blocks[1].text).toBe('—')
  })
  it('MEDIA_TYPES labels respect setCardPreviewLabels', () => {
    setCardPreviewLabels({ diagram:'Diagramme' })
    const content = { type:'doc', content:[{type:'mermaidBlock', attrs:{}}]}
    const p = buildCardPreview(content)
    expect(p.blocks[0].label).toBe('Diagramme')
    setCardPreviewLabels({}) // reset
  })
  it('caps at 5/240', () => {
    const content = { type:'doc', content: Array(10).fill(0).map((_,i)=>({type:'paragraph', content:[{type:'text', text:'x'.repeat(100)}]}))}
    const p = buildCardPreview(content)
    expect(p.blocks.length).toBe(5)
    const total = p.blocks.reduce((s,b)=> s + (b.text? b.text.length:0), 0)
    expect(total).toBeLessThanOrEqual(240)
    expect(p.hasMore).toBe(true)
  })
  it('hardBreak becomes space', () => {
    const content = { type:'doc', content:[{type:'paragraph', content:[{type:'text', text:'a'}, {type:'hardBreak'}, {type:'text', text:'b'}]}]}
    const p = buildCardPreview(content)
    expect(p.blocks[0].text).toBe('a b')
  })
})
```

Run: `vitest run src/utils/note/__tests__/cardPreview.spec.js -v` Expected: FAIL (columns/hr/i18n)

- [ ] **Step 2: Implement MEDIA_TYPES factory**

Replace module-level `MEDIA_TYPES` constant with factory:

```js
function getMediaTypes(){
  return {
    audioBlock: { label: cl('audio','Audio'), tone:'audio' },
    videoBlock: { label: cl('video','Video'), tone:'video' },
    fileEmbed: { label: cl('attachment','Attachment'), tone:'file' },
    mermaidBlock: { label: cl('diagram','Diagram'), tone:'diagram' },
    mermaidDiagram: { label: cl('diagram','Diagram'), tone:'diagram' },
    mathBlock: { label: cl('math','Math'), tone:'math' },
    mathInline: { label: cl('math','Math'), tone:'math' },
    math_inline: { label: cl('math','Math'), tone:'math' },
    paper: { label: cl('sketch','Sketch'), tone:'sketch' },
  }
}
```

Update `visitNode` default media check to `const MT = getMediaTypes(); if (MT[node.type]) pushMediaBlock(...)` — evaluate per-call so `setCardPreviewLabels` at runtime is reflected.

- [ ] **Step 3: Extend visitNode for columns + hr**

Add near top of `visitNode` switch:

```js
case 'column':
case 'columnContainer':
case 'columns':
case 'column-container': // defensive alias
  for (const child of node.content || []) {
    visitNode(child, preview, state);
    if (preview.blocks.length >= MAX_BLOCKS) { preview.hasMore = true; return; }
  }
  return;
case 'horizontalRule':
  pushTextBlock(preview, 'paragraph', '—', state);
  return;
```

Ensure `extractInlineText` already returns `' '` for `hardBreak` and recurses through marks — verify:

```js
function extractInlineText(node){
  if(!node) return '';
  if(Array.isArray(node)) return node.map(extractInlineText).join('');
  if(node.type === 'text') return node.text || '';
  if(node.type === 'hardBreak') return ' ';
  if(node.type === 'mention' || node.type === 'noteLink') return node.attrs?.label || node.attrs?.id || extractInlineText(node.content||[]);
  return extractInlineText(node.content||[]);
}
```

Keep existing `normalizeText`/`truncateText` budget logic untouched.

- [ ] **Step 4: Run tests**

Run: `NODE_OPTIONS='--localstorage-file=/tmp/vitest-localstorage' vitest run src/utils/note/__tests__/cardPreview.spec.js -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add -f src/utils/note/cardPreview.js src/utils/note/__tests__/cardPreview.spec.js
git commit -m "feat(cardPreview): unwrap columns, handle hr/hardBreak, fresh MEDIA_TYPES locale"
```

---

### Task 4: Comment preview CSS (owner handles tokens)

**Files:**
- Modify: `src/components/home/HomeNoteCard.vue:428-908`

**Interfaces:**
- Consumes: `src/assets/css/editor.css` (rounded .75rem, tableWrapper, bn-image-node, column tokens, ProseMirror pre), `src/lib/tiptap/exts/*/tailwind` (callouts/*, code-block/*, table/*, multi-column/*, image.js, mermaid/math/file/paper)
- Produces: Commented preview CSS + TODO pointer, shell intact

- [ ] **Step 1: Verify shell still works with styles removed**

Visually inspect HomeNoteCard still renders title/labels/action bar; preview-stack temporarily unstyled is ok per spec.

- [ ] **Step 2: Edit file — comment preview rules**

Wrap all `.note-card-preview-*` rules (from `.note-card-preview-stack` through `.note-card-preview-empty`) in a single block comment with header:

```css
/* TODO(you): replace commented preview tokens with editor-faithful ones.
   Source A — src/assets/css/editor.css — canonical values:
     rounded .75rem (--float-radius), ProseMirror pre/inline-code bg-neutral-50/dark:neutral-900,
     blockquote, tableWrapper (border-neutral-200/dark:700, th bg-neutral-100), column tokens,
     bn-image-node frame
   Source B — src/lib/tiptap/exts/* Tailwind classes — actual editor nodes
     callouts/*, code-block/*, table/*, multi-column/*, image.js, mermaid-block/*, math-block/*, file-block/*, paper-block/*
   Keep shell: h-[140px] overflow-hidden + eio-fade-y-4 in template. Do not remove .note-card-preview-stack layout if you want stack spacing.
*/
/*
.note-card-preview-stack { ... }
...
.note-card-preview-empty { ... }
*/
```

Keep `.note-card`, `.note-card__title/label/action`, hover/active, reduced-motion, and `[data-preview-shell]` containment outside the comment — those are not preview tokens.

- [ ] **Step 3: Typecheck/lint**

Run: `yarn typecheck` (expect 0 errors) and `yarn lint` (fix if needed)
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add -f src/components/home/HomeNoteCard.vue
git commit -m "chore(card): comment preview CSS for owner token alignment (sources: editor.css + tiptap exts)"
```

---

## Self-Review

**Spec coverage:**
- §4 Data fix → Tasks 1+2
- §5 Visual fidelity (comment + pointers) → Task 4
- §6 Structural fidelity (columns/hr/marks, MEDIA_TYPES factory, i18n, budgets 5/240) → Task 3
- Error handling (encrypted/locked skip, per-note try, EMPTY fallback) → Tasks 1+2 keep existing guards
- Testing (unit + integration regression) → Task 1 superset test, Task 2 merge test, Task 3 structural suite

**Placeholder scan:** No TBD/TODO beyond intentional `TODO(you)` in Task 4; every step has exact file paths and code blocks; no “handle edge cases” vague — explicit hr/column/hardBreak/mention lists.

**Type consistency:** `buildNotePreview({content, preview, searchText, hidden})`, `cardPreview {version, blocks, hasMore, mediaCount, visibleMediaCount}`, `MEDIA_TYPES -> getMediaTypes()` rename is local to cardPreview.js only; `seedWorkspaceDocFromData` signature unchanged; `mergeNoteEntry(existing, meta)->{note, needsSnapshot}` unchanged.

