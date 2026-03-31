/**
 * drawHelper.js
 *
 * Stroke format (canonical v2):
 *   {
 *     id:      string,
 *     tool:    'pen' | 'highlighter',
 *     color:   string,      // CSS color
 *     size:    number,      // base diameter px
 *     opacity: number,      // 0–1
 *     points:  [x, y, pressure][]   // pressure 0–1
 *   }
 *
 * No legacy formats are ever written. Old data is migrated once via
 * migrateStrokes() and then stored in the new format.
 */

import { getStroke } from 'perfect-freehand';

// ---------------------------------------------------------------------------
// Palm-rejection / input type
// ---------------------------------------------------------------------------

/** True if the touch contact area looks like a palm resting on screen. */
export function isPalmTouch(e) {
  if (e.pointerType === 'pen' || e.pointerType === 'mouse') return false;
  return (e.width ?? 0) > 60 || (e.height ?? 0) > 60;
}

/** True for any deliberate drawing input (pen, mouse, finger). */
export function isPenInput(e) {
  return e.pointerType === 'pen' || e.pointerType === 'mouse' || e.pointerType === 'touch';
}

// ---------------------------------------------------------------------------
// Coordinate conversion
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Pressure normalisation
// ---------------------------------------------------------------------------

/**
 * Return a 0–1 pressure value from a pointer event.
 * Pen:   actual e.pressure, floor at 0.08 so first dot is visible.
 * Mouse / Touch: fixed 0.5.
 */
export function normalisePressure(e) {
  if (e.pointerType === 'pen') {
    return Math.max(0.08, Math.min(1, e.pressure));
  }
  return 0.5;
}

// ---------------------------------------------------------------------------
// perfect-freehand options
// ---------------------------------------------------------------------------

function pfOptions(tool, size) {
  if (tool === 'highlighter') {
    return {
      size: size * 1.6,
      thinning: 0,
      smoothing: 0.7,
      streamline: 0.65,
      simulatePressure: false,
      last: true,
      start: { cap: false, taper: 0 },
      end:   { cap: false, taper: 0 },
    };
  }
  // pen (default) — higher streamline for much smoother curves
  return {
    size,
    thinning: 0.5,
    smoothing: 0.65,
    streamline: 0.72,
    easing: (t) => Math.sin((t * Math.PI) / 2),
    simulatePressure: false,
    last: true,
    start: { cap: true, taper: Math.min(size * 2, 20) },
    end:   { cap: true, taper: Math.min(size * 3, 30) },
  };
}

// ---------------------------------------------------------------------------
// SVG path
// ---------------------------------------------------------------------------

function outlineToPath(pts) {
  if (!pts || pts.length === 0) return '';
  if (pts.length < 3) {
    return `M ${pts[0][0]} ${pts[0][1]} L ${pts[pts.length - 1][0]} ${pts[pts.length - 1][1]} Z`;
  }
  // Catmull-Rom → SVG cubic Bézier for a smooth outline
  let d = `M ${pts[0][0].toFixed(2)} ${pts[0][1].toFixed(2)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    // Catmull-Rom tension 0.5
    const cp1x = p1[0] + (p2[0] - p0[0]) / 6;
    const cp1y = p1[1] + (p2[1] - p0[1]) / 6;
    const cp2x = p2[0] - (p3[0] - p1[0]) / 6;
    const cp2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C ${cp1x.toFixed(2)} ${cp1y.toFixed(2)}, ${cp2x.toFixed(2)} ${cp2y.toFixed(2)}, ${p2[0].toFixed(2)} ${p2[1].toFixed(2)}`;
  }
  return d + ' Z';
}

/**
 * Render a stroke object to an SVG `d` string.
 * `stroke.points` must be `[x, y, pressure][]`.
 */
export function getRenderablePath(stroke) {
  if (!Array.isArray(stroke?.points) || stroke.points.length < 2) return '';
  const outline = getStroke(stroke.points, pfOptions(stroke.tool, stroke.size ?? 4));
  return outlineToPath(outline);
}

/**
 * Return SVG presentation props for a stroke.
 */
export function getRenderableStrokeProps(stroke) {
  const isHL = stroke?.tool === 'highlighter';
  return {
    fill: stroke?.color ?? '#000000',
    stroke: 'none',
    strokeWidth: 0,
    opacity: stroke?.opacity ?? (isHL ? 0.35 : 1),
  };
}

// ---------------------------------------------------------------------------
// Bounding box
// ---------------------------------------------------------------------------

export function getLineBounds(stroke) {
  const pts = stroke?.points;
  if (!pts || pts.length === 0) return { x: 0, y: 0, width: 0, height: 0 };

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of pts) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

// ---------------------------------------------------------------------------
// Point transforms
// ---------------------------------------------------------------------------

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
  const sx = oldBounds.width  > 0 ? newBounds.width  / oldBounds.width  : 1;
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

// ---------------------------------------------------------------------------
// Interpolation / smoothing (applied before committing a stroke)
// ---------------------------------------------------------------------------

/**
 * Smooth raw pointer samples using Douglas–Peucker thinning +
 * Chaikin corner-cutting. Operates on `[x, y, pressure]` triplets.
 */
export function interpolatePoints(points, { passes = 2, threshold = 2.5 } = {}) {
  if (!points || points.length < 3) return points ?? [];

  // Light D-P thinning — keeps more detail than before (lower threshold)
  let pts = douglasPeucker(points, threshold);

  // Chaikin corner-cutting for smooth curves, preserving endpoints exactly
  for (let pass = 0; pass < passes; pass++) {
    const next = [pts[0]];
    for (let i = 0; i < pts.length - 1; i++) {
      const [x0, y0, p0 = 0.5] = pts[i];
      const [x1, y1, p1 = 0.5] = pts[i + 1];
      next.push(
        [x0 * 0.75 + x1 * 0.25, y0 * 0.75 + y1 * 0.25, p0 * 0.75 + p1 * 0.25],
        [x0 * 0.25 + x1 * 0.75, y0 * 0.25 + y1 * 0.75, p0 * 0.25 + p1 * 0.75],
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
  let maxIdx  = 0;

  for (let i = 1; i < pts.length - 1; i++) {
    const [px, py] = pts[i];
    const dist = len > 0
      ? Math.abs(dy * px - dx * py + x2 * y1 - y2 * x1) / len
      : Math.hypot(px - x1, py - y1);
    if (dist > maxDist) { maxDist = dist; maxIdx = i; }
  }

  if (maxDist > epsilon) {
    const left  = douglasPeucker(pts.slice(0, maxIdx + 1), epsilon);
    const right = douglasPeucker(pts.slice(maxIdx), epsilon);
    return [...left.slice(0, -1), ...right];
  }

  return [pts[0], pts[pts.length - 1]];
}

// ---------------------------------------------------------------------------
// Legacy migration (one-way, run once on block load)
// ---------------------------------------------------------------------------

/**
 * Convert old stroke arrays (lines / linesV2) to the canonical v2 format.
 *
 * Old formats:
 *  - v1 `lines`:   `{ tool, color, size, points: [[x,y], ...] }`
 *  - v2 `linesV2`: `{ id, tool, color, size, opacity, points: [[x,y], ...] }`
 *
 * In both cases pressure is unknown, so we default to 0.5.
 * Once migrated the result is stored as the new `strokes` attribute;
 * the legacy `lines`/`linesV2` attrs are never written again.
 */
export function migrateStrokes(rawLines, rawLinesV2) {
  const source =
    Array.isArray(rawLinesV2) && rawLinesV2.length > 0
      ? rawLinesV2
      : Array.isArray(rawLines)
        ? rawLines
        : [];

  return source.map((line, idx) => ({
    id:      line.id      ?? `migrated-${idx}`,
    tool:    line.tool    ?? 'pen',
    color:   line.color   ?? '#000000',
    size:    line.size    ?? 4,
    opacity: line.opacity ?? (line.tool === 'highlighter' ? 0.35 : 1),
    points:  (line.points ?? []).map((pt) =>
      pt.length >= 3 ? [pt[0], pt[1], pt[2]] : [pt[0], pt[1], 0.5]
    ),
  }));
}

// ---------------------------------------------------------------------------
// Default tool settings
// ---------------------------------------------------------------------------

export function cloneDrawingToolDefaults() {
  return {
    pen:         { color: '#000000', size: 4,  opacity: 1    },
    highlighter: { color: '#FFFF00', size: 16, opacity: 0.35 },
    eraser:      { size: 20 },
  };
}
