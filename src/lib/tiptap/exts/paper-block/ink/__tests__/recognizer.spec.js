import { describe, expect, it } from 'vitest';
import { recognizeShape, shouldSnapshot } from '../recognizer.js';

// Deterministic rasterizers (no Math.random — tests must be stable).

const circlePts = (r = 50, noise = 0.08, sweep = 2 * Math.PI, cx = 100, cy = 100) =>
  Array.from({ length: 72 }, (_, i) => {
    const a = (i / 72) * sweep;
    const rr = r * (1 + noise * Math.sin(i * 2.7));
    return [cx + rr * Math.cos(a), cy + rr * Math.sin(a), 0.5];
  });

const boxPts = () => [
  [10, 10], [40, 11], [70, 10], [71, 40], [70, 70], [40, 69], [11, 70], [10, 40], [10, 10],
].map(([x, y]) => [x, y, 0.5]);

const linePts = () =>
  Array.from({ length: 30 }, (_, i) => [i * 5, 50 + 2 * Math.sin(i), 0.5]);

const trianglePts = () => [
  [50, 10], [55, 40], [90, 80], [60, 75], [30, 78], [35, 45], [50, 10],
].map(([x, y]) => [x, y, 0.5]);

const arrowPts = () => [
  [0, 0], [20, 1], [40, -1], [60, 0], [80, 1], [95, 0], // shaft
  [88, -12], [100, 8], // jab
].map(([x, y]) => [x, y, 0.5]);

const scribblePts = () => [
  [10, 50], [25, 10], [30, 60], [45, 15], [50, 70], [65, 20], [70, 65], [85, 25], [90, 55], [95, 40],
].map(([x, y]) => [x, y, 0.5]);

describe('recognizeShape', () => {
  it('reads a noisy rasterized circle as a circle, snapped around its center', () => {
    const hit = recognizeShape(circlePts());
    expect(hit?.shape).toBe('circle');
    const [cx, cy] = hit.snapped[0];
    expect(Math.abs(cx - 100)).toBeLessThan(10);
    expect(Math.abs(cy - 100)).toBeLessThan(10);
  });

  it('reads a box as a rect', () => {
    expect(recognizeShape(boxPts())?.shape).toBe('rect');
  });

  it('reads a near-straight wander as a line snapped to its endpoints', () => {
    const hit = recognizeShape(linePts());
    expect(hit?.shape).toBe('line');
    expect(hit.snapped[0][0]).toBeLessThanOrEqual(hit.snapped[1][0]);
  });

  it('reads a triangle as a triangle', () => {
    expect(recognizeShape(trianglePts())?.shape).toBe('triangle');
  });

  it('reads a shaft plus endpoint jab as an arrow', () => {
    expect(recognizeShape(arrowPts())?.shape).toBe('arrow');
  });

  it('rejects a letter-like scribble', () => {
    expect(recognizeShape(scribblePts())).toBe(null);
  });

  it('rejects arcs that do not revolve fully (no accidental circles)', () => {
    expect(recognizeShape(circlePts(50, 0.02, (270 / 360) * 2 * Math.PI))).toBe(null);
  });

  it('returns null for tiny or degenerate input', () => {
    expect(recognizeShape([])).toBe(null);
    expect(recognizeShape([[1, 2, 0.5]])).toBe(null);
  });
});

describe('shouldSnapshot (hold-to-shape)', () => {
  const pts = linePts();
  const events = (pairs) => pairs.map(([t, x, y]) => ({ timeStamp: t, clientX: x, clientY: y }));

  it('fires after ~500ms with <2px travel since the last movement', () => {
    const evs = events([[1000, 0, 0], [1100, 50, 50], [1150, 50.5, 50.5], [1700, 50.6, 50.6]]);
    expect(shouldSnapshot(pts, evs)).toBe(true);
  });

  it('does not fire before the hold elapses', () => {
    const evs = events([[1000, 0, 0], [1100, 50, 50], [1150, 50.5, 50.5], [1400, 50.6, 50.6]]);
    expect(shouldSnapshot(pts, evs)).toBe(false);
  });

  it('does not fire while the pen keeps moving', () => {
    const evs = events([[1000, 0, 0], [1100, 50, 50], [1150, 50.5, 50.5], [1700, 80, 80]]);
    expect(shouldSnapshot(pts, evs)).toBe(false);
  });
});
