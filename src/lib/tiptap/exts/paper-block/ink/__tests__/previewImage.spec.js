import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { getStroke, cleanBitmap, PreviewImage, parsePreviewImage } from '../previewImage.js';

function makeCtx() {
  const calls = [];
  const ctx = {
    calls,
    globalAlpha: 1,
    fillStyle: '',
    clearRect: (...a) => calls.push(['clearRect', ...a]),
    beginPath: () => calls.push(['beginPath']),
    moveTo: (...a) => calls.push(['moveTo', ...a]),
    lineTo: (...a) => calls.push(['lineTo', ...a]),
    closePath: () => calls.push(['closePath']),
    fill: () => calls.push(['fill']),
    fillRect: (...a) => calls.push(['fillRect', ...a]),
    setTransform: (...a) => calls.push(['setTransform', ...a]),
    scale: (...a) => calls.push(['scale', ...a]),
  };
  return ctx;
}

function makeCanvas(ctx) {
  return { width: 0, height: 0, style: {}, getContext: () => ctx };
}

const pen = {
  id: 's1',
  tool: 'pen',
  color: '#000000',
  size: 4,
  opacity: 1,
  points: [[10, 20], [30, 40], [50, 30]],
};

const marker = {
  id: 's2',
  tool: 'marker',
  color: '#ff0000',
  size: 16,
  opacity: 0.35,
  points: [[100, 100], [120, 110]],
};

describe('getStroke', () => {
  it('returns an outline strip polygon from strokeOutline', () => {
    const out = getStroke(pen, 4);
    expect(Array.isArray(out)).toBe(true);
    expect(out.length).toBeGreaterThan(0);
    for (const [x, y] of out) {
      expect(Array.isArray([x, y])).toBe(true);
      expect(Number.isFinite(x)).toBe(true);
      expect(Number.isFinite(y)).toBe(true);
    }
  });

  it('honors the size argument', () => {
    const small = getStroke(pen, 2);
    const large = getStroke(pen, 24);
    expect(small).not.toEqual(large);
  });

  it('returns an empty polygon for strokes with fewer than 2 points', () => {
    expect(getStroke({ ...pen, points: [] }, 4)).toEqual([]);
    expect(getStroke({ ...pen, points: [[5, 5, 0.5]] }, 4)).toEqual([]);
  });
});

describe('cleanBitmap', () => {
  it('clears the whole bitmap', () => {
    const ctx = makeCtx();
    cleanBitmap(ctx, 400, 300);
    expect(ctx.calls).toContainEqual(['clearRect', 0, 0, 400, 300]);
  });

  it('is a no-op for a missing ctx', () => {
    expect(() => cleanBitmap(null, 10, 10)).not.toThrow();
  });
});

describe('PreviewImage', () => {
  let ctx;
  let canvas;

  beforeEach(() => {
    ctx = makeCtx();
    canvas = makeCanvas(ctx);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('commits all strokes into the offscreen bitmap after clearing', () => {
    const img = new PreviewImage({ width: 400, height: 300, strokes: [pen, marker], canvas });
    img.commit();
    expect(ctx.calls).toContainEqual(['clearRect', 0, 0, 400, 300]);
    expect(ctx.calls.filter((c) => c[0] === 'fill')).toHaveLength(2);
  });

  it('is a no-op when there is no ctx', () => {
    const img = new PreviewImage({ width: 10, height: 10, strokes: [pen] });
    expect(() => img.commit()).not.toThrow();
  });

  it('cleanBitmap method clears the bitmap', () => {
    const img = new PreviewImage({ width: 50, height: 60, strokes: [pen], canvas });
    img.cleanBitmap();
    expect(ctx.calls).toContainEqual(['clearRect', 0, 0, 50, 60]);
  });

  it('drawTo replays strokes into a target ctx', () => {
    const target = makeCtx();
    const img = new PreviewImage({ width: 10, height: 10, strokes: [pen] });
    img.drawTo(target);
    expect(target.calls.filter((c) => c[0] === 'fill')).toHaveLength(1);
    expect(target.calls.filter((c) => c[0] === 'clearRect')).toHaveLength(0);
  });
});

describe('PreviewImage fade', () => {
  let ctx;
  let canvas;

  beforeEach(() => {
    ctx = makeCtx();
    canvas = makeCanvas(ctx);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.runAllTimers();
    vi.useRealTimers();
  });

  it('draws the wet band then cleans it after the duration, leaving no timer', () => {
    const img = new PreviewImage({ width: 100, height: 100, strokes: [pen], canvas });
    img.fade(marker, { duration: 120 });
    expect(ctx.calls.filter((c) => c[0] === 'fill')).toHaveLength(1);
    expect(img._timer).not.toBeNull();
    vi.runAllTimers();
    expect(ctx.calls).toContainEqual(['clearRect', 0, 0, 100, 100]);
    expect(img._timer).toBeNull();
  });

  it('stopFade cancels a pending timer', () => {
    const img = new PreviewImage({ width: 10, height: 10, strokes: [], canvas });
    img.fade(marker, { duration: 120 });
    expect(img._timer).not.toBeNull();
    img.stopFade();
    expect(img._timer).toBeNull();
  });
});

describe('parsePreviewImage', () => {
  it('rebuilds a PreviewImage from a serialized JSON string', () => {
    const data = JSON.stringify({ width: 400, height: 300, strokes: [pen] });
    const img = parsePreviewImage(data);
    expect(img).toBeInstanceOf(PreviewImage);
    expect(img.width).toBe(400);
    expect(img.height).toBe(300);
    expect(img.strokes).toHaveLength(1);
    expect(img.strokes[0].id).toBe('s1');
  });

  it('accepts a plain object', () => {
    const img = parsePreviewImage({ width: 10, height: 20, strokes: [marker] });
    expect(img).toBeInstanceOf(PreviewImage);
    expect(img.strokes[0].tool).toBe('marker');
  });

  it('never throws on malformed data', () => {
    expect(parsePreviewImage(null)).toBeNull();
    expect(parsePreviewImage(undefined)).toBeNull();
    expect(parsePreviewImage('')).toBeNull();
    expect(parsePreviewImage('not json')).toBeNull();
    expect(parsePreviewImage('{"broken"')).toBeNull();
    expect(parsePreviewImage(42)).toBeNull();
    expect(parsePreviewImage({})).toBeInstanceOf(PreviewImage);
    expect(parsePreviewImage({ strokes: 'not-an-array' })).toBeInstanceOf(PreviewImage);
  });
});
