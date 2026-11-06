import { describe, expect, it } from 'vitest';
import {
  STROKE_TOOLS,
  TOOL_DEFAULTS,
  migrateStrokes,
  parseStrokes,
  serializeStrokes,
  strokeBounds,
} from '../stroke-model.js';

const v3Stroke = {
  id: 's1',
  tool: 'pen',
  color: '#1a1a1a',
  size: 4,
  opacity: 1,
  points: [
    [10, 20, 0.5],
    [30, 40, 0.8],
  ],
};

describe('v3 stroke model', () => {
  it('preserves the page field for pdf markup strokes', () => {
    const paged = { ...v3Stroke, page: 2 };
    expect(parseStrokes(serializeStrokes([paged]))).toEqual([paged]);
  });

  it('round-trips serialize → parse losslessly', () => {
    const json = serializeStrokes([v3Stroke]);
    expect(parseStrokes(json)).toEqual([v3Stroke]);
  });

  it('keeps the shape flag through a round-trip', () => {
    const shaped = { ...v3Stroke, shape: 'ellipse' };
    expect(parseStrokes(serializeStrokes([shaped]))).toEqual([shaped]);
  });

  it('accepts v2 payloads unchanged', () => {
    const v2 = [
      {
        id: 'a',
        tool: 'pen',
        color: '#000000',
        size: 4,
        opacity: 1,
        points: [
          [1, 2, 0.5],
          [3, 4, 0.5],
        ],
      },
    ];
    expect(migrateStrokes(v2)).toEqual(v2);
  });

  it('migrates v1 line objects with 2-point entries, defaults applied', () => {
    const v1 = [{ id: 'x', points: [[5, 6]] }];
    expect(migrateStrokes(v1)).toEqual([
      {
        id: 'x',
        tool: 'pen',
        color: '#000000',
        size: 4,
        opacity: 1,
        points: [[5, 6, 0.5]],
      },
    ]);
  });

  it('migrates missing ids in order and keeps legacy pressure', () => {
    const v1 = [
      { points: [[0, 0], [10, 10, 0.25]] },
      { points: [[1, 1]] },
    ];
    const out = migrateStrokes(v1);
    expect(out.map((s) => s.id)).toEqual(['migrated-0', 'migrated-1']);
    expect(out[0].points).toEqual([
      [0, 0, 0.5],
      [10, 10, 0.25],
    ]);
  });

  it('maps legacy highlighter tool to marker with its default opacity', () => {
    const legacy = [{ id: 'h', tool: 'highlighter', color: '#fbbf24', size: 16, points: [[0, 0, 0.5]] }];
    expect(migrateStrokes(legacy)[0].tool).toBe('marker');
    expect(migrateStrokes([{ points: [[0, 0]] }])[0].tool).toBe('pen');
    expect(
      migrateStrokes([{ tool: 'highlighter', points: [[0, 0]] }])[0].opacity,
    ).toBe(0.35);
  });

  it('returns [] for malformed JSON and empty strings', () => {
    expect(parseStrokes('{oops')).toEqual([]);
    expect(parseStrokes('')).toEqual([]);
    expect(parseStrokes(null)).toEqual([]);
  });

  it('parses an already-array payload (attr reuse)', () => {
    expect(parseStrokes([v3Stroke])).toEqual([v3Stroke]);
  });

  it('computes bounds from point extremes', () => {
    expect(strokeBounds(v3Stroke)).toEqual({
      minX: 10,
      minY: 20,
      maxX: 30,
      maxY: 40,
    });
  });

  it('exposes the tool set and defaults carried over from the old build', () => {
    expect(STROKE_TOOLS).toEqual(['pen', 'pencil', 'fountain', 'marker', 'eraser', 'lasso']);
    expect(TOOL_DEFAULTS.pen).toEqual({ color: '#1a1a1a', size: 4, opacity: 1 });
    expect(TOOL_DEFAULTS.pencil).toEqual({ color: '#4a4a4a', size: 3 });
    expect(TOOL_DEFAULTS.fountain).toEqual({ color: '#1a2744', size: 5 });
    expect(TOOL_DEFAULTS.marker).toEqual({ color: '#fbbf24', size: 16, opacity: 0.35 });
    expect(TOOL_DEFAULTS.eraser).toEqual({ size: 20 });
  });
});
