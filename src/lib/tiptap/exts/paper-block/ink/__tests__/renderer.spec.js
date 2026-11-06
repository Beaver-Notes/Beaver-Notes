import { describe, expect, it } from 'vitest';
import { InkRenderer, boundsIntersect, computeDirtyRect } from '../renderer.js';
import { strokeBounds as strokeBoundsOf } from '../stroke-model.js';

const b = (minX, minY, maxX, maxY) => ({ minX, minY, maxX, maxY });

describe('boundsIntersect', () => {
  it('detects overlap and disjoint rects (edge-touch counts)', () => {
    expect(boundsIntersect(b(0, 0, 10, 10), b(5, 5, 20, 20))).toBe(true);
    expect(boundsIntersect(b(0, 0, 10, 10), b(10, 0, 20, 10))).toBe(true);
    expect(boundsIntersect(b(0, 0, 10, 10), b(11, 11, 20, 20))).toBe(false);
  });
});

describe('computeDirtyRect', () => {
  it('unions two rects and passes through a lone rect', () => {
    expect(computeDirtyRect(b(0, 0, 10, 10), b(20, 20, 30, 30))).toEqual(
      b(0, 0, 30, 30)
    );
    expect(computeDirtyRect(null, b(2, 3, 4, 5))).toEqual(b(2, 3, 4, 5));
    expect(computeDirtyRect(b(2, 3, 4, 5), null)).toEqual(b(2, 3, 4, 5));
  });

  it('absorbs a shrunken next rect (union never shrinks)', () => {
    expect(computeDirtyRect(b(0, 0, 10, 10), b(1, 1, 5, 5))).toEqual(
      b(0, 0, 10, 10)
    );
  });
});

const hStroke = (id) => ({
  id,
  tool: 'pen',
  color: '#000',
  size: 4,
  opacity: 1,
  points: [
    [0, 50, 0.5],
    [100, 50, 0.5],
  ],
});
const vStroke = (id) => ({
  id,
  tool: 'pen',
  color: '#000',
  size: 4,
  opacity: 1,
  points: [
    [50, 0, 0.5],
    [50, 100, 0.5],
  ],
});

describe('pick', () => {
  it('returns the topmost stroke within radius of a point', () => {
    const r = new InkRenderer();
    r.setStrokes([hStroke('h'), vStroke('v')]);
    expect(r.pick(50, 50, 2)?.id).toBe('v');
    expect(r.pick(10, 50, 2)?.id).toBe('h');
    expect(r.pick(90, 90, 2)).toBeNull();
  });
  it('honors stroke width in the hit radius', () => {
    const wide = { ...hStroke('w'), size: 16 };
    const r = new InkRenderer();
    r.setStrokes([wide]);
    expect(r.pick(50, 57, 0)).not.toBeNull();
    expect(r.pick(50, 70, 0)).toBeNull();
  });
});

describe('eraseAt', () => {
  it('splits a crossing stroke into retained halves, order preserved', () => {
    const stroke = {
      id: 'a',
      tool: 'pen',
      color: '#000',
      size: 4,
      opacity: 1,
      points: [
        [0, 0, 0.5],
        [10, 0, 0.5],
        [20, 0, 0.5],
        [30, 0, 0.5],
        [40, 0, 0.5],
        [50, 0, 0.5],
        [60, 0, 0.5],
      ],
    };
    const r = new InkRenderer();
    r.setStrokes([stroke]);

    const { splitStrokes, removedIds } = r.eraseAt(30, 0, 2);
    expect(removedIds).toEqual([]);
    expect(splitStrokes.length).toBe(2);
    const [left, right] = splitStrokes;
    expect(left.id).toBe('a_s0');
    expect(right.id).toBe('a_s1');
    expect(left.points.map((p) => p[0])).toEqual([0, 10, 20]);
    expect(right.points.map((p) => p[0])).toEqual([40, 50, 60]);
    // original untouched (immutability)
    expect(stroke.points.length).toBe(7);
  });

  it('removes a stroke fully inside the eraser radius', () => {
    const tiny = {
      id: 't',
      tool: 'pen',
      color: '#000',
      size: 4,
      opacity: 1,
      points: [
        [0, 0, 0.5],
        [2, 0, 0.5],
      ],
    };
    const r = new InkRenderer();
    r.setStrokes([tiny]);
    const { splitStrokes, removedIds } = r.eraseAt(1, 0, 10);
    expect(splitStrokes.some((s) => s.id === 't')).toBe(false);
    expect(removedIds).toEqual(['t']);
  });

  it('leaves strokes outside the radius untouched', () => {
    const stroke = hStroke('far');
    const r = new InkRenderer();
    r.setStrokes([stroke]);
    const { splitStrokes, removedIds } = r.eraseAt(500, 500, 10);
    expect(removedIds).toEqual([]);
    expect(splitStrokes[0].id).toBe('far');
  });

  it('cuts sparse strokes by segment proximity, not point hits only', () => {
    // 2-point line (0,50)-(100,50); eraser over the middle of the segment
    const stroke = hStroke('h');
    const r = new InkRenderer();
    r.setStrokes([stroke]);
    const { splitStrokes, removedIds } = r.eraseAt(50, 53, 2);
    expect(removedIds).toEqual([]);
    expect(splitStrokes.length).toBe(2);
    expect(splitStrokes.map((s) => s.id)).toEqual(['h_s0', 'h_s1']);
    expect(splitStrokes[0].points.at(-1)[0]).toBeCloseTo(50, 5);
    expect(splitStrokes[1].points[0][0]).toBeCloseTo(50, 5);
  });
});

describe('renderer tracking', () => {
  class FakeCtx {
    constructor() {
      this.ops = [];
    }
    clearRect() {
      this.ops.push('clear');
    }
    setTransform() {
      this.ops.push('transform');
    }
    save() {}
    restore() {}
    fill() {
      this.ops.push('fill');
    }
    stroke() {
      this.ops.push('stroke');
    }
    beginPath() {}
    closePath() {}
    moveTo() {}
    lineTo() {}
    set fillStyle(v) {
      this._f = v;
    }
    get fillStyle() {
      return this._f;
    }
    set strokeStyle(v) {
      this._s = v;
    }
    get strokeStyle() {
      return this._s;
    }
    set lineWidth(v) {
      this._w = v;
    }
    get lineWidth() {
      return this._w;
    }
    set globalAlpha(v) {
      this._a = v;
    }
    get globalAlpha() {
      return this._a;
    }
    set lineCap(v) {
      this._c = v;
    }
    get lineCap() {
      return this._c;
    }
    set lineJoin(v) {
      this._j = v;
    }
    get lineJoin() {
      return this._j;
    }
  }

  function fakeCanvas() {
    const ctx = new FakeCtx();
    return {
      width: 0,
      height: 0,
      style: {},
      getContext: () => ctx,
      __ctx: ctx,
    };
  }

  it('flushes committed strokes with dirty-rect culling', () => {
    const logic = fakeCanvas();
    const live = fakeCanvas();
    const r = new InkRenderer();
    r.attach(logic, live, { dpr: 2, width: 100, height: 100 });
    r.setStrokes([hStroke('h'), vStroke('v')]);
    r.flush();
    // two fills: one per committed stroke (no Path2D in happy-dom -> fill path)
    expect(logic.__ctx.ops.filter((o) => o === 'fill').length).toBe(2);
    // second flush with no dirt is a no-op
    logic.__ctx.ops.length = 0;
    r.flush();
    expect(logic.__ctx.ops.filter((o) => o === 'fill').length).toBe(0);
  });

  it('dirty-rect cull skips strokes outside the damaged region', () => {
    const logic = fakeCanvas();
    const live = fakeCanvas();
    const r = new InkRenderer();
    r.attach(logic, live, { dpr: 1, width: 400, height: 400 });
    const far = {
      id: 'far',
      tool: 'pen',
      color: '#000',
      size: 4,
      opacity: 1,
      points: [
        [200, 200, 0.5],
        [300, 300, 0.5],
      ],
    };
    r.setStrokes([hStroke('h'), far]);
    r.flush(); // warm the cache: setStrokes marks everything dirty
    logic.__ctx.ops.length = 0;
    r.setDirty(strokeBoundsOf(hStroke('h')));
    r.flush();
    // only the horizontal stroke intersects the damaged rect
    expect(logic.__ctx.ops.filter((o) => o === 'fill').length).toBe(1);
  });

  it('live stroke paints on the live canvas only', () => {
    const logic = fakeCanvas();
    const live = fakeCanvas();
    const r = new InkRenderer();
    r.attach(logic, live, { dpr: 1, width: 100, height: 100 });
    r.setStrokes([]);
    r.flush();
    logic.__ctx.ops.length = 0;
    live.__ctx.ops.length = 0;
    r.paintStrokeLive('live', hStroke('live'));
    expect(live.__ctx.ops.filter((o) => o === 'fill').length).toBe(1);
    expect(logic.__ctx.ops.filter((o) => o === 'fill').length).toBe(0);
  });

  it('resize re-scales canvases by dpr and repaints everything', () => {
    const logic = fakeCanvas();
    const live = fakeCanvas();
    const r = new InkRenderer();
    r.attach(logic, live, { dpr: 1, width: 100, height: 100 });
    r.setStrokes([hStroke('h')]);
    r.flush();
    r.resize(200, 120, 2);
    expect(logic.width).toBe(400);
    expect(logic.height).toBe(240);
    expect(r.dpr).toBe(2);
    logic.__ctx.ops.length = 0;
    r.flush();
    expect(logic.__ctx.ops.filter((o) => o === 'fill').length).toBe(1);
  });
});
