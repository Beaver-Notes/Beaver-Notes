/**
 * inkModel.js — stroke factory + shared draw primitive (REDESIGN phase B).
 *
 * `makeStroke(id, tool, color, size, opacity, points, extra)` → stroke object.
 * `class StrokeDrawable` with static `drawStroke(ctx, stroke)` — one fill path,
 * no Path2D (happy-dom safe).
 *
 * `import { strokeOutline } from './smoother.js'` (kept — not replaced).
 */

import { strokeOutline, paintGrain } from './smoother.js';
import { paintInkColor } from './inkTheme.js';

export function makeStroke(id, tool, color, size, opacity, points, extra = {}) {
  return {
    id,
    tool,
    color,
    size,
    opacity,
    points: points ?? [],
    ...extra,
  };
}

export class StrokeDrawable {
  /** One fill path for `stroke` into `ctx`. Display color only — the stored
   *  stroke keeps its own (theme swap happens at paint time). */
  static drawStroke(ctx, stroke) {
    const outline = strokeOutline(stroke);
    if (!outline.length) return;
    ctx.globalAlpha = stroke.opacity ?? 1;
    ctx.fillStyle = paintInkColor(stroke.color ?? '#000000');
    ctx.beginPath();
    ctx.moveTo(outline[0][0], outline[0][1]);
    for (let i = 1; i < outline.length; i++) {
      ctx.lineTo(outline[i][0], outline[i][1]);
    }
    ctx.closePath();
    ctx.fill();
    paintGrain(ctx, stroke);
    ctx.globalAlpha = 1;
  }
}
