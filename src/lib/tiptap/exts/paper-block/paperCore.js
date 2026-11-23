/**
 * paperCore.js — pure per-surface gesture engine (REDESIGN phase E).
 *
 * Ports the gesture state machine from `PaperSurface.vue` (draw / erase /
 * lasso / move-selection), glued to `useInkCanvas` + `useInkModel` +
 * `submitQueue`. No TipTap / Vue imports. Events are reported through the
 * callbacks passed at creation (`onCommit`, `onUpdateStrokes`,
 * `onHeightChange`, `onFocusRequest`).
 *
 * API: { onPointerDown, onPointerMove, onPointerUp, setStrokes, resize, destroy }
 * (+ setTool / setToolSettings / setHeight / setFocused / setSelectionIds).
 */

import { fitCanvas } from './ink/useInkCanvas.js';
import { InkCanvas } from './ink/inkCanvas.js';
import { moveStrokes, eraseStrokes } from './ink/inkModel2.js';
import { SubmitQueue } from './ink/submitQueue.js';
import { collectPoints, isPalm, isStylusEraser } from './ink/pointer.js';
import { pointInPolygon } from './ink/geometry.js';
import { recognizeShape, shouldSnapshot } from './ink/recognizer.js';

const AUTO_GROW_MARGIN = 20;
const DOUBLE_TAP_MS = 300;
/** Selection halo: tint + slop, painted on the live layer between gestures. */
const SELECTION_TINT = '#007aff';
const SELECTION_OPACITY = 0.2;
const SELECTION_GRAB = 8;

function nextStrokeId() {
  return `stroke-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

function buildStroke(tool, points, id, toolSettings) {
  const settings = toolSettings[tool] ?? {};
  const def = {
    pen: { color: '#1a1a1a', size: 4, opacity: 1 },
    pencil: { color: '#4a4a4a', size: 3 },
    fountain: { color: '#1a2744', size: 5 },
    marker: { color: '#fbbf24', size: 16, opacity: 0.35 },
    eraser: { size: 20 },
  }[tool] ?? {};
  return {
    id: id ?? nextStrokeId(),
    tool,
    color: settings.color ?? def.color ?? '#1a1a1a',
    size: settings.size ?? def.size ?? 4,
    opacity: settings.opacity ?? def.opacity ?? 1,
    points,
  };
}

function strokeBoundsOf(s) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of s.points) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

function unionRect(a, b) {
  if (!a) return b;
  if (!b) return a;
  return { minX: Math.min(a.minX, b.minX), minY: Math.min(a.minY, b.minY), maxX: Math.max(a.maxX, b.maxX), maxY: Math.max(a.maxY, b.maxY) };
}

export function createPaperCore({
  container,
  drawing,
  live,
  onCommit = () => {},
  onUpdateStrokes = () => {},
  onHeightChange = () => {},
  onFocusRequest = () => {},
  tool = 'pen',
  toolSettings = {},
  height = 210,
  focused = false,
  dpr,
} = {}) {
  // ---- canvas (via InkCanvas + useInkCanvas.fitCanvas) ----
  const ink = new InkCanvas();
  ink.attach(drawing, null, live);
  const curDpr = dpr != null ? dpr : (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
  fitCanvas(ink, { width: container.clientWidth || 0, height: container.clientHeight || 0 }, curDpr);

  // ---- gesture state ----
  let gesture = null;
  let lastSample = null;
  let moveEvents = [];
  let focusRequestedAt = -Infinity;
  let selectionIds = [];
  let rafId = 0;
  let liveDirty = false;
  let selectionDirty = false;
  let gestureRect = null;
  let growRequested = 0;

  const submit = new SubmitQueue();

  function loop() {
    if (liveDirty) {
      liveDirty = false;
      paintLive();
    }
    if (selectionDirty) {
      selectionDirty = false;
      paintSelection();
    }
    ink.paintStrokes(strokes, strokeBoundsList, inkDirtyRect);
    inkDirtyRect = null;
    rafId = requestAnimationFrame(loop);
  }

  // ---- committed stroke store (mirrors host strokes) ----
  let strokes = [];
  let strokeBoundsList = [];
  let inkDirtyRect = null;

  function setStrokes(next) {
    strokes = next ?? [];
    strokeBoundsList = strokes.map((s) => {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const [x, y] of s.points) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
      return { minX, minY, maxX, maxY };
    });
    inkDirtyRect = {
      minX: 0, minY: 0, maxX: ink.width || container.clientWidth || 0,
      maxY: ink.height || container.clientHeight || 0,
    };
  }

  function setDirty(rect) {
    if (!rect) return;
    inkDirtyRect = inkDirtyRect
      ? {
          minX: Math.min(inkDirtyRect.minX, rect.minX),
          minY: Math.min(inkDirtyRect.minY, rect.minY),
          maxX: Math.max(inkDirtyRect.maxX, rect.maxX),
          maxY: Math.max(inkDirtyRect.maxY, rect.maxY),
        }
      : { ...rect };
  }

  function paintLive() {
    if (!gesture || gesture.kind !== 'draw' || !gesture.points.length) {
      // no live stroke (or the gesture ended): clear, or the finished stroke
      // ghosts on top of its own committed repaint
      ink.paintLive(null);
      return;
    }
    const live = buildStroke(gesture.tool, gesture.points, gesture.id, toolSettings);
    ink.paintLive(live);
  }

  /** Selection halo, painted on the live layer — a lasso with no visible
   *  effect reads as "lasso is broken", so the selection must be seen. */
  function paintSelection() {
    const ctx = ink.interactiveCtx;
    if (!ctx) return;
    ink.paintLive(null);
    if (!selectionIds.length) return;
    for (const stroke of strokes) {
      if (!selectionIds.includes(stroke.id) || stroke.points.length < 2) continue;
      ink.fillStroke(ctx, {
        ...stroke,
        color: SELECTION_TINT,
        opacity: SELECTION_OPACITY,
        size: (stroke.size ?? 4) + 6,
      });
    }
  }

  function commitStroke(stroke) {
    submit.enqueueStroke(stroke.id, stroke);
    const { strokes: flushed } = submit.flush();
    for (const s of flushed) onCommit(s);
    const b = strokeBoundsOf(stroke);
    if (b.maxY > height - AUTO_GROW_MARGIN) {
      onHeightChange(Math.ceil(b.maxY + AUTO_GROW_MARGIN), { grow: true });
    }
  }

  function localPoint(e) {
    const rect = gestureRect ?? (drawing ? drawing.getBoundingClientRect() : null);
    const left = rect?.left ?? 0;
    const top = rect?.top ?? 0;
    return [e.clientX - left, e.clientY - top];
  }

  function capture(e) {
    try { e.currentTarget?.setPointerCapture?.(e.pointerId); } catch {}
  }

  function onPointerDown(e) {
    e.preventDefault?.();
    if (isPalm(e)) return;
    if (!tool) return;
    capture(e);
    gestureRect = drawing ? drawing.getBoundingClientRect() : null;
    growRequested = 0;

    if (!focused) {
      const now = performance.now();
      if (now - focusRequestedAt > DOUBLE_TAP_MS) {
        focusRequestedAt = now;
        onFocusRequest();
      }
      // A finger tap selects the block; pen and mouse ink on first contact,
      // like Apple Notes. focusRequest still shows the toolbar in parallel.
      if (e.pointerType === 'touch') return;
    }

    const [x, y] = localPoint(e);
    lastSample = { x: e.clientX, y: e.clientY, t: e.timeStamp };
    moveEvents = [];
    const gestureId = nextStrokeId();

    // scribble suppression handled by host (useInkInput) — beginStroke gate
    // lives there; here we assume the host began the stroke.

    if (tool === 'eraser' || isStylusEraser(e)) {
      gesture = {
        id: gestureId, kind: 'erase',
        radius: (toolSettings.eraser?.size ?? 20) / 2,
        touched: false,
      };
      return;
    }
    if (tool === 'lasso') {
      gesture = { id: gestureId, kind: 'lasso', polygon: [[x, y]], start: [x, y] };
      return;
    }
    if (selectionIds.length) {
      // a press on the selection moves it; a press anywhere else starts a new
      // stroke and drops the selection — a lingering lasso must never eat the
      // next pen stroke (that is what made lasso feel broken)
      if (pressHitsSelection(x, y)) {
        gesture = { id: gestureId, kind: 'move-selection', start: [x, y], last: [x, y] };
        return;
      }
      clearSelection();
    }
    gesture = { id: gestureId, kind: 'draw', tool, points: [] };
    appendDrawPoints(e, gesture);
    paintLive();
  }

  function appendDrawPoints(e, g) {
    const pts = collectPoints(e, localPoint, lastSample);
    if (!pts.length) return;
    lastSample = { x: e.clientX, y: e.clientY, t: e.timeStamp };
    g.points.push(...pts);
  }

  function onPointerMove(e) {
    if (!gesture || isPalm(e)) return;
    const [x, y] = localPoint(e);
    if (gesture.kind === 'erase') {
      const { strokes: next, removedIds } = eraseStrokes(strokes, x, y, gesture.radius);
      gesture.touched = true;
      gesture.result = next;
      setStrokes(next);
      // strokes the eraser just removed can't stay selected
      selectionIds = selectionIds.filter((id) => next.some((s) => s.id === id));
      setDirty({ minX: x - gesture.radius, minY: y - gesture.radius, maxX: x + gesture.radius, maxY: y + gesture.radius });
      if (removedIds.length) onUpdateStrokes(next);
      return;
    }
    if (gesture.kind === 'lasso') {
      gesture.polygon.push([x, y]);
      return;
    }
    if (gesture.kind === 'move-selection') {
      const dx = x - gesture.last[0];
      const dy = y - gesture.last[1];
      gesture.last = [x, y];
      gesture.moved = (gesture.moved || 0) + Math.abs(dx) + Math.abs(dy);
      const { strokes: moved } = moveStrokes(selectionIds.map((id) => strokes.find((s) => s.id === id)).filter(Boolean), dx, dy);
      // rebuild full list with moved strokes applied
      const idSet = new Set(selectionIds);
      const full = strokes.map((s) => (idSet.has(s.id) ? moved.find((m) => m.id === s.id) || s : s));
      setStrokes(full);
      selectionDirty = true; // the halo must follow the moved ink
      let dirty = null;
      selectionIds.forEach((id) => {
        const s = strokes.find((s) => s.id === id);
        if (!s) return;
        const b = strokeBoundsOf(s);
        dirty = unionRect(dirty, b);
        dirty = unionRect(dirty, { minX: b.minX + dx, minY: b.minY + dy, maxX: b.maxX + dx, maxY: b.maxY + dy });
      });
      setDirty(dirty);
      return;
    }
    // draw
    moveEvents.push({ timeStamp: e.timeStamp, clientX: e.clientX, clientY: e.clientY });
    appendDrawPoints(e, gesture);
    liveDirty = true;
    // Grow while the pen is down, not just on commit — a short inline box would
    // clip the live stroke until pointerup otherwise.
    if (y + AUTO_GROW_MARGIN > height) {
      const next = Math.ceil(y + AUTO_GROW_MARGIN);
      if (next > growRequested) {
        growRequested = next;
        onHeightChange(next, { grow: true });
      }
    }
  }

  function pickInsidePolygon(polygon) {
    const inside = ([px, py]) => pointInPolygon(px, py, polygon);
    return strokes.filter((s) => s.points.some(inside)).map((s) => s.id);
  }

  function pressHitsSelection(x, y) {
    return strokes.some(
      (s) =>
        selectionIds.includes(s.id) &&
        s.points.some(
          ([px, py]) =>
            Math.hypot(px - x, py - y) <= (s.size ?? 4) / 2 + SELECTION_GRAB,
        ),
    );
  }

  function clearSelection() {
    if (!selectionIds.length) return;
    selectionIds = [];
    paintSelection();
  }

  function onPointerUp() {
    if (!gesture) return;
    const g = gesture;
    gesture = null;
    gestureRect = null;

    if (g.kind === 'erase') {
      if (g.touched) onUpdateStrokes(strokes);
      return;
    }
    if (g.kind === 'lasso') {
      selectionIds = pickInsidePolygon(g.polygon);
      paintSelection();
      return;
    }
    if (g.kind === 'move-selection') {
      if (g.moved) {
        onUpdateStrokes(strokes);
        selectionIds = [];
      }
      return;
    }
    // draw commit
    let points = g.points;
    if (shouldSnapshot(points, moveEvents)) {
      const rec = recognizeShape(points);
      if (rec) {
        return commitStroke({ ...buildStroke(g.tool, points, g.id, toolSettings), shape: rec.shape, points: rec.snapped });
      }
    }
    commitStroke(buildStroke(g.tool, points, g.id, toolSettings));
  }

  // ---- public API ----
  function resize(w, h, dprVal) {
    const nextDpr = dprVal != null ? dprVal : curDpr;
    // Coalesce redundant resizes: the height watch and the ResizeObserver both
    // drive syncSize, so the same size can arrive twice. Skipping unchanged
    // sizes avoids clearing+repainting the backing store more than once.
    if (w === ink.width && h === ink.height && nextDpr === ink.dpr) return;
    height = h;
    fitCanvas(ink, { width: w, height: h }, nextDpr);
    setStrokes(strokes); // mark the full surface dirty
    selectionDirty = true; // fitCanvas cleared the live layer too
    // Paint the committed strokes immediately so the backing-store clear from
    // fitCanvas is filled synchronously — resize is a single paint, no blank
    // frame between clearing the canvas and redrawing the ink.
    ink.paintStrokes(
      strokes,
      strokeBoundsList,
      { minX: 0, minY: 0, maxX: ink.width, maxY: ink.height },
    );
    inkDirtyRect = null;
  }

  function setTool(t) { tool = t; }
  function setToolSettings(ts) { toolSettings = ts; }
  function setHeight(h) { height = h; }
  function setFocused(f) { focused = f; }
  function setSelectionIds(ids) { selectionIds = ids ?? []; }

  function destroy() {
    if (rafId) cancelAnimationFrame(rafId);
    gesture = null;
  }

  if (typeof requestAnimationFrame !== 'undefined') {
    rafId = requestAnimationFrame(loop);
  }

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp,
    setStrokes,
    resize,
    destroy,
    setTool,
    setToolSettings,
    setHeight,
    setFocused,
    setSelectionIds,
  };
}
