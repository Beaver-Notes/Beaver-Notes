import { describe, expect, it } from 'vitest';
import { applyFoldLayout } from '@/lib/foldable/apply';

const SPLIT = {
  source: 'native',
  orientation: 'vertical',
  crease: { left: 473, top: 0, width: 5, height: 669 },
  segments: [],
  segmentWidth: 473,
};

describe('applyFoldLayout', () => {
  it('publishes the crease and marks the document foldable', () => {
    const root = document.createElement('html');
    applyFoldLayout(SPLIT, root);

    expect(root.classList.contains('runtime-foldable')).toBe(true);
    expect(root.style.getPropertyValue('--fold-segment-width')).toBe('473px');
    expect(root.style.getPropertyValue('--fold-crease-left')).toBe('473px');
    expect(root.style.getPropertyValue('--fold-crease-width')).toBe('5px');
    expect(root.style.getPropertyValue('--fold-orientation')).toBe('vertical');
  });

  it('clears the foldable class on a device that is not a foldable', () => {
    const root = document.createElement('html');
    applyFoldLayout(SPLIT, root);
    applyFoldLayout(
      { source: 'none', orientation: 'none', crease: null, segments: [], segmentWidth: 394 },
      root,
    );

    expect(root.classList.contains('runtime-foldable')).toBe(false);
    expect(root.style.getPropertyValue('--fold-crease-width')).toBe('0px');
  });
});
