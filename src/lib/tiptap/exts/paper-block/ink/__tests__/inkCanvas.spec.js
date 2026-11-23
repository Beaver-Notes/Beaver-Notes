import { describe, expect, it } from 'vitest';
import { InkCanvas, px, changeDrawing } from '../inkCanvas.js';
import { strokeBounds } from '../stroke-model.js';

describe('px / changeDrawing', () => {
  it('px formats a value with a px suffix', () => {
    expect(px(5)).toBe('5px');
    expect(px(0)).toBe('0px');
  });

  it('changeDrawing sizes backing store x dpr and sets the dpr transform', () => {
    const ops = [];
    const ctx = { setTransform: (a, b, c, d, e, f) => ops.push([a, b, c, d, e, f]) };
    const canvas = { width: 0, height: 0, style: {}, getContext: () => ctx };
    changeDrawing(canvas, { rect: { width: 100, height: 50 }, dpr: 2 });
    expect(canvas.width).toBe(200);
    expect(canvas.height).toBe(100);
    expect(canvas.style.width).toBe('100px');
    expect(canvas.style.height).toBe('50px');
    expect(ops[0]).toEqual([2, 0, 0, 2, 0, 0]);
  });
});

describe('InkCanvas', () => {
  class FakeCtx {
    constructor() {
      this.ops = [];
      this.clears = [];
      this.fills = 0;
    }
    clearRect(x, y, w, h) {
      this.ops.push('clear');
      this.clears.push([x, y, w, h]);
    }
    setTransform() {
      this.ops.push('transform');
    }
    save() {}
    restore() {}
    fill() {
      this.ops.push('fill');
      this.fills += 1;
    }
    beginPath() {}
    closePath() {}
    moveTo() {}
    lineTo() {}
  }

  function fakeCanvas() {
    const ctx = new FakeCtx();
    return { width: 0, height: 0, style: {}, getContext: () => ctx, __ctx: ctx };
  }

  it('changeDrawing sizes all attached canvases', () => {
    const drawing = fakeCanvas();
    const subtree = fakeCanvas();
    const interactive = fakeCanvas();
    const ink = new InkCanvas();
    ink.attach(drawing, subtree, interactive);
    ink.changeDrawing({ rect: { width: 100, height: 100 }, dpr: 2 });
    expect(drawing.width).toBe(200);
    expect(subtree.width).toBe(200);
    expect(interactive.width).toBe(200);
    expect(drawing.__ctx.ops).toContain('transform');
  });

  it('bounds returns the drawing canvas rect', () => {
    const rect = { left: 5, top: 6, width: 100, height: 100, right: 105, bottom: 106 };
    const ink = new InkCanvas();
    ink.attach({ getBoundingClientRect: () => rect });
    expect(ink.bounds()).toBe(rect);
  });

  it('rounding returns the device-pixel snap factor (dpr)', () => {
    const ink = new InkCanvas();
    ink.changeDrawing({ rect: { width: 10, height: 10 }, dpr: 3 });
    expect(ink.rounding()).toBe(3);
  });

  it('contextOf returns the right ctx per layer, null otherwise', () => {
    const drawing = fakeCanvas();
    const subtree = fakeCanvas();
    const interactive = fakeCanvas();
    const ink = new InkCanvas();
    ink.attach(drawing, subtree, interactive);
    expect(ink.contextOf('drawing')).toBe(drawing.__ctx);
    expect(ink.contextOf('subtree')).toBe(subtree.__ctx);
    expect(ink.contextOf('interactive')).toBe(interactive.__ctx);
    expect(ink.contextOf('bogus')).toBeNull();
  });

  it('paintStrokes clears the rect, fills intersecting strokes only', () => {
    const drawing = fakeCanvas();
    const ink = new InkCanvas();
    ink.attach(drawing);
    ink.changeDrawing({ rect: { width: 200, height: 200 }, dpr: 1 });
    const strokes = [
      { id: 'a', tool: 'pen', color: '#000', size: 4, opacity: 1, points: [[10, 10, 0.5], [20, 10, 0.5]] },
      { id: 'b', tool: 'pen', color: '#000', size: 4, opacity: 1, points: [[150, 150, 0.5], [160, 150, 0.5]] },
    ];
    const bounds = strokes.map((s) => strokeBounds(s));
    ink.paintStrokes(strokes, bounds, { minX: 0, minY: 0, maxX: 50, maxY: 50 });
    // stroke 'a' intersects the rect, 'b' does not -> one fill
    expect(drawing.__ctx.fills).toBe(1);
    expect(drawing.__ctx.clears).toEqual([[0, 0, 50, 50]]);

    drawing.__ctx.ops.length = 0;
    drawing.__ctx.clears.length = 0;
    drawing.__ctx.fills = 0;
    ink.paintStrokes(strokes, bounds, { minX: 0, minY: 0, maxX: 200, maxY: 200 });
    // full-rect pass: both strokes fill
    expect(drawing.__ctx.fills).toBe(2);
  });

  it('paintStrokes clears through the device-pixel snap factor', () => {
    const drawing = fakeCanvas();
    const ink = new InkCanvas();
    ink.attach(drawing);
    ink.changeDrawing({ rect: { width: 100, height: 100 }, dpr: 2 });
    ink.paintStrokes([], [], { minX: 0, minY: 0, maxX: 100, maxY: 100 });
    expect(drawing.__ctx.clears).toEqual([[0, 0, 100, 100]]);
  });

  it('paintLive clears the interactive canvas and paints the stroke', () => {
    const interactive = fakeCanvas();
    const ink = new InkCanvas();
    ink.attach(null, null, interactive);
    ink.changeDrawing({ rect: { width: 100, height: 50 }, dpr: 2 });
    ink.paintLive({ id: 'live', tool: 'pen', color: '#000', size: 4, opacity: 1, points: [[0, 0, 0.5], [10, 10, 0.5]] });
    expect(interactive.__ctx.clears).toEqual([[0, 0, 100, 50]]);
    expect(interactive.__ctx.ops).toContain('fill');
  });

  it('clearing with no strokes still emits the clear pass', () => {
    const drawing = fakeCanvas();
    const ink = new InkCanvas();
    ink.attach(drawing);
    ink.changeDrawing({ rect: { width: 10, height: 10 }, dpr: 1 });
    ink.paintStrokes([], [], { minX: 0, minY: 0, maxX: 10, maxY: 10 });
    expect(drawing.__ctx.clears).toEqual([[0, 0, 10, 10]]);
    expect(drawing.__ctx.fills).toBe(0);
  });
});
