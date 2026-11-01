/** Drawing utilities facade (rendering in freehand.js). Canonical v2 stroke: id, tool, color, size, opacity 0-1, points with pressure 0-1. */

import {
  getRenderablePath,
  getRenderableStrokeProps,
  getLineBounds,
} from './freehand.js';

// Pen-mode / palm-rejection.

export function isPen(e) {
  return e.pointerType === 'pen';
}

/** Palm rejection: touch input only. */
export function isPalmTouch(e) {
  if (e.pointerType === 'pen' || e.pointerType === 'mouse') return false;
  return (e.width ?? 0) > 60 || (e.height ?? 0) > 60;
}

/** Deliberate drawing input; when pen mode is active, pen only. */
export function isDeliberateInput(e, isPenMode = false) {
  if (isPalmTouch(e)) return false;
  if (isPenMode && e.pointerType !== 'pen') return false;
  return (
    e.pointerType === 'pen' ||
    e.pointerType === 'mouse' ||
    e.pointerType === 'touch'
  );
}

/** Stylus eraser button detection (button 5, hardware eraser on some pens). */
export function isStylusEraser(e) {
  return e.button === 5;
}

// Coordinate conversion

/** Accepts the SVG element directly or a Vue ref wrapping it. */
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

/** Pressure sensitivity disabled: always returns 0.5 regardless of input. */
export function normalisePressure(_e) {
  return 0.5;
}

// Coalesced events helper

/** High-Hz styluses fire sub-frame events; falls back to [e] where unsupported. */
export function getCoalescedEvents(e) {
  if (typeof e.getCoalescedEvents === 'function') {
    return e.getCoalescedEvents();
  }
  return [e];
}

export { getRenderablePath, getRenderableStrokeProps, getLineBounds };

/** Tool id -> key of that tool's settings object in the draw state. */
export const TOOL_SETTINGS_KEY = {
  pen: 'penSettings',
  pencil: 'pencilSettings',
  fountain: 'fountainSettings',
  highlighter: 'highlighterSettings',
  eraser: 'eraserSettings',
};

export function cloneDrawingToolDefaults() {
  return {
    pen: { color: '#1a1a1a', size: 4, opacity: 1 },
    pencil: { color: '#4a4a4a', size: 3 },
    fountain: { color: '#1a2744', size: 5 },
    highlighter: { color: '#fbbf24', size: 16, opacity: 0.35 },
    eraser: { size: 20 },
  };
}

/** Convert old stroke arrays (v1/v2) to canonical v2. Pressure unknown, defaults 0.5. */
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

/** Maps points oldBounds → newBounds, preserving each point's pressure. */
export function transformPoints(points, oldBounds, newBounds, transformType) {
  if (!points?.length) return points;

  if (transformType === 'move') {
    const dx = newBounds.x - oldBounds.x;
    const dy = newBounds.y - oldBounds.y;
    return points.map(([x, y, p = 0.5]) => [x + dx, y + dy, p]);
  }

  const sx = oldBounds.width > 0 ? newBounds.width / oldBounds.width : 1;
  const sy = oldBounds.height > 0 ? newBounds.height / oldBounds.height : 1;
  return points.map(([x, y, p = 0.5]) => [
    newBounds.x + (x - oldBounds.x) * sx,
    newBounds.y + (y - oldBounds.y) * sy,
    p,
  ]);
}

/** Rotate points around (cx, cy); angleDeg in degrees, clockwise positive. */
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
