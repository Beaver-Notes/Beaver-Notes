/**
 * ink/previewImage.js — offscreen preview bitmap (REDESIGN phase C).
 *
 * Builds a static, tldraw-style preview of committed strokes once at commit
 * time, so the inline node never repaints from Yjs on every keystroke.
 */

import { strokeOutline, paintGrain } from './smoother.js';
import { paintInkColor } from './inkTheme.js';
import { migrateStrokes } from './stroke-model.js';

/** Outline strip polygon for a stroke at an overridden size (static preview). */
export function getStroke(stroke, size) {
  const s = size != null ? { ...stroke, size } : stroke;
  return strokeOutline(s);
}

/** Final clear pass removing fade residue from a 2d context. */
export function cleanBitmap(ctx, width, height) {
  if (!ctx) return;
  ctx.clearRect(0, 0, width, height);
}

/** Fill one stroke outline into a 2d context (shared fill primitive). */
function fillStroke(ctx, stroke) {
  const outline = strokeOutline(stroke);
  if (!outline.length) return;
  ctx.globalAlpha = (stroke.opacity ?? 1) * (stroke.tool === 'pencil' ? 0.7 : 1);
  ctx.fillStyle = paintInkColor(stroke.color); // display-only theme mapping
  ctx.beginPath();
  ctx.moveTo(outline[0][0], outline[0][1]);
  for (let i = 1; i < outline.length; i++) ctx.lineTo(outline[i][0], outline[i][1]);
  ctx.closePath();
  ctx.fill();
  paintGrain(ctx, stroke);
  ctx.globalAlpha = 1;
}

/** Offscreen bitmap that composites stroke bands once at committed time. */
export class PreviewImage {
  constructor({ width = 0, height = 0, strokes = [], canvas } = {}) {
    this.width = width;
    this.height = height;
    this.strokes = Array.isArray(strokes) ? strokes : [];
    this._canvas = canvas ?? null;
    this._ctx = this._canvas?.getContext?.('2d') ?? null;
    this._timer = null;
  }

  get canvas() {
    return this._canvas;
  }

  /** Draw all strokes into the offscreen bitmap (committed time, not per frame). */
  commit() {
    const ctx = this._ctx;
    if (!ctx) return this;
    ctx.clearRect(0, 0, this.width, this.height);
    for (let i = 0; i < this.strokes.length; i++) fillStroke(ctx, this.strokes[i]);
    return this;
  }

  /**
   * Short fade of a temporary wet-ink band, then a final clean pass.
   * No animation loop is left running after the fade ends.
   */
  fade(band, { duration = 120 } = {}) {
    this.stopFade();
    const ctx = this._ctx;
    if (!ctx) return this;
    fillStroke(ctx, band);
    this._timer = setTimeout(() => {
      this._timer = null;
      cleanBitmap(ctx, this.width, this.height);
    }, duration);
    return this;
  }

  /** Cancel any pending fade timer. */
  stopFade() {
    if (this._timer != null) {
      clearTimeout(this._timer);
      this._timer = null;
    }
  }

  /** Final clear pass removing fade residue. */
  cleanBitmap() {
    cleanBitmap(this._ctx, this.width, this.height);
    return this;
  }

  /** Replay this preview's strokes into a target 2d context (the visible canvas). */
  drawTo(ctx) {
    if (!ctx) return;
    for (let i = 0; i < this.strokes.length; i++) fillStroke(ctx, this.strokes[i]);
  }

  destroy() {
    this.stopFade();
  }
}

/**
 * Rebuild a PreviewImage from the serialized `preview` attr. Accepts a JSON
 * string or an object; never throws on malformed data.
 */
export function parsePreviewImage(data) {
  let parsed;
  if (data == null) return null;
  if (typeof data === 'string') {
    try {
      parsed = JSON.parse(data);
    } catch {
      return null;
    }
  } else if (typeof data === 'object') {
    parsed = data;
  } else {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  return new PreviewImage({
    width: Number(parsed.width) || 0,
    height: Number(parsed.height) || 0,
    strokes: migrateStrokes(parsed.strokes),
  });
}
