/** Pressure-aware outline generation, wrapped on perfect-freehand. Pure. */

import { getStroke } from 'perfect-freehand';
import { paintInkColor } from './inkTheme.js';

/** Per-tool perfect-freehand options. Eraser never renders as ink (renderer-side). */
const TOOL_OPTIONS = {
  pen: { size: 4, thinning: 0, smoothing: 0.5, streamline: 0.5, easing: (t) => t, simulatePressure: false, last: true },
  pencil: { size: 3, thinning: 0, smoothing: 0.4, streamline: 0.4, easing: (t) => t, simulatePressure: false, last: true },
  fountain: { size: 5, thinning: 0.35, smoothing: 0.7, streamline: 0.6, easing: (t) => t, simulatePressure: false, last: true },
  // Marker: near-uniform width, flat ends at the input points — the highlighter look.
  marker: { size: 16, thinning: 0.05, smoothing: 0.5, streamline: 0.5, easing: (t) => t, simulatePressure: false, last: true, start: { cap: false }, end: { cap: false } },
};

/** Fountain input transform: keeps the stored points, only swaps the pressure
 *  channel the outline builder reads (never the geometry, never the attrs). */
const FLAT_PRESSURE = 0.02; // spread below this = the device reports no pressure
const INK_REF_SPEED = 12; // px per sample that reads as a fast stroke

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * Fountain width per point. Real stylus pressure whenever the device reports
 * any spread — an iPad that answers every event with a flat 0.5 would otherwise
 * ink at one dead width. Only then does velocity take over (slow = fat, fast =
 * thin), which is what `simulatePressure` fakes for the other tools.
 */
export function fountainPressures(points) {
  const raw = points.map((p) => clamp01(p[2] ?? 0.5));
  let min = 1;
  let max = 0;
  for (const p of raw) {
    if (p < min) min = p;
    if (p > max) max = p;
  }
  if (max - min > FLAT_PRESSURE) return raw;
  let smoothed = 0.9; // pen-down starts fat: the ink dot of a real nib
  return points.map((p, i) => {
    if (i > 0) {
      const q = points[i - 1];
      const speed = Math.hypot(p[0] - q[0], p[1] - q[1]);
      const target = 0.9 - 0.8 * clamp01(speed / INK_REF_SPEED);
      smoothed += (target - smoothed) * 0.5; // EMA: no jitter on dense samples
    }
    return smoothed;
  });
}

/** Outline polygon for a stroke: [[x, y], …]. Empty for < 2 samples. */
export function strokeOutline(stroke) {
  const points = stroke?.points;
  if (!points || points.length < 2) return [];
  if (stroke.tool === 'fountain') {
    const pressures = fountainPressures(points);
    return getStroke(
      points.map((p, i) => [p[0], p[1], pressures[i]]),
      { ...TOOL_OPTIONS.fountain, size: stroke.size ?? TOOL_OPTIONS.fountain.size },
    );
  }
  const options = { ...(TOOL_OPTIONS[stroke.tool] ?? TOOL_OPTIONS.pen), size: stroke.size ?? (TOOL_OPTIONS[stroke.tool]?.size ?? 4) };
  return getStroke(points, options);
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

const GRAIN_SPACING = 3.5; // px along the stroke, independent of pointer sample rate

/** Deterministic pencil tooth: scatter fine grains ACROSS the stroke band at
 *  fixed arc-length spacing, so a dense stylus stream doesn't clump into a
 *  rough black mass. Count, spread and darkness follow real pressure. */
export function paintGrain(ctx, stroke) {
  if (stroke.tool !== 'pencil') return;
  const points = stroke.points;
  if (!points.length) return;
  const color = paintInkColor(stroke.color ?? '#000000');
  const alpha = stroke.opacity ?? 1;
  const radius = Math.max(1.2, (stroke.size ?? 3) * 0.6);
  ctx.fillStyle = color;
  let travelled = 0;
  let nextAt = 0;
  let cluster = 0;
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i];
    const b = points[i + 1];
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (length <= 0) continue;
    while (nextAt <= travelled + length) {
      const t = (nextAt - travelled) / length;
      if (t >= 0 && t <= 1) {
        const pressure = clamp01((a[2] ?? 0.5) * (1 - t) + (b[2] ?? 0.5) * t);
        if (pressure > 0.05) {
          const count = 1 + Math.round(pressure * 2);
          const spread = radius * (0.5 + pressure * 0.35);
          ctx.globalAlpha = alpha * (0.1 + pressure * 0.12);
          const x = a[0] + (b[0] - a[0]) * t;
          const y = a[1] + (b[1] - a[1]) * t;
          for (let d = 0; d < count; d += 1) {
            const h = grainHash(cluster, d);
            const angle = ((h & 1023) / 1023) * Math.PI * 2;
            const r = Math.sqrt(((h >>> 10) & 1023) / 1023) * spread;
            const dot = 0.5 + (((h >>> 20) & 7) / 7) * 0.5;
            grainDot(ctx, x + Math.cos(angle) * r, y + Math.sin(angle) * r, dot);
          }
        }
        cluster += 1;
      }
      nextAt += GRAIN_SPACING;
    }
    travelled += length;
  }
  ctx.globalAlpha = 1;
}

function grainDot(ctx, x, y, r) {
  ctx.beginPath();
  ctx.moveTo(x - r, y - r);
  ctx.lineTo(x + r, y - r);
  ctx.lineTo(x + r, y + r);
  ctx.lineTo(x - r, y + r);
  ctx.closePath();
  ctx.fill();
}

function grainHash(i, d) {
  let h = ((i * 31 + d) * 1664525 + 1013904223) | 0;
  h = ((h >> 16) ^ h) * 0x45d9f3b;
  h = ((h >> 16) ^ h) * 0x45d9f3b;
  return h >>> 0;
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
