/**
 * drawHelper.js - drawing utilities facade
 *
 * Delegates rendering to freehand.js.
 * Handles:
 *   - Apple Pencil pen mode detection (from tldraw's Editor.ts dispatch)
 *   - Palm rejection (from tldraw's penMode + contact area)
 *   - Coordinate conversion (SVG getScreenCTM)
 *   - Pressure normalisation (pen real, mouse simulated)
 *   - Coalesced event handling
 *   - Point interpolation / smoothing
 *   - Legacy stroke migration
 *   - Straight-line segment insertion (Shift+draw)
 *
 * Stroke format (canonical v2):
 *   {
 *     id:      string,
 *     tool:    'pen' | 'highlighter',
 *     color:   string,      // CSS color
 *     size:    number,      // base diameter px
 *     opacity: number,      // 0–1
 *     _isPen:  boolean,     // whether drawn with a real stylus
 *     points:  [x, y, pressure][]   // pressure 0–1
 *   }
 */

import {
  getRenderablePath,
  getRenderableStrokeProps,
  getLineBounds,
} from './freehand.js';

// Pen-mode / Palm-rejection (from tldraw)

/**
 * True when the input is a real pen/stylus.
 * This is the key Apple Pencil detection.
 */
export function isPen(e) {
  return e.pointerType === 'pen';
}

/**
 * True if the touch contact area looks like a palm resting on screen.
 * Only relevant for touch input (pen and mouse are always deliberate).
 */
export function isPalmTouch(e) {
  if (e.pointerType === 'pen' || e.pointerType === 'mouse') return false;
  return (e.width ?? 0) > 60 || (e.height ?? 0) > 60;
}

/**
 * True for any deliberate drawing input.
 * When isPenMode is active, only pen input is accepted.
 */
export function isDeliberateInput(e, isPenMode = false) {
  if (isPalmTouch(e)) return false;
  if (isPenMode && e.pointerType !== 'pen') return false;
  return (
    e.pointerType === 'pen' ||
    e.pointerType === 'mouse' ||
    e.pointerType === 'touch'
  );
}

/**
 * Stylus eraser button detection (button 5).
 * From tldraw — some styluses (Surface Pen, Wacom) have a hardware eraser.
 */
export function isStylusEraser(e) {
  return e.button === 5;
}

// Double-tap zoom fix (from tldraw's useFixSafariDoubleTapZoomPencilEvents)

/**
 * Prevent iOS double-tap-to-zoom when using Apple Pencil.
 * Call this on touchstart/touchend when isPen(e) is true.
 * Must be called with a real DOM event, not a synthetic one.
 */
export function preventPencilDoubleTapZoom(e) {
  if (e instanceof PointerEvent && e.pointerType === 'pen') {
    e.preventDefault();
  }
}

// Coordinate conversion

/**
 * Convert a pointer event to SVG-local coordinates via the CTM.
 * Accepts either the SVG element directly or a Vue ref wrapping it.
 */
export function getPointerCoordinates(event, svgElement) {
  const svg = svgElement?.value ?? svgElement;
  if (!svg) return [event.clientX, event.clientY];

  const pt = svg.createSVGPoint();
  pt.x = event.clientX;
  pt.y = event.clientY;

  const ctm = svg.getScreenCTM();
  if (!ctm) return [event.clientX, event.clientY];

  const local = pt.matrixTransform(ctm.inverse());
  return [local.x, local.y];
}

/**
 * Return a 0–1 pressure value from a pointer event.
 * All inputs return 0.5 — pressure sensitivity disabled for consistency.
 */
export function normalisePressure(_e) {
  return 0.5;
}

// Point interpolation / smoothing

/**
 * Smooth raw pointer samples using Douglas–Peucker thinning +
 * Chaikin corner-cutting. Operates on `[x, y, pressure]` triplets.
 */
export function interpolatePoints(
  points,
  { passes = 2, threshold = 2.5 } = {}
) {
  if (!points || points.length < 3) return points ?? [];

  // Light D-P thinning
  let pts = douglasPeucker(points, threshold);

  // Chaikin corner-cutting for smooth curves
  for (let pass = 0; pass < passes; pass++) {
    const next = [pts[0]];
    for (let i = 0; i < pts.length - 1; i++) {
      const [x0, y0, p0 = 0.5] = pts[i];
      const [x1, y1, p1 = 0.5] = pts[i + 1];
      next.push(
        [x0 * 0.75 + x1 * 0.25, y0 * 0.75 + y1 * 0.25, p0 * 0.75 + p1 * 0.25],
        [x0 * 0.25 + x1 * 0.75, y0 * 0.25 + y1 * 0.75, p0 * 0.25 + p1 * 0.75]
      );
    }
    next.push(pts[pts.length - 1]);
    pts = next;
  }

  return pts;
}

function douglasPeucker(pts, epsilon) {
  if (pts.length <= 2) return pts;

  const [x1, y1] = pts[0];
  const [x2, y2] = pts[pts.length - 1];
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy);

  let maxDist = 0;
  let maxIdx = 0;

  for (let i = 1; i < pts.length - 1; i++) {
    const [px, py] = pts[i];
    const dist =
      len > 0
        ? Math.abs(dy * px - dx * py + x2 * y1 - y2 * x1) / len
        : Math.hypot(px - x1, py - y1);
    if (dist > maxDist) {
      maxDist = dist;
      maxIdx = i;
    }
  }

  if (maxDist > epsilon) {
    const left = douglasPeucker(pts.slice(0, maxIdx + 1), epsilon);
    const right = douglasPeucker(pts.slice(maxIdx), epsilon);
    return [...left.slice(0, -1), ...right];
  }

  return [pts[0], pts[pts.length - 1]];
}

// Straight-line segment insertion (Shift+draw, from tldraw's Drawing.ts)

/**
 * Insert a straight-line segment into an existing stroke's points.
 * Used when the user holds Shift mid-stroke to lock to a straight line.
 *
 * @param {Array<[number,number,number]>} existingPoints - current stroke points
 * @param {number} fromX - segment start X
 * @param {number} fromY - segment start Y
 * @param {number} toX - segment end X
 * @param {number} toY - segment end Y
 * @param {number} pressure
 * @returns {Array<[number,number,number]>} new points array with straight line appended
 */
export function appendStraightSegment(
  existingPoints,
  fromX,
  fromY,
  toX,
  toY,
  pressure = 0.5
) {
  const dist = Math.hypot(toX - fromX, toY - fromY);
  const steps = Math.max(2, Math.floor(dist / 4));

  const result = [...existingPoints];
  result.push([fromX, fromY, pressure]); // anchor at start of segment
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    result.push([
      fromX + (toX - fromX) * t,
      fromY + (toY - fromY) * t,
      pressure,
    ]);
  }
  result.push([toX, toY, pressure]); // end point
  return result;
}

// Coalesced events helper

/**
 * Get all coalesced events from a pointermove event.
 * High-Hz styluses (Apple Pencil) fire multiple sub-frame events;
 * this captures them all for smooth ink.
 * Falls back to the single event on platforms where getCoalescedEvents
 * isn't available (e.g. iOS in non-HTTPS contexts).
 */
export function getCoalescedEvents(e) {
  if (typeof e.getCoalescedEvents === 'function') {
    return e.getCoalescedEvents();
  }
  return [e];
}

// Re-exports from freehand.js

export { getRenderablePath, getRenderableStrokeProps, getLineBounds };

// Default tool settings

export function cloneDrawingToolDefaults() {
  return {
    pen: { color: '#1a1a1a', size: 4, opacity: 1 },
    highlighter: { color: '#fbbf24', size: 16, opacity: 0.35 },
    eraser: { size: 20 },
  };
}

/**
 * Convert old stroke arrays (lines / linesV2) to the canonical v2 format.
 *
 * Old formats:
 *  - v1 `lines`:   `{ tool, color, size, points: [[x,y], ...] }`
 *  - v2 `linesV2`: `{ id, tool, color, size, opacity, points: [[x,y], ...] }`
 *
 * In both cases pressure is unknown. Default to 0.5.
 */
export function migrateStrokes(rawLines, rawLinesV2) {
  const source =
    Array.isArray(rawLinesV2) && rawLinesV2.length > 0
      ? rawLinesV2
      : Array.isArray(rawLines)
      ? rawLines
      : [];

  return source.map((line, idx) => ({
    id: line.id ?? `migrated-${idx}`,
    tool: line.tool ?? 'pen',
    color: line.color ?? '#000000',
    size: line.size ?? 4,
    opacity: line.opacity ?? (line.tool === 'highlighter' ? 0.35 : 1),
    _isPen: line._isPen ?? false,
    points: (line.points ?? []).map((pt) =>
      pt.length >= 3 ? [pt[0], pt[1], pt[2]] : [pt[0], pt[1], 0.5]
    ),
  }));
}

// Point transforms (used by transformHelper.js)

/**
 * Move or resize all points in a stroke from oldBounds → newBounds.
 * Preserves the pressure (3rd element) of each point.
 */
export function transformPoints(points, oldBounds, newBounds, transformType) {
  if (!points?.length) return points;

  if (transformType === 'move') {
    const dx = newBounds.x - oldBounds.x;
    const dy = newBounds.y - oldBounds.y;
    return points.map(([x, y, p = 0.5]) => [x + dx, y + dy, p]);
  }

  // resize
  const sx = oldBounds.width > 0 ? newBounds.width / oldBounds.width : 1;
  const sy = oldBounds.height > 0 ? newBounds.height / oldBounds.height : 1;
  return points.map(([x, y, p = 0.5]) => [
    newBounds.x + (x - oldBounds.x) * sx,
    newBounds.y + (y - oldBounds.y) * sy,
    p,
  ]);
}

/**
 * Rotate all points around (cx, cy) by angleDeg degrees (CW positive).
 */
export function rotatePoints(points, cx, cy, angleDeg) {
  const rad = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return points.map(([x, y, p = 0.5]) => {
    const dx = x - cx;
    const dy = y - cy;
    return [cx + dx * cos - dy * sin, cy + dx * sin + dy * cos, p];
  });
}
