/**
 * inkCanvas.js — DOM + painting primitives (REDESIGN phase A).
 *
 * Wraps 2–3 stacked canvases: drawing (committed strokes — the persistent
 * bitmap), subtree (shape overlays / lasso tint, shares drawing's transform),
 * and interactive (live in-progress stroke, cleared every frame, never part of
 * the committed bitmap). No TipTap/Vue imports; explicit ctx path commands (no
 * Path2D) so the same code runs in happy-dom's stub canvas for pure-logic tests.
 */

import { strokeOutline } from './smoother.js';

/** CSS size suffix for a canvas rect in px. */
export function px(value) {
  return `${value}px`;
}

/** Size one `<canvas>` backing store × dpr, CSS px size; set the 2d transform
 *  to the dpr-scaled identity `(dpr,0,0,dpr,0,0)`. */
export function changeDrawing(canvas, { rect, dpr }) {
  const width = rect?.width ?? 0;
  const height = rect?.height ?? 0;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  if (canvas.style) {
    canvas.style.width = px(width);
    canvas.style.height = px(height);
  }
  const ctx = canvas.getContext?.('2d');
  if (ctx?.setTransform) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

export class InkCanvas {
  constructor() {
    this.drawing = null;
    this.subtree = null;
    this.interactive = null;
    this.drawingCtx = null;
    this.subtreeCtx = null;
    this.interactiveCtx = null;
    this.dpr = 1;
    this.width = 0;
    this.height = 0;
  }

  attach(drawing, subtree = null, interactive = null) {
    this.drawing = drawing;
    this.subtree = subtree;
    this.interactive = interactive;
    this.drawingCtx = drawing?.getContext?.('2d') ?? null;
    this.subtreeCtx = subtree?.getContext?.('2d') ?? null;
    this.interactiveCtx = interactive?.getContext?.('2d') ?? null;
  }

  /** Size every attached canvas; the committed bitmap lives on `drawing`. */
  changeDrawing({ rect, dpr }) {
    this.dpr = dpr ?? 1;
    this.width = rect?.width ?? 0;
    this.height = rect?.height ?? 0;
    for (const el of [this.drawing, this.subtree, this.interactive]) {
      if (!el) continue;
      changeDrawing(el, { rect, dpr: this.dpr });
    }
  }

  bounds() {
    return this.drawing ? this.drawing.getBoundingClientRect() : null;
  }

  /** Device-pixel snap factor = dpr; cull rects snap outward through it. */
  rounding() {
    return this.dpr;
  }

  contextOf(kind) {
    if (kind === 'drawing') return this.drawingCtx;
    if (kind === 'subtree') return this.subtreeCtx;
    if (kind === 'interactive') return this.interactiveCtx;
    return null;
  }

  /** Clear `rect`, then fill committed strokes whose bounds intersect it.
   *  Cull rects are snapped outward by the device-pixel snap factor; each
   *  stroke's bounds get its strip width (`round(size * 0.75 + 2)`) of feather
   *  margin so plain geometry bounds never leave sub-pixel seams. */
  paintStrokes(strokes, bounds, rect) {
    const ctx = this.contextOf('drawing');
    if (!ctx || !rect) return;
    const d = this.rounding();
    const c = {
      minX: Math.floor(rect.minX * d) / d,
      minY: Math.floor(rect.minY * d) / d,
      maxX: Math.ceil(rect.maxX * d) / d,
      maxY: Math.ceil(rect.maxY * d) / d,
    };
    ctx.clearRect(c.minX, c.minY, c.maxX - c.minX, c.maxY - c.minY);
    for (let i = 0; i < strokes.length; i++) {
      const stroke = strokes[i];
      const b = bounds?.[i];
      if (!b) continue;
      const margin = Math.round((stroke.size ?? 4) * 0.75 + 2);
      if (
        b.maxX + margin < c.minX ||
        b.minX - margin > c.maxX ||
        b.maxY + margin < c.minY ||
        b.minY - margin > c.maxY
      ) {
        continue;
      }
      this.fillStroke(ctx, stroke);
    }
  }

  /** Fill one stroke outline into a 2d ctx (no Path2D; happy-dom safe). */
  fillStroke(ctx, stroke) {
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

  /** Paint the live in-progress stroke on the interactive canvas; cleared every frame. */
  paintLive(stroke) {
    const ctx = this.contextOf('interactive');
    const el = this.interactive;
    if (!ctx || !el) return;
    ctx.clearRect(0, 0, this.width, this.height);
    if (stroke) this.fillStroke(ctx, stroke);
  }
}
