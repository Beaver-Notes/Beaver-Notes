import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';

import WorkspaceFormDialog from '../WorkspaceFormDialog.vue';

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
        'ui-button': { template: '<button type="button" @click="$emit(\'click\')"><slot /></button>' },
        'v-remixicon': true,
      },
    },
  });
}

function createButton(wrapper) {
  return wrapper.findAll('button').find((b) => b.text() === 'Create');
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

  it('does not stay stuck on "..." when reopened after a failed create', async () => {
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
