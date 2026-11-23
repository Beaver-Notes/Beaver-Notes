import { describe, expect, it } from 'vitest';
import { pointInPolygon } from '../geometry.js';

const square = [[0, 0], [10, 0], [10, 10], [0, 10]];
const dart = [[0, 0], [10, 5], [0, 10], [3, 5]]; // concave notch at mid-left

describe('pointInPolygon', () => {
  it('handles inside, outside, concave notch, and degenerate input', () => {
    expect(pointInPolygon(5, 5, square)).toBe(true);
    expect(pointInPolygon(-1, 5, square)).toBe(false);
    expect(pointInPolygon(5, 5, dart)).toBe(true);
    expect(pointInPolygon(1, 5, dart)).toBe(false);
    expect(pointInPolygon(0, 0, [])).toBe(false);
    expect(pointInPolygon(0, 0, null)).toBe(false);
  });
});