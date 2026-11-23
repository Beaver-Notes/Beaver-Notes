import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import InkPreviewImage from '../../InkPreviewImage.vue';

const stroke = { id: 'a', tool: 'pen', color: '#000', size: 4, opacity: 1, points: [[0, 0, 0.5], [10, 10, 0.5]] };
function stubCtx() {
  const ctx = { globalAlpha: 1, fillStyle: '', setTransform: vi.fn(), clearRect: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), closePath: vi.fn(), fill: vi.fn() };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx);
  return ctx;
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('InkPreviewImage', () => {
  it('sizes backing store by DPR and paints strokes', () => {
    const ctx = stubCtx();
    vi.stubGlobal('devicePixelRatio', 2);
    const w = mount(InkPreviewImage, { props: { strokes: [stroke], width: 300, height: 200 } });
    const canvas = w.find('canvas').element;
    expect([canvas.width, canvas.height, canvas.style.width, ctx.setTransform]).toEqual([600, 400, '300px', expect.any(Function)]);
    expect(ctx.setTransform).toHaveBeenCalledWith(2, 0, 0, 2, 0, 0);
    expect(ctx.fill).toHaveBeenCalled();
  });

  it('falls back to 1x DPR', () => {
    const ctx = stubCtx();
    vi.stubGlobal('devicePixelRatio', undefined);
    const canvas = mount(InkPreviewImage, { props: { strokes: [stroke], width: 120, height: 80 } }).find('canvas').element;
    expect(canvas.width).toBe(120);
    expect(ctx.setTransform).toHaveBeenCalledWith(1, 0, 0, 1, 0, 0);
  });
});