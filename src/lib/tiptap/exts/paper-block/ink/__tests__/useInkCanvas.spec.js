import { describe, expect, it, vi } from 'vitest';
import { fitCanvas, setup } from '../useInkCanvas.js';

const fakeCanvas = () => ({ width: 0, height: 0, style: {}, getContext: () => ({ setTransform() {} }) });

describe('useInkCanvas', () => {
  it('fitCanvas sizes backing store by DPR', () => {
    const canvas = fakeCanvas();
    fitCanvas({ changeDrawing: ({ rect, dpr }) => { canvas.width = rect.width * dpr; canvas.height = rect.height * dpr; } }, { width: 100, height: 50 }, 2);
    expect([canvas.width, canvas.height]).toEqual([200, 100]);
  });

  it('setup fits on mount and ignores initial 0x0 RO fire', () => {
    const origRO = globalThis.ResizeObserver;
    globalThis.ResizeObserver = class { constructor(cb) { void cb; } observe() {} disconnect() {} };
    const ink = setup({ clientWidth: 0, clientHeight: 0, appendChild: vi.fn(), removeChild: vi.fn() }, fakeCanvas());
    expect(ink.width).toBe(0);
    fitCanvas(ink, { width: 300, height: 200 }, 1);
    expect(ink.width).toBe(300);
    ink.destroy();
    globalThis.ResizeObserver = origRO;
  });
});
