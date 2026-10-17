import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';

vi.mock('@/composable/useTranslations', () => ({
  useTranslations: () => ({ translations: { value: {} } }),
}));

import WorkspaceFormDialog from '../WorkspaceFormDialog.vue';

const PALETTE_LABELS = ['Red', 'Amber', 'Green', 'Blue', 'Purple', 'Pink', 'Neutral'];

function mountDialog({ submitHandler, workspace = null, show = true } = {}) {
  return mount(WorkspaceFormDialog, {
    props: { show, mode: workspace ? 'edit' : 'create', workspace, submitHandler },
    global: {
      stubs: {
        'ui-modal': {
          template:
            '<div><slot name="header" /><slot name="actions" /><slot /></div>',
        },
        'ui-input': {
          props: ['modelValue'],
          emits: ['update:modelValue'],
          template:
            '<input :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
        },
        'ui-button': {
          props: ['loading'],
          template:
            '<button type="button" :disabled="loading" @click="$emit(\'click\')"><slot /></button>',
        },
        'v-remixicon': true,
      },
    },
  });
}

function createButton(wrapper) {
  return wrapper.findAll('button').find((b) => b.text() === 'Create');
}

function colorTiles(wrapper) {
  return wrapper
    .findAll('[aria-label]')
    .filter(
      (b) =>
        ['Custom color'].includes(b.attributes('aria-label')) ||
        PALETTE_LABELS.includes(b.attributes('aria-label'))
    );
}

describe('WorkspaceFormDialog submit lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('clears loading and emits close after a successful create', async () => {
    const submitHandler = vi.fn().mockResolvedValue(undefined);
    const wrapper = mountDialog({ submitHandler });

    await wrapper.find('input').setValue('Test');
    await createButton(wrapper).trigger('click');
    await flushPromises();

    expect(submitHandler).toHaveBeenCalledTimes(1);
    expect(wrapper.emitted('close')).toHaveLength(1);
    expect(createButton(wrapper)).toBeTruthy();
  });

  it('surfaces the error inline and clears loading after a failed create', async () => {
    const submitHandler = vi.fn().mockRejectedValue(new Error('plan upgrade required'));
    const wrapper = mountDialog({ submitHandler });

    await wrapper.find('input').setValue('Test');
    await createButton(wrapper).trigger('click');
    await flushPromises();

    expect(wrapper.text()).toContain('plan upgrade required');
    expect(wrapper.emitted('close')).toBeUndefined();
    expect(createButton(wrapper)).toBeTruthy();
  });

  it('creates with default emoji and colour when only a name is given', async () => {
    const submitHandler = vi.fn().mockResolvedValue(undefined);
    const wrapper = mountDialog({ submitHandler });

    await wrapper.find('input').setValue('Just a name');
    await createButton(wrapper).trigger('click');
    await flushPromises();

    const payload = submitHandler.mock.calls[0][0];
    expect(payload.name).toBe('Just a name');
    expect(payload.emoji).toBeTruthy();
    expect(payload.color).toMatch(/^#/);
  });

  it('does not stay stuck on a stale loading state when reopened after a failed create', async () => {
    const submitHandler = vi.fn().mockRejectedValue(new Error('boom'));
    const wrapper = mountDialog({ submitHandler });

    await wrapper.find('input').setValue('Test');
    await createButton(wrapper).trigger('click');
    await flushPromises();

    await wrapper.setProps({ show: false });
    await wrapper.setProps({ show: true });
    await flushPromises();

    expect(wrapper.text()).not.toContain('...');
  });
});

describe('WorkspaceFormDialog redesign', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('exposes a deduped emoji list starting with the default emoji', () => {
    const wrapper = mountDialog();
    const list = wrapper.vm.EMOJI_ALLOWLIST;
    expect(new Set(list).size).toBe(list.length);
    expect(list[0]).toBe('📁');
  });

  it('renders exactly 8 color tiles: 7 palette + 1 custom', () => {
    const wrapper = mountDialog();
    const tiles = colorTiles(wrapper);
    expect(tiles).toHaveLength(8);
    expect(tiles.filter((t) => t.attributes('aria-label') === 'Custom color')).toHaveLength(1);
    expect(wrapper.find('input[type="color"]').exists()).toBe(true);
  });

  it('applies a custom color picked via the color input to the submit payload', async () => {
    const submitHandler = vi.fn().mockResolvedValue(undefined);
    const wrapper = mountDialog({ submitHandler });

    const customInput = wrapper.find('input[type="color"]');
    await customInput.setValue('#123456');

    await wrapper.find('input').setValue('Test');
    await createButton(wrapper).trigger('click');
    await flushPromises();

    expect(submitHandler.mock.calls[0][0].color).toBe('#123456');
  });

  it('shows an honest loading state through ui-button, not "..." text', async () => {
    const submitHandler = vi.fn().mockReturnValue(new Promise(() => {}));
    const wrapper = mountDialog({ submitHandler });

    await wrapper.find('input').setValue('Test');
    await createButton(wrapper).trigger('click');

    const disabled = wrapper.findAll('button[disabled]');
    expect(disabled.length).toBeGreaterThan(0);
    expect(wrapper.text()).not.toContain('...');
    await flushPromises();
  });

  it('keeps the inline error and never submits when the name is empty', async () => {
    const submitHandler = vi.fn();
    const wrapper = mountDialog({ submitHandler });

    await createButton(wrapper).trigger('click');
    await flushPromises();

    expect(wrapper.find('[role="alert"]').exists()).toBe(true);
    expect(submitHandler).not.toHaveBeenCalled();
  });
});
