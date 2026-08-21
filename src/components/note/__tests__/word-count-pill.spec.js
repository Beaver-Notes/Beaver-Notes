import { describe, expect, it, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import WordCountPill from '../WordCountPill.vue';
import { usePillDock } from '@/composable/usePillDock';

const { expandedPill, toggle } = usePillDock();

const { updateMock, isRecordingRef } = vi.hoisted(() => ({
  updateMock: vi.fn(),
  isRecordingRef: { value: false },
}));

vi.mock('@/store/note', () => ({
  useNoteStore: () => ({ update: updateMock }),
}));

vi.mock('@/composable/useTranslations', () => ({
  useTranslations: () => ({ translations: { value: { noteActions: {} } } }),
}));

vi.mock('@/composable/useAudioRecorder', () => ({
  useAudioRecorder: () => ({ isRecording: isRecordingRef }),
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

describe('WordCountPill pill dock', () => {
  beforeEach(() => {
    updateMock.mockClear();
    isRecordingRef.value = false;
    expandedPill.value = null;
  });

  function mountDocked() {
    return mount(WordCountPill, {
      props: { editor: makeEditor(123), note: makeNote(500) },
      ...globalStubs,
    });
  }

  it('stays fully expanded when solo (no recording)', async () => {
    const wrapper = mount(WordCountPill, {
      props: { editor: makeEditor(123), note: makeNote() },
      ...globalStubs,
    });
    await nextTick();
    expect(wrapper.text()).toContain('123 words');
    const trigger = wrapper.find('button');
    expect(trigger.attributes('aria-expanded')).toBeUndefined();
    // Solo tap opens the popover as before; it must not touch dock state.
    await trigger.trigger('click');
    expect(expandedPill.value).toBe(null);
  });

  it('collapses to the ring by default while recording', async () => {
    isRecordingRef.value = true;
    const wrapper = mountDocked();
    await nextTick();
    // Label hidden (collapsed), ring present, toggle reflects collapsed state.
    const label = wrapper.find('span');
    expect(label.classes()).toContain('max-w-0');
    expect(label.classes()).toContain('opacity-0');
    expect(wrapper.find('svg').exists()).toBe(true);
    expect(wrapper.find('button').attributes('aria-expanded')).toBe('false');
  });

  it('expands after toggle("word-count") while recording', async () => {
    isRecordingRef.value = true;
    expandedPill.value = 'recording';
    const wrapper = mountDocked();
    await nextTick();
    expect(wrapper.find('span').classes()).toContain('max-w-0');

    toggle('word-count');
    await nextTick();
    const label = wrapper.find('span');
    expect(label.classes()).toContain('opacity-100');
    expect(wrapper.find('button').attributes('aria-expanded')).toBe('true');
  });

  it('tapping a collapsed pill expands it instead of opening the popover', async () => {
    isRecordingRef.value = true;
    const wrapper = mountDocked();
    await nextTick();
    await wrapper.find('button').trigger('click');
    expect(expandedPill.value).toBe('word-count');
  });
});
