import { describe, expect, it, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import WordCountPill from '../WordCountPill.vue';

const { updateMock } = vi.hoisted(() => ({ updateMock: vi.fn() }));

vi.mock('@/store/note', () => ({
  useNoteStore: () => ({ update: updateMock }),
}));

vi.mock('@/composable/useTranslations', () => ({
  useTranslations: () => ({ translations: { value: { noteActions: {} } } }),
}));

// Slot-rendering stubs: real ui-popover teleports + uses floating-ui, which
// these assertions don't need.
const UiPill = { template: '<div><slot /></div>' };
const UiPopover = { template: '<div><slot name="trigger" /><slot /></div>' };

function makeEditor(words) {
  return {
    storage: { characterCount: { words: () => words } },
    on: vi.fn(),
    off: vi.fn(),
  };
}

function makeNote(wordCountLimit = null) {
  return { id: 'n1', wordCountLimit };
}

const globalStubs = {
  global: {
    stubs: { 'ui-pill': UiPill, 'ui-popover': UiPopover },
  },
};

describe('WordCountPill', () => {
  beforeEach(() => {
    updateMock.mockClear();
  });

  it('shows plain word count without a limit', async () => {
    const wrapper = mount(WordCountPill, {
      props: { editor: makeEditor(123), note: makeNote() },
      ...globalStubs,
    });
    await nextTick();
    expect(wrapper.text()).toContain('123 words');
    expect(wrapper.find('svg').exists()).toBe(false);
  });

  it('shows ring and ratio with a limit', async () => {
    const wrapper = mount(WordCountPill, {
      props: { editor: makeEditor(123), note: makeNote(500) },
      ...globalStubs,
    });
    await nextTick();
    expect(wrapper.text()).toContain('123 / 500');
    const progressCircle = wrapper.findAll('circle')[1];
    expect(progressCircle.classes()).toContain('stroke-neutral-400');
    expect(Number(progressCircle.attributes('stroke-dashoffset'))).toBeCloseTo(
      40.8407 * (1 - 123 / 500),
      3
    );
  });

  it('turns amber at 90% of the limit', async () => {
    const wrapper = mount(WordCountPill, {
      props: { editor: makeEditor(460), note: makeNote(500) },
      ...globalStubs,
    });
    await nextTick();
    expect(wrapper.findAll('circle')[1].classes()).toContain('stroke-amber-500');
  });

  it('turns red at 100% of the limit and keeps counting', async () => {
    const wrapper = mount(WordCountPill, {
      props: { editor: makeEditor(530), note: makeNote(500) },
      ...globalStubs,
    });
    await nextTick();
    expect(wrapper.text()).toContain('530 / 500');
    expect(wrapper.findAll('circle')[1].classes()).toContain('stroke-red-500');
    // Offset clamps at 0 (full ring) even when over limit.
    expect(Number(wrapper.vm.dashOffset)).toBeCloseTo(0, 6);
  });

  it('subscribes on mount and unsubscribes on unmount', () => {
    const editor = makeEditor(10);
    const wrapper = mount(WordCountPill, {
      props: { editor, note: makeNote() },
      ...globalStubs,
    });
    expect(editor.on).toHaveBeenCalledWith('update', expect.any(Function));
    const handler = editor.on.mock.calls[0][1];
    wrapper.unmount();
    expect(editor.off).toHaveBeenCalledWith('update', handler);
  });

  it('stores a positive integer limit and clears the input', () => {
    const wrapper = mount(WordCountPill, {
      props: { editor: makeEditor(10), note: makeNote() },
      ...globalStubs,
    });
    wrapper.vm.limitInput = '250';
    wrapper.vm.applyLimit();
    expect(updateMock).toHaveBeenCalledWith('n1', { wordCountLimit: 250 });
    expect(wrapper.vm.limitInput).toBe('');
  });

  it('clears the limit on invalid input', () => {
    const wrapper = mount(WordCountPill, {
      props: { editor: makeEditor(10), note: makeNote(500) },
      ...globalStubs,
    });
    wrapper.vm.limitInput = '-3';
    wrapper.vm.applyLimit();
    expect(updateMock).toHaveBeenCalledWith('n1', { wordCountLimit: null });

    wrapper.vm.limitInput = 'not-a-number';
    wrapper.vm.applyLimit();
    expect(updateMock).toHaveBeenCalledWith('n1', { wordCountLimit: null });
  });

  it('clears the limit via clearLimit', () => {
    const wrapper = mount(WordCountPill, {
      props: { editor: makeEditor(10), note: makeNote(500) },
      ...globalStubs,
    });
    wrapper.vm.clearLimit();
    expect(updateMock).toHaveBeenCalledWith('n1', { wordCountLimit: null });
  });
});
