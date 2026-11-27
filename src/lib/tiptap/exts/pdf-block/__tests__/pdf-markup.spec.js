import { describe, expect, it } from 'vitest';
import {
  railLayout,
  strokesToRail,
  railStrokeToStored,
  pageStrokes,
  offsetStrokes,
} from '../pdfMarkup.js';

const PAGES = [
  { width: 612, height: 792 },
  { width: 612, height: 792 },
];

const stroke = (id, points, extra = {}) => ({
  id,
  tool: 'pen',
  color: '#1a1a1a',
  size: 4,
  opacity: 1,
  points,
  ...extra,
});

describe('railLayout', () => {
  it('lays pages side by side scaled to the rail height', () => {
    const layout = railLayout(PAGES, 160);
    expect(layout).toHaveLength(2);
    expect(layout[0]).toEqual({
      page: 0,
      x: 0,
      width: 612 * (160 / 792),
      height: 160,
      scale: 160 / 792,
    });
    expect(layout[1].x).toBe(layout[0].width + 8);
  });
});

describe('strokesToRail / railStrokeToStored', () => {
  it('round-trips a stroke on page 0 losslessly', () => {
    const layout = railLayout(PAGES, 160);
    const stored = stroke('s1', [
      [10, 20, 0.5],
      [100, 60, 0.7],
    ]);
    const rail = strokesToRail([stored], layout);
    expect(rail[0].id).toBe('s1');
    // widths scale with the geometry so ink keeps its proportion across zooms
    expect(rail[0].size).toBeCloseTo(4 * layout[0].scale, 5);
    const back = railStrokeToStored(rail[0], layout);
    expect(back).toHaveLength(1);
    expect(back[0].id).toBe('s1');
    expect(back[0].page).toBe(0);
    expect(back[0].size).toBeCloseTo(4, 5);
    expect(back[0].points[0][0]).toBeCloseTo(10, 5);
    expect(back[0].points[1][1]).toBeCloseTo(60, 5);
  });

  it('splits a rail stroke crossing a page boundary into two stored strokes', () => {
    const layout = railLayout(PAGES, 160);
    const w = layout[0].width;
    const railStroke = stroke('s2', [
      [w - 5, 20, 0.5],
      [w + 5, 30, 0.6],
      [w + 25, 40, 0.7],
    ]);
    const stored = railStrokeToStored(railStroke, layout);
    expect(stored).toHaveLength(2);
    expect(stored[0].id).toBe('s2_p0');
    expect(stored[0].page).toBe(0);
    expect(stored[1].id).toBe('s2_p1');
    expect(stored[1].page).toBe(1);
    expect(stored[0].points.at(-1)[0]).toBeCloseTo(612, 5);
    expect(stored[1].points[0][0]).toBeCloseTo(0, 5);
  });

  it('drops shape flags when a stroke is split', () => {
    const layout = railLayout(PAGES, 160);
    const w = layout[0].width;
    const railStroke = stroke('s3', [
      [w - 5, 20, 0.5],
      [w + 5, 30, 0.6],
    ], { shape: 'line' });
    const [left, right] = railStrokeToStored(railStroke, layout);
    expect(left.shape).toBeUndefined();
    expect(right.shape).toBeUndefined();
  });

  it('keeps ink beyond the last page as margin spill on that page', () => {
    const layout = railLayout(PAGES, 160);
    const railStroke = stroke('s4', [
      [layout[1].x + 600, 20, 0.5],
      [layout[1].x + 700, 30, 0.6],
    ]);
    const [only] = railStrokeToStored(railStroke, layout);
    expect(only.page).toBe(1);
    expect(only.points[1][0]).toBeGreaterThan(612);
  });

  it('drops runs with fewer than two points', () => {
    const layout = railLayout(PAGES, 160);
    const w = layout[0].width;
    const railStroke = stroke('s5', [
      [w - 5, 20, 0.5],
      [w + 1, 30, 0.6],
    ]);
    const stored = railStrokeToStored(railStroke, layout);
    expect(stored).toHaveLength(1);
    expect(stored[0].points).toHaveLength(2);
  });
});

describe('pageStrokes', () => {
  it('filters strokes by their page field, defaulting to page 0', () => {
    const strokes = [
      stroke('a', [[0, 0, 0.5]]),
      stroke('b', [[0, 0, 0.5]], { page: 1 }),
      stroke('c', [[0, 0, 0.5]], { page: 2 }),
    ];
    expect(pageStrokes(strokes, 0).map((s) => s.id)).toEqual(['a']);
    expect(pageStrokes(strokes, 1).map((s) => s.id)).toEqual(['b']);
  });
});

describe('offsetStrokes', () => {
  it('shifts stroke x coords by the viewport offset', () => {
    const shifted = offsetStrokes([stroke('a', [[10, 20, 0.5]])], 40);
    expect(shifted[0].points[0]).toEqual([50, 20, 0.5]);
  });
});
