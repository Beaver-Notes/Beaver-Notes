/**
 * inkModel2.js — stroke mutation primitives (REDESIGN phase B).
 *
 * `import { strokeBounds } from './stroke-model.js'` (kept as the bounds source).
 * `splitStrokeByEraser` moved here from `renderer.js` (renderer.js retired
 * after the port).
 *
 * `moveStrokes(strokes, dx, dy)` → `{ strokes, bounds }` — preserves point
 * tuple arity (never injects `undefined` pressure).
 * `eraseStrokes(strokes, x, y, radius)` → `{ strokes, bounds, removedIds }`.
 */

import { strokeBounds } from './stroke-model.js';

/**
 * Object eraser: removes points inside the eraser radius and cuts segments
 * that pass through it at the nearest point (interpolated, pressure carried).
 * Surviving pieces keep point order and get `${id}_s${n}` ids. Pure.
 */
export function splitStrokeByEraser(stroke, x, y, radius) {
  const pts = stroke.points;
  if (!pts || pts.length === 0) return [stroke];

  const effectiveR = radius + (stroke.size ?? 4) / 2;
  const r2 = effectiveR * effectiveR;

  // Crossing of segment A→B with the eraser circle: root t of
  // |A + t(B−A) − C|² = r². 'entry' = first (smaller) root, 'exit' = larger.
  const boundary = (a, b, which) => {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const fx = a[0] - x;
    const fy = a[1] - y;
    const qa = dx * dx + dy * dy;
    const qb = 2 * (dx * fx + dy * fy);
    const qc = fx * fx + fy * fy - r2;
    const disc = qb * qb - 4 * qa * qc;
    if (qa === 0 || disc < 0) return null;
    const sq = Math.sqrt(disc);
    const t = which === 'entry' ? (-qb - sq) / (2 * qa) : (-qb + sq) / (2 * qa);
    if (t <= 0 || t >= 1) return null;
    return [a[0] + dx * t, a[1] + dy * t, a[2] + (b[2] - a[2]) * t];
  };

  const inside = (p) => (p[0] - x) * (p[0] - x) + (p[1] - y) * (p[1] - y) <= r2;

  const result = [];
  let segment = [];
  let anyHit = false;
  const flush = () => {
    if (segment.length >= 2) {
      result.push({ ...stroke, id: `${stroke.id}_s${result.length}`, points: segment });
    }
    segment = [];
  };

  for (let i = 0; i < pts.length; i++) {
    if (!inside(pts[i])) {
      segment.push(pts[i]);
      // pass-through: both endpoints outside but the segment dips into the eraser
      const next = pts[i + 1];
      if (next && !inside(next)) {
        const entry = boundary(pts[i], next, 'entry');
        if (entry) {
          anyHit = true;
          segment.push(entry);
          flush();
          const exit = boundary(pts[i], next, 'exit');
          if (exit) segment.push(exit);
        }
      }
      continue;
    }
    // point inside the eraser: cut at the radius boundary on both sides
    anyHit = true;
    const prev = pts[i - 1];
    if (prev && !inside(prev)) {
      const entry = boundary(prev, pts[i], 'entry');
      if (entry) segment.push(entry);
    }
    flush();
    const next = pts[i + 1];
    if (next && !inside(next)) {
      const exit = boundary(pts[i], next, 'exit');
      if (exit) segment.push(exit);
    }
  }
  flush();

  if (!anyHit) return [stroke];
  return result;
}

export function moveStrokes(strokes, dx, dy) {
  const next = (strokes ?? []).map((s) => ({
    ...s,
    points: s.points.map(([px, py, pp]) => [px + dx, py + dy, pp]),
  }));
  return { strokes: next, bounds: next.map((s) => strokeBounds(s)) };
}

export function eraseStrokes(strokes, x, y, radius) {
  const next = [];
  const removedIds = [];
  let changed = false;
  // Surviving pieces are segments of the original polyline, so they stay
  // inside the stroke's old bounds: old bounds ∪ eraser circle cover every
  // pixel the split can touch — no full-surface repaint per pointermove.
  let touched = {
    minX: x - radius,
    minY: y - radius,
    maxX: x + radius,
    maxY: y + radius,
  };
  const bounds = (strokes ?? []).map((s) => strokeBounds(s));
  for (let i = 0; i < strokes.length; i++) {
    const stroke = strokes[i];
    const parts = splitStrokeByEraser(stroke, x, y, radius);
    if (parts.length === 1 && parts[0] === stroke) {
      next.push(stroke);
      continue;
    }
    changed = true;
    touched = {
      minX: Math.min(touched.minX, bounds[i].minX),
      minY: Math.min(touched.minY, bounds[i].minY),
      maxX: Math.max(touched.maxX, bounds[i].maxX),
      maxY: Math.max(touched.maxY, bounds[i].maxY),
    };
    if (parts.length === 0) removedIds.push(stroke.id);
    else next.push(...parts);
  }
  if (!changed) return { strokes, bounds, removedIds: [] };
  return {
    strokes: next,
    bounds: next.map((s) => strokeBounds(s)),
    removedIds,
  };
}
