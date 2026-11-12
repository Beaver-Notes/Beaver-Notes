/** Pressure-aware outline generation, wrapped on perfect-freehand. Pure. */

import { getStroke } from 'perfect-freehand';

/** Per-tool perfect-freehand options. Eraser never renders as ink (renderer-side). */
const TOOL_OPTIONS = {
  pen: { size: 4, thinning: 0.6, smoothing: 0.5, streamline: 0.5, easing: (t) => t, simulatePressure: true, last: true },
  pencil: { size: 3, thinning: 0.8, smoothing: 0.4, streamline: 0.4, easing: (t) => t, simulatePressure: true, last: true },
  fountain: { size: 5, thinning: 0.35, smoothing: 0.7, streamline: 0.6, easing: (t) => t, simulatePressure: true, last: true },
  // Marker: near-uniform width, squared caps — the highlighter look.
  marker: { size: 16, thinning: 0.05, smoothing: 0.5, streamline: 0.5, cap: false, easing: (t) => t, simulatePressure: false, last: true },
};

/** Outline polygon for a stroke: [[x, y], …]. Empty for < 2 samples. */
export function strokeOutline(stroke) {
  if (!stroke.points || stroke.points.length < 2) return [];
  const options = { ...(TOOL_OPTIONS[stroke.tool] ?? TOOL_OPTIONS.pen), size: stroke.size ?? (TOOL_OPTIONS[stroke.tool]?.size ?? 4) };
  return getStroke(stroke.points, options);
}

/** Builds a Path2D-like from the outline. `Path2DCtor` defaults to the global (browser). */
export function strokePath(stroke, Path2DCtor = globalThis.Path2D) {
  const path = new Path2DCtor();
  const outline = strokeOutline(stroke);
  for (let i = 0; i < outline.length; i += 1) {
    const [x, y] = outline[i];
    if (i === 0) path.moveTo(x, y);
    else path.lineTo(x, y);
  }
  path.closePath();
  return path;
}

/** Axis-aligned bounds of an outline point list (works on stroke objects too). */
export function pathBounds(target) {
  const points = Array.isArray(target) ? target : target?.points ?? [];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of points) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}
