import { describe, it, expect, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';

vi.mock('@/composable/useTranslations', () => ({
  useTranslations: () => ({ translations: { value: {} } }),
}));

import CustomizeEditor from '../CustomizeEditor.vue';

const ModalStub = {
  name: 'UiModalStub',
  props: ['modelValue', 'contentClass', 'overlayClass', 'persist'],
  template: '<div><slot name="header" /><slot /><slot name="actions" /></div>',
};

const InputStub = {
  name: 'UiInputStub',
  props: ['modelValue', 'placeholder'],
  emits: ['update:modelValue', 'keydown'],
  template: `<input :value="modelValue" :placeholder="placeholder" @input="$emit('update:modelValue', $event.target.value)" @keydown="$emit('keydown', $event)" />`,
};

const ButtonStub = {
  name: 'UiButtonStub',
  props: ['loading', 'disabled', 'color'],
  // 'click' must be declared: otherwise the parent's @click falls through
  // as a second native listener next to the template's own @click, and
  // onPrimary runs twice (close-then-save in the picker view).
  emits: ['click'],
  template:
    '<button :disabled="disabled || loading" @click="$emit(\'click\', $event)"><slot /></button>',
};

const PickerStub = {
  name: 'UiEmojiPickerStub',
  props: ['current', 'columns'],
  emits: ['select'],
  template: `<div>
    <button type="button" data-testid="pick-rocket" @click="$emit('select', '🚀')">pick</button>
  </div>`,
};

function mountEditor(props = {}) {
  return mount(CustomizeEditor, {
    props: {
      modelValue: true,
      kind: 'folder',
      title: 'Customize',
      primaryLabel: 'Done',
      namePlaceholder: 'Folder name',
      initialName: '',
      initialColor: '#ef4444',
      initialIcon: '',
      disablePrimaryWhenEmpty: true,
      showUseDefault: true,
      ...props,
    },
    global: {
      stubs: {
        'ui-modal': ModalStub,
        'ui-input': InputStub,
        'ui-button': ButtonStub,
        'ui-emoji-picker': PickerStub,
        'v-remixicon': true,
      },
    },
  });
}

function buttonByText(wrapper, text) {
  const btn = wrapper.findAll('button').find((b) => b.text() === text);
  expect(btn?.exists()).toBe(true);
  return btn;
}

describe('CustomizeEditor', () => {
  it('opens the picker from the preview and closes back to the edit view', async () => {
    const wrapper = mountEditor({ initialName: 'Reading' });

    expect(wrapper.find('button[aria-label="Choose icon"]').exists()).toBe(true);

    await wrapper.find('button[aria-label="Choose icon"]').trigger('click');
    expect(wrapper.find('button[aria-label="Back"]').exists()).toBe(true);

    // Primary becomes "Use icon" and just closes the picker, without saving.
    await buttonByText(wrapper, 'Use icon').trigger('click');
    expect(wrapper.find('button[aria-label="Choose icon"]').exists()).toBe(
      true,
    );
    expect(wrapper.emitted('save')).toBeUndefined();
    wrapper.unmount();
  });

  it('closes the picker on Escape before the modal sees it', async () => {
    const wrapper = mountEditor({ initialName: 'Reading' });
    await wrapper.find('button[aria-label="Choose icon"]').trigger('click');
    expect(wrapper.find('button[aria-label="Back"]').exists()).toBe(true);

    document.dispatchEvent(
      new KeyboardEvent('keyup', { key: 'Escape', bubbles: true }),
    );
    await flushPromises();

    expect(wrapper.find('button[aria-label="Back"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it('selects a palette color and saves it', async () => {
    const wrapper = mountEditor({
      initialName: 'Reading',
      initialColor: '#ef4444',
    });

    const blue = wrapper.find('button[aria-label="Blue"]');
    await blue.trigger('click');
    expect(blue.attributes('aria-pressed')).toBe('true');
    expect(
      wrapper.find('button[aria-label="Red"]').attributes('aria-pressed'),
    ).toBe('false');

    await buttonByText(wrapper, 'Done').trigger('click');
    expect(wrapper.emitted('save')[0][0]).toMatchObject({
      name: 'Reading',
      color: '#3b82f6',
    });
    wrapper.unmount();
  });

  it('use default clears the folder icon', async () => {
    const wrapper = mountEditor({
      initialName: 'Reading',
      initialIcon: '📁',
    });

    await wrapper.find('button[aria-label="Choose icon"]').trigger('click');
    await buttonByText(wrapper, 'Use default folder icon').trigger('click');

    // Picker closed, back in the edit view.
    expect(wrapper.find('button[aria-label="Choose icon"]').exists()).toBe(
      true,
    );
    await buttonByText(wrapper, 'Done').trigger('click');
    expect(wrapper.emitted('save')[0][0]).toMatchObject({ icon: '' });
    wrapper.unmount();
  });

  it('preserves edits made before and inside the picker', async () => {
    const wrapper = mountEditor({
      initialName: 'Work',
      initialColor: '#10b981',
      initialIcon: '📁',
    });

    await wrapper
      .findComponent(InputStub)
      .find('input')
      .setValue('Side projects');
    await wrapper.find('button[aria-label="Purple"]').trigger('click');
    await wrapper.find('button[aria-label="Choose icon"]').trigger('click');

    await wrapper.find('[data-testid="pick-rocket"]').trigger('click');
    await wrapper.find('button[aria-label="Back"]').trigger('click');

    await buttonByText(wrapper, 'Done').trigger('click');
    expect(wrapper.emitted('save')[0][0]).toEqual({
      name: 'Side projects',
      color: '#8b5cf6',
      icon: '🚀',
    });
    wrapper.unmount();
  });

  it('disables the primary action while the name is empty', async () => {
    const wrapper = mountEditor({ initialName: '   ' });
    const done = buttonByText(wrapper, 'Done');
    expect(done.attributes('disabled')).toBeDefined();
    await done.trigger('click');
    expect(wrapper.emitted('save')).toBeUndefined();
    wrapper.unmount();
  });
});
