import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';

vi.mock('@/lib/native/scribble', () => ({
  setScribbleSuppressed: vi.fn(),
  clearScribbleSuppressed: vi.fn(),
}));

import { setScribbleSuppressed, clearScribbleSuppressed } from '@/lib/native/scribble';
import PaperSurface from '../PaperSurface.vue';
import { setPendingHandoff, takePendingHandoff } from '../double-tap-insert.js';

const baseProps = {
  strokes: [],
  focused: false,
  tool: 'pen',
  toolSettings: {},
  height: 100,
  paperType: 'transparent',
  nodeKey: 'n1',
};

const penEvent = (type, x, y, extra = {}) => [type, { pointerType: 'pen', clientX: x, clientY: y, button: 0, ...extra }];

async function drawStroke(wrapper, points, tool = 'pen') {
  await wrapper.setProps({ focused: true, tool });
  const root = wrapper.find('.paper-surface');
  await root.trigger(...penEvent('pointerdown', points[0][0], points[0][1]));
  for (const [x, y] of points.slice(1)) {
    await root.trigger(...penEvent('pointermove', x, y));
  }
  await root.trigger(...penEvent('pointerup', points.at(-1)[0], points.at(-1)[1]));
}

describe('PaperSurface chrome', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('unfocused + empty: no handles, no border, no toolbar, hint shown', () => {
    const w = mount(PaperSurface, { props: baseProps });
    expect(w.findAll('.surface-handle')).toHaveLength(0);
    expect(w.find('.surface-border').exists()).toBe(false);
    expect(w.find('.surface-toolbar').exists()).toBe(false);
    expect(w.find('.surface-hint').exists()).toBe(true);
  });

  it('focused: top + bottom handles only, border, toolbar slot, hint gone', async () => {
    const w = mount(PaperSurface, {
      props: { ...baseProps, focused: true },
      slots: { toolbar: '<div class="tb">tools</div>' },
    });
    const handles = w.findAll('.surface-handle');
    expect(handles).toHaveLength(2);
    expect(handles.map((h) => h.attributes('data-handle'))).toEqual(['top', 'bottom']);
    expect(w.find('.surface-resize-bar').exists()).toBe(false);
    expect(w.find('.surface-border').exists()).toBe(true);
    expect(w.find('.surface-toolbar').exists()).toBe(true);
    expect(w.find('.tb').exists()).toBe(true);
    expect(w.find('.surface-hint').exists()).toBe(false);
  });

  it('top handle grows upward, bottom handle grows downward', async () => {
    const w = mount(PaperSurface, { props: { ...baseProps, focused: true } });
    const top = w.find('.surface-handle[data-handle="top"]');
    await top.trigger('pointerdown', { clientY: 100, button: 0, pointerId: 1 });
    window.dispatchEvent(new PointerEvent('pointermove', { clientY: 80 }));
    await top.trigger('pointerup', { clientY: 80 });
    const bottom = w.find('.surface-handle[data-handle="bottom"]');
    await bottom.trigger('pointerdown', { clientY: 100, button: 0, pointerId: 2 });
    window.dispatchEvent(new PointerEvent('pointermove', { clientY: 130 }));
    await bottom.trigger('pointerup', { clientY: 130 });
    const heights = w.emitted('height-change').map((c) => c[0]);
    // happy-dom re-runs window listeners for composed events (T9 ruling), so
    // each move may emit twice; assert the directions, not position
    expect(heights).toContain(120);
    expect(heights.at(-1)).toBe(130);
  });

  it('swallows text selection: canvas pointerdown preventDefaults', () => {
    const w = mount(PaperSurface, { props: baseProps });
    const ev = new Event('pointerdown', { bubbles: true, cancelable: true });
    Object.defineProperty(ev, 'pointerType', { value: 'pen' });
    w.find('.paper-surface').element.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
  });

  it('focused with strokes: no hint', () => {
    const w = mount(PaperSurface, {
      props: {
        ...baseProps,
        focused: false,
        strokes: [{ id: 'a', tool: 'pen', color: '#000', size: 4, opacity: 1, points: [[0, 0, 0.5], [5, 5, 0.5]] }],
      },
    });
    expect(w.find('.surface-hint').exists()).toBe(false);
  });

  it('touch-action none on the surface root', () => {
    const w = mount(PaperSurface, { props: baseProps });
    expect(w.find('.paper-surface').attributes('style')).toContain('touch-action: none');
  });
});

describe('PaperSurface focus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('pen double pointerdown ≤300ms emits focus-request once', async () => {
    const w = mount(PaperSurface, { props: baseProps });
    const root = w.find('.paper-surface');
    await root.trigger(...penEvent('pointerdown', 10, 10));
    await root.trigger(...penEvent('pointerdown', 12, 12));
    await root.trigger('pointerup', { pointerType: 'pen', clientX: 12, clientY: 12 });
    expect(w.emitted('focus-request')).toHaveLength(1);
  });

  it('suppresses scribble while focused, clears on blur', async () => {
    const w = mount(PaperSurface, { props: baseProps });
    await w.setProps({ focused: true });
    expect(setScribbleSuppressed).toHaveBeenCalledWith('paper:n1', true);
    await w.setProps({ focused: false });
    expect(clearScribbleSuppressed).toHaveBeenCalledWith('paper:n1');
  });

  it('suppresses scribble on mount for statically-focused media surfaces', () => {
    mount(PaperSurface, { props: { ...baseProps, focused: true } });
    expect(setScribbleSuppressed).toHaveBeenCalledWith('paper:n1', true);
  });
});

describe('PaperSurface drawing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('pen gesture commits one stroke with pressure samples', async () => {
    const w = mount(PaperSurface, { props: baseProps });
    await drawStroke(w, [[10, 10], [20, 11], [40, 12], [60, 13]]);
    const commits = w.emitted('commit');
    expect(commits).toHaveLength(1);
    const stroke = commits[0][0];
    expect(stroke.tool).toBe('pen');
    expect(stroke.points.length).toBeGreaterThanOrEqual(4);
    expect(stroke.points.every((p) => p.length === 3 && p[2] > 0)).toBe(true);
  });

  it('emits height-change when a stroke approaches the bottom edge', async () => {
    const w = mount(PaperSurface, { props: baseProps });
    await drawStroke(w, [[10, 80], [30, 95], [50, 96]]);
    const events = w.emitted('height-change');
    expect(events).toBeTruthy();
    expect(events[0][0]).toBeGreaterThan(96);
  });

  it('eraser gesture emits update-strokes, no commit', async () => {
    const w = mount(PaperSurface, {
      props: {
        ...baseProps,
        strokes: [
          { id: 'a', tool: 'pen', color: '#000', size: 4, opacity: 1, points: [[0, 50, 0.5], [20, 50, 0.5], [40, 50, 0.5], [60, 50, 0.5], [80, 50, 0.5], [100, 50, 0.5]] },
        ],
      },
    });
    await drawStroke(
      w,
      [[48, 50], [50, 50], [52, 50]],
      'eraser'
    );
    expect(w.emitted('commit')).toBeFalsy();
    expect(w.emitted('update-strokes')).toBeTruthy();
    const next = w.emitted('update-strokes').at(-1)[0];
    expect(next.some((s) => s.id.startsWith('a_'))).toBe(true);
  });
});

describe('PaperSurface pencil handoff', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('starts a relayed stroke when inserted by the stylus plugin', async () => {
    setPendingHandoff({ x: 20, y: 30 });
    const w = mount(PaperSurface, { props: { ...baseProps, focused: false, tool: 'pen' } });

    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 25, clientY: 35, bubbles: true }));
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 28, clientY: 38, bubbles: true }));
    window.dispatchEvent(new PointerEvent('pointerup', { clientX: 30, clientY: 40, bubbles: true }));
    await w.vm.$nextTick();

    const commits = w.emitted('commit');
    expect(commits?.length).toBe(1);
    expect(commits[0][0].points.length).toBeGreaterThanOrEqual(3);
    expect(takePendingHandoff()).toBeNull();
  });

  it('ignores a handoff outside its bounds', async () => {
    setPendingHandoff({ x: 5000, y: 5000 });
    const w = mount(PaperSurface, { props: { ...baseProps, focused: false, tool: 'pen' } });

    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 5005, clientY: 5005, bubbles: true }));
    window.dispatchEvent(new PointerEvent('pointerup', { clientX: 5010, clientY: 5010, bubbles: true }));
    await w.vm.$nextTick();

    expect(w.emitted('commit')).toBeUndefined();
    expect(takePendingHandoff()).toBeNull();
  });
});
