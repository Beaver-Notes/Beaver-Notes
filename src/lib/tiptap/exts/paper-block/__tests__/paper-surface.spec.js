import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';

vi.mock('@/lib/native/scribble', () => ({
  setScribbleSuppressed: vi.fn(),
  clearScribbleSuppressed: vi.fn(),
}));

import { setScribbleSuppressed, clearScribbleSuppressed } from '@/lib/native/scribble';
import PaperSurface from '../PaperSurface.vue';

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

  it('focused: 4 handles, border, toolbar slot, hint gone', async () => {
    const w = mount(PaperSurface, {
      props: { ...baseProps, focused: true },
      slots: { toolbar: '<div class="tb">tools</div>' },
    });
    expect(w.findAll('.surface-handle')).toHaveLength(4);
    expect(w.find('.surface-border').exists()).toBe(true);
    expect(w.find('.surface-toolbar').exists()).toBe(true);
    expect(w.find('.tb').exists()).toBe(true);
    expect(w.find('.surface-hint').exists()).toBe(false);
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
