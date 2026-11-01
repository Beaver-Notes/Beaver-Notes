import { describe, expect, it } from 'vitest';
import useSelectionHelper from '../selectionHelper.js';

describe('lasso selection', () => {
  it('keeps the selected strokes available to highlight while drawing a new loop', () => {
    const line = { id: 'stroke-1', points: [[1, 1, 0.5], [2, 2, 0.5]] };
    const selectedElement = { type: 'group', lines: [line], lineIds: ['stroke-1'], bounds: { x: 0, y: 0, width: 10, height: 10 } };
    const state = { tool: 'lasso', selectedElement, isDrawing: false, lassoPoints: null, selectionBox: null, lines: [] };
    const { handleSelectionStart } = useSelectionHelper(state, { value: null }, () => false, () => {});

    handleSelectionStart({ pointerType: 'mouse', clientX: 20, clientY: 20 });

    expect(state.selectedElement).toBe(selectedElement);
    expect(state.lassoPoints).toEqual([[20, 20]]);
    expect(state.selectedElement.lines).toContain(line);
  });

  it('clears the old selection after a completed loop that hits no strokes', () => {
    const state = {
      tool: 'lasso',
      selectedElement: { type: 'group', lines: [], lineIds: [], bounds: { x: 0, y: 0, width: 10, height: 10 } },
      isDrawing: true,
      lassoPoints: [[20, 20], [30, 20], [30, 30]],
      selectionBox: null,
      lines: [],
    };
    const { handleSelectionEnd } = useSelectionHelper(state, { value: null }, () => false, () => {});

    handleSelectionEnd();

    expect(state.selectedElement).toBe(null);
    expect(state.lassoPoints).toBe(null);
  });
});
