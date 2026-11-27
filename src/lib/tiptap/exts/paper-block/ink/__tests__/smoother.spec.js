import { describe, expect, it } from 'vitest';
import { pathBounds, strokeOutline, strokePath } from '../smoother.js';

const stroke = (over = {}) => ({
  id: 's',
  tool: 'pen',
  color: '#000000',
  size: 4,
  opacity: 1,
  points: Array.from({ length: 10 }, (_, i) => [i * 10, i * 5, 0.5 + 0.1 * (i % 3)]),
  ...over,
});

describe('strokeOutline', () => {
  it('produces a nonempty finite outline for a multi-point stroke', () => {
    const outline = strokeOutline(stroke());
    expect(outline.length).toBeGreaterThan(8);
    for (const [x, y] of outline) {
      expect(Number.isFinite(x)).toBe(true);
      expect(Number.isFinite(y)).toBe(true);
    }
  });

  it('marker renders fatter than pen on identical points', () => {
    const marker = pathBounds({ points: strokeOutline(stroke({ tool: 'marker', size: 16 })) });
    const pen = pathBounds({ points: strokeOutline(stroke({ tool: 'pen', size: 8 })) });
    expect(marker.maxY - marker.minY).toBeGreaterThan(pen.maxY - pen.minY);
  });

  it('marker stops at the stroke endpoints instead of rounding past them', () => {
    const points = Array.from({ length: 24 }, (_, i) => [20 + i * 20, 50, 0.5]);
    const bounds = pathBounds({ points: strokeOutline(stroke({ tool: 'marker', size: 16, points })) });
    expect(bounds.minX).toBeGreaterThan(18);
    expect(bounds.maxX).toBeLessThan(482);
  });

  it('pen outline width is identical regardless of point pressure', () => {
    const low = stroke({ tool: 'pen', points: Array.from({ length: 10 }, (_, i) => [i * 10, i * 5, 0.1]) });
    const high = stroke({ tool: 'pen', points: Array.from({ length: 10 }, (_, i) => [i * 10, i * 5, 0.9]) });
    const a = strokeOutline(low);
    const b = strokeOutline(high);
    expect(a.length).toBe(b.length);
    for (let i = 0; i < a.length; i++) {
      expect(a[i][0]).toBe(b[i][0]);
      expect(a[i][1]).toBe(b[i][1]);
    }
  });

  it('returns an empty outline for empty and single-point strokes without throwing', () => {
    expect(strokeOutline(stroke({ points: [] }))).toEqual([]);
    expect(strokeOutline(stroke({ points: [[5, 5, 0.5]] }))).toEqual([]);
  });
});

describe('strokePath', () => {
  it('emits moveTo/lineTo commands into the provided Path2D-like target', () => {
    const calls = [];
    const stub = {
      moveTo(...a) { calls.push(['moveTo', ...a]); },
      lineTo(...a) { calls.push(['lineTo', ...a]); },
      closePath() { calls.push(['closePath']); },
    };
    class FakePath2D { moveTo(...a) { stub.moveTo(...a); } lineTo(...a) { stub.lineTo(...a); } closePath() { stub.closePath(); } }
    strokePath(stroke(), FakePath2D);
    expect(calls[0][0]).toBe('moveTo');
    expect(calls.some((c) => c[0] === 'lineTo')).toBe(true);
  });
});
