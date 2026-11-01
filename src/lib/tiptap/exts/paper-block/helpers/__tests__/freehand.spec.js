import { describe, expect, it } from 'vitest';
import { getFreehandOptions } from '../freehand.js';

describe('freehand tool options', () => {
  it('keeps pen width uniform without pressure or taper', () => {
    const options = getFreehandOptions('pen', 4);

    expect(options.simulatePressure).toBe(false);
    expect(options.thinning).toBe(0);
    expect(options.start).toEqual({ cap: true, taper: 0 });
    expect(options.end).toEqual({ cap: true, taper: 0 });
  });

  it('keeps fountain pen speed variation', () => {
    const options = getFreehandOptions('fountain', 5);

    expect(options.simulatePressure).toBe(true);
    expect(options.thinning).toBeGreaterThan(0);
    expect(options.easing(0.8)).toBeGreaterThan(options.easing(0.2));
  });
});
