import { describe, expect, it } from 'vitest';
import { computeFoldLayout } from '@/lib/foldable/geometry';

const DUO_OPEN = { width: 951, height: 669 };
const DUO_CLOSED = { width: 466, height: 678 };

function verticalCrease(left, width = 5, viewport = DUO_OPEN) {
  return {
    foldable: true,
    posture: 'open',
    orientation: 'vertical',
    crease: { left, top: 0, width, height: viewport.height },
  };
}

describe('computeFoldLayout', () => {
  it('leaves an ordinary phone as one full-width segment', () => {
    const layout = computeFoldLayout({
      state: null,
      viewport: { width: 394, height: 852 },
    });

    expect(layout.source).toBe('none');
    expect(layout.orientation).toBe('none');
    expect(layout.crease).toBeNull();
    expect(layout.segments).toHaveLength(1);
    expect(layout.segmentWidth).toBe(394);
  });

  it('splits a native vertical crease into two side-by-side segments', () => {
    const layout = computeFoldLayout({
      state: verticalCrease(473),
      viewport: DUO_OPEN,
    });

    expect(layout.source).toBe('native');
    expect(layout.orientation).toBe('vertical');
    expect(layout.segmentWidth).toBe(473);
    expect(layout.segments.map((s) => s.width)).toEqual([473, 473]);
    expect(layout.segments[1].left).toBe(478);
  });

  it('stacks a horizontal crease instead of narrowing it', () => {
    const layout = computeFoldLayout({
      state: {
        foldable: true,
        posture: 'open',
        orientation: 'horizontal',
        crease: { left: 0, top: 470, width: 669, height: 5 },
      },
      viewport: { width: 669, height: 951 },
    });

    expect(layout.orientation).toBe('horizontal');
    expect(layout.segments.map((s) => s.height)).toEqual([470, 476]);
    expect(layout.segmentWidth).toBe(669);
  });

  it('clamps a crease reported past the right edge', () => {
    const layout = computeFoldLayout({
      state: verticalCrease(1200),
      viewport: DUO_OPEN,
    });

    for (const segment of layout.segments) {
      expect(segment.width).toBeGreaterThanOrEqual(0);
      expect(segment.left + segment.width).toBeLessThanOrEqual(DUO_OPEN.width);
    }
    expect(layout.segmentWidth).toBeGreaterThan(0);
  });

  it('clamps a crease wider than the viewport without going negative', () => {
    const layout = computeFoldLayout({
      state: verticalCrease(0, 4000),
      viewport: DUO_OPEN,
    });

    for (const segment of layout.segments) {
      expect(segment.width).toBeGreaterThanOrEqual(0);
    }
    expect(layout.segmentWidth).toBeGreaterThanOrEqual(0);
  });

  it('infers a centred crease when a foldable reports no crease', () => {
    const layout = computeFoldLayout({
      state: { foldable: true, posture: 'unknown', crease: null },
      viewport: DUO_OPEN,
    });

    expect(layout.source).toBe('inferred');
    expect(layout.orientation).toBe('vertical');
    expect(layout.crease.left).toBeCloseTo(475.5);
    expect(layout.crease.width).toBe(0);
    expect(layout.segments).toHaveLength(2);
  });

  it('keeps a flat device foldable so the rail survives closing', () => {
    const layout = computeFoldLayout({
      state: { ...verticalCrease(233), posture: 'flat' },
      viewport: DUO_CLOSED,
    });

    expect(layout.source).toBe('native');
    expect(layout.segmentWidth).toBe(233);
  });

  it('never yields a negative width for a zero-size viewport', () => {
    const layout = computeFoldLayout({
      state: verticalCrease(100, 5, { width: 0, height: 0 }),
      viewport: { width: 0, height: 0 },
    });

    for (const segment of layout.segments) {
      expect(segment.width).toBeGreaterThanOrEqual(0);
      expect(segment.height).toBeGreaterThanOrEqual(0);
    }
  });
});
