import { ref } from 'vue';

const editingPapers = new Set();

export const isPaperEditing = ref(false);

export function setPaperEditing(source, editing) {
  if (!source) return;
  if (editing) editingPapers.add(source);
  else editingPapers.delete(source);
  isPaperEditing.value = editingPapers.size > 0;
}

// Newest pointerdown anywhere — lets media blocks tell taps from mouse clicks
// without threading event objects through every handler.
const lastPointer = { type: 'mouse', target: null, at: 0 };

if (typeof window !== 'undefined') {
  window.addEventListener(
    'pointerdown',
    (event) => {
      lastPointer.type = event.pointerType || 'mouse';
      lastPointer.target = event.target;
      lastPointer.at = performance.now();
    },
    { capture: true, passive: true },
  );
}

/**
 * Selects a keyboard-less media block (paper, pdf markup) without summoning
 * the on-screen keyboard: touch taps don't node-select like desktop clicks,
 * so the node selection is set explicitly — and because WebKit focuses the
 * editor's contenteditable on any tap inside it, that focus is dropped right
 * away when the gesture came from touch or pen.
 */
export function selectMediaBlock(editor, pos) {
  if (editor && typeof pos === 'number') {
    try {
      editor.commands?.setNodeSelection?.(pos);
    } catch {}
  }
  if (lastPointer.type === 'mouse' || !editor) return;
  const dom = editor.view?.dom;
  if (!dom) return;
  const dropFocus = () => {
    if (document.activeElement === dom) dom.blur();
  };
  queueMicrotask(dropFocus);
}

/**
 * Tap-focus guard for keyboard-less media blocks. WebKit focuses the editor's
 * contenteditable on any tap inside it — even over inert node views, and even
 * when the surface cancels the pointerdown — which pops the keyboard mid-
 * stroke. While a touch/pen pointerdown landed inside `root` within the last
 * moment and a focus lands on the editable, drop the focus.
 * Returns a detach function.
 */
export function attachKeyboardGuard(root, getEditor) {
  if (typeof document === 'undefined') return () => {};
  const drop = () => {
    if (lastPointer.type === 'mouse') return;
    // stale-guard: only gestures from the last moment count
    if (performance.now() - lastPointer.at > 1500) return;
    const el = typeof root === 'function' ? root() : root;
    const target = lastPointer.target;
    if (!el || !target || !(el === target || el.contains(target))) return;
    const dom = getEditor?.()?.view?.dom;
    if (dom && document.activeElement === dom) dom.blur();
  };
  document.addEventListener('focusin', drop, true);
  return () => document.removeEventListener('focusin', drop, true);
}
