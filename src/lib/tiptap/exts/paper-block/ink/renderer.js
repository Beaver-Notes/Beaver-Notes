/**
 * renderer.js — double-buffered canvas ink renderer.
 *
 * Two stacked canvases: a committed layer (all finished strokes, repainted
 * only inside a dirty rect) and a live layer (only the stroke in progress).
 * Per-stroke bounds cull work; no spatial index — bounds early-out is enough
 * at sketching stroke volumes (tldraw research, 2026-11).
 *
 * Drawing goes through explicit ctx path commands (no Path2D) so the same
 * code runs in happy-dom's stub canvas for pure-logic tests.
 */

import { strokeBounds } from './stroke-model.js';
import { strokeOutline } from './smoother.js';

export function boundsIntersect(a, b) {
  if (!a || !b) return false;
  return a.minX <= b.maxX && b.minX <= a.maxX && a.minY <= b.maxY && b.minY <= a.maxY;
}

export function computeDirtyRect(a, b) {
  if (!a) return b;
  if (!b) return a;
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  };
}

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

  const result = [];
  let segment = [];
  let anyHit = false;
  const flush = () => {
    if (segment.length >= 2) {
      result.push({ ...stroke, id: `${stroke.id}_s${result.length}`, points: segment });
    }
    segment = [];
  };

  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay, ap] = pts[i];
    const dx = ax - x;
    const dy = ay - y;
    if (dx * dx + dy * dy <= r2) {
      anyHit = true;
      flush();
      continue;
    }
    segment.push(pts[i]);

    const [bx, by, bp] = pts[i + 1];
    const abx = bx - ax;
    const aby = by - ay;
    const len2 = abx * abx + aby * aby;
    const t = len2
      ? Math.max(0, Math.min(1, ((x - ax) * abx + (y - ay) * aby) / len2))
      : 0;
    const nx = ax + abx * t;
    const ny = ay + aby * t;
    const ndx = nx - x;
    const ndy = ny - y;
    if (t > 0 && t < 1 && ndx * ndx + ndy * ndy <= r2) {
      anyHit = true;
      segment.push([nx, ny, ap + (bp - ap) * t]);
      flush();
      segment.push([nx, ny, ap + (bp - ap) * t]);
    }
  }

  const last = pts[pts.length - 1];
  const ldx = last[0] - x;
  const ldy = last[1] - y;
  if (ldx * ldx + ldy * ldy <= r2) {
    anyHit = true;
    flush();
  } else {
    segment.push(last);
  }
  flush();

  if (!anyHit) return [stroke];
  return result;
}

export class InkRenderer {
  constructor() {
    this.committed = [];
    this.bounds = [];
    this.liveId = null;
    this.liveStroke = null;
    this.dirty = null;
    this.dpr = 1;
    this.width = 0;
    this.height = 0;
    this.cacheIds = new Set();
    this.cacheDirty = false;
    this.logicEl = null;
    this.liveEl = null;
    this.logicCtx = null;
    this.liveCtx = null;
  }

  attach(logicEl, liveEl, { dpr = 1, width = 0, height = 0 } = {}) {
    this.logicEl = logicEl;
    this.liveEl = liveEl;
    this.logicCtx = logicEl?.getContext?.('2d') ?? null;
    this.liveCtx = liveEl?.getContext?.('2d') ?? null;
    this.resize(width, height, dpr);
  }

  setStrokes(strokes) {
    this.committed = strokes;
    this.bounds = strokes.map((s) => strokeBounds(s));
    const ids = new Set(strokes.map((s) => s.id));
    this.cacheDirty =
      this.cacheDirty || ids.size !== this.cacheIds.size ||
      strokes.some((s) => !this.cacheIds.has(s.id));
    this.cacheIds = ids;
    this.dirty = this._fullRect();
  }

  setDirty(rect) {
    this.dirty = computeDirtyRect(this.dirty, rect);
  }

  paintStrokeLive(id, stroke) {
    this.liveId = id;
    this.liveStroke = stroke;
    this._paintLive();
  }

  clearLive() {
    this.liveId = null;
    this.liveStroke = null;
    this._paintLive();
  }

  commitStroke(stroke) {
    this.committed.push(stroke);
    this.bounds.push(strokeBounds(stroke));
    this.cacheIds.add(stroke.id);
    this.cacheDirty = true;
    this.setDirty(strokeBounds(stroke));
    this.clearLive();
  }

  eraseAt(x, y, radius) {
    const next = [];
    const removedIds = [];
    let changed = false;
    for (const stroke of this.committed) {
      const parts = splitStrokeByEraser(stroke, x, y, radius);
      if (parts.length === 1 && parts[0] === stroke) {
        next.push(stroke);
        continue;
      }
      changed = true;
      if (parts.length === 0) removedIds.push(stroke.id);
      else next.push(...parts);
    }
    if (changed) this.setStrokes(next);
    return { splitStrokes: next, removedIds };
  }

  pick(x, y, radius) {
    for (let i = this.committed.length - 1; i >= 0; i--) {
      const stroke = this.committed[i];
      const bnd = this.bounds[i];
      const r = radius + (stroke.size ?? 4) / 2;
      if (x < bnd.minX - r || x > bnd.maxX + r || y < bnd.minY - r || y > bnd.maxY + r)
        continue;
      const pts = stroke.points;
      for (let i = 0; i < pts.length; i++) {
        // segment distance, so sparse strokes (straight lines) stay pickable
        const [ax, ay] = pts[i];
        if (i === pts.length - 1) {
          if (Math.hypot(ax - x, ay - y) <= r) return stroke;
          continue;
        }
        const [bx, by] = pts[i + 1];
        const abx = bx - ax;
        const aby = by - ay;
        const len2 = abx * abx + aby * aby;
        const t = len2 ? Math.max(0, Math.min(1, ((x - ax) * abx + (y - ay) * aby) / len2)) : 0;
        const dx = ax + abx * t - x;
        const dy = ay + aby * t - y;
        if (dx * dx + dy * dy <= r * r) return stroke;
      }
    }
    return null;
  }

  resize(width, height, dpr = this.dpr) {
    this.width = width;
    this.height = height;
    this.dpr = dpr;
    for (const el of [this.logicEl, this.liveEl]) {
      if (!el) continue;
      el.width = Math.round(width * dpr);
      el.height = Math.round(height * dpr);
      if (el.style) el.style.width = `${width}px`;
      if (el.style) el.style.height = `${height}px`;
    }
    for (const ctx of [this.logicCtx, this.liveCtx]) {
      if (ctx?.setTransform) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    this.dirty = this._fullRect();
    this._paintLive();
  }

  /** Repaint pass — call from a rAF loop. Cheap when nothing is dirty. */
  flush() {
    const dirty = this.dirty;
    if (this.logicCtx && (dirty || this.cacheDirty)) {
      const rect = this.cacheDirty ? this._fullRect() : dirty;
      this.logicCtx.clearRect(rect.minX, rect.minY, rect.maxX - rect.minX, rect.maxY - rect.minY);
      for (let i = 0; i < this.committed.length; i++) {
        if (!boundsIntersect(this.bounds[i], rect)) continue;
        this._drawStroke(this.logicCtx, this.committed[i]);
      }
      this.cacheDirty = false;
    }
    this.dirty = null;
  }

  _paintLive() {
    if (!this.liveCtx) return;
    this.liveCtx.clearRect(0, 0, this.width, this.height);
    if (this.liveStroke) this._drawStroke(this.liveCtx, this.liveStroke);
  }

  _fullRect() {
    return { minX: 0, minY: 0, maxX: this.width, maxY: this.height };
  }

  _drawStroke(ctx, stroke) {
    const outline = strokeOutline(stroke);
    if (!outline.length) return;
    ctx.globalAlpha = stroke.opacity ?? 1;
    ctx.fillStyle = stroke.color;
    ctx.beginPath();
    ctx.moveTo(outline[0][0], outline[0][1]);
    for (let i = 1; i < outline.length; i++) {
      ctx.lineTo(outline[i][0], outline[i][1]);
    }
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;
  }
}
