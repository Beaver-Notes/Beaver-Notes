/**
 * paperInsert — stylus-first paper insertion.
 *
 * A pen pointerdown over blank note space inserts a paper block at that spot
 * and hands the in-flight stroke to the freshly mounted PaperSurface
 * (setPendingHandoff/takePendingHandoff). Touch never inserts. Also kills the
 * WebKit pencil double-tap zoom sentinel the way tldraw does: while a pen is
 * down, touchstart/touchend are preventDefault-ed.
 *
 * Listeners are attached in the plugin view hook, not via handleDOMEvents:
 * PM only wires handleDOMEvents during init/update and misses plugin props on
 * a freshly created editor.
 */
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from 'prosemirror-state';
import { isPen, isPalm, isStylusEraser } from './ink/pointer.js';
import { isPaperEditing } from './helpers/paperEditing.js';

const MEDIA_SELECTOR =
  '[data-node-view-wrapper],' + // Tiptap v3 Vue node views emit this, never data-type
  'img,canvas,' + // DOM node views (image/pdf pages) have no wrapper marker
  '[data-type="image"],[data-type="Video"],[data-type="Audio"],' +
  '[data-type="fileEmbed"],[data-type="paper"],[data-type="pdfBlock"],' +
  '[data-type="mathBlock"],[data-type="mermaidDiagram"]';

let pendingHandoff = null;

export function setPendingHandoff(coords) {
  pendingHandoff = coords;
}

export function takePendingHandoff() {
  const coords = pendingHandoff;
  pendingHandoff = null;
  return coords;
}

/** Blank-space position for an insert, or null when over text. */
export function pickInsertPos(state, coords, view) {
  const hit = view.posAtCoords({ left: coords.x, top: coords.y });
  if (!hit) return null;
  const $pos = state.doc.resolve(hit.pos);
  if ($pos.parent.isTextblock) return null; // over text — no insert
  return hit.pos;
}

let lastInsertStamp = null; // double-dispatch guard (WebKit/happy-dom can run a target listener twice)

function tryInsert(view, event) {
  const stamp = `${event.pointerId ?? ''}:${event.timeStamp ?? ''}`;
  if (stamp === lastInsertStamp) return true;
  lastInsertStamp = stamp;
  if (isPaperEditing.value) return false;
  if (event.target?.closest?.(MEDIA_SELECTOR)) return false;
  const pos = pickInsertPos(view.state, { x: event.clientX, y: event.clientY }, view);
  if (pos == null) return false;
  const type = view.state.schema.nodes.paper;
  if (!type) return false;
  const node = type.create({ strokes: [], height: 210, paperType: 'transparent' });
  view.dispatch(view.state.tr.insert(pos, node));
  setPendingHandoff({ x: event.clientX, y: event.clientY });
  return true;
}

export function createPaperInsertPlugin() {
  let penSeen = false;

  return new Plugin({
    key: new PluginKey('paperInsert'),
    view(view) {
      const killSentinel = (e) => {
        if (penSeen) e.preventDefault();
      };
      const onDown = (event) => {
        if (event.button != null && event.button !== 0) return;
        if (isPalm(event) || event.isPrimary === false) return;
        penSeen = isPen(event);
        if (isStylusEraser(event)) return;
        if (isPen(event)) tryInsert(view, event);
      };
      const onUp = () => {
        penSeen = false;
      };

      const dom = view.dom;
      dom.addEventListener('pointerdown', onDown);
      dom.addEventListener('pointerup', onUp);
      dom.addEventListener('pointercancel', onUp);
      dom.addEventListener('touchstart', killSentinel, { passive: false, capture: true });
      dom.addEventListener('touchend', killSentinel, { passive: false, capture: true });
      return {
        destroy() {
          dom.removeEventListener('pointerdown', onDown);
          dom.removeEventListener('pointerup', onUp);
          dom.removeEventListener('pointercancel', onUp);
          dom.removeEventListener('touchstart', killSentinel, true);
          dom.removeEventListener('touchend', killSentinel, true);
        },
      };
    },
  });
}

export const PaperInsert = Extension.create({
  name: 'paperInsert',
  addProseMirrorPlugins() {
    return [createPaperInsertPlugin()];
  },
});
