import { describe, it, expect, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import emitter from 'tiny-emitter/instance';
import Dialog from '../Dialog.vue';

vi.mock('@/composable/useTranslations', () => ({
  useTranslations: () => ({
    translations: {
      dialog: { close: 'Close', cancel: 'Cancel', confirm: 'Confirm', inputEmpty: 'Required' },
    },
  }),
}));

function mountDialog() {
  return mount(Dialog, {
    global: { stubs: ['ui-modal', 'ui-input', 'ui-button', 'v-remixicon'] },
  });
}

describe('Dialog nested dialogs', () => {
  it('keeps a prompt open when its confirm parent opens it', async () => {
    const wrapper = mountDialog();
    const onNestedConfirm = vi.fn(async () => {});

    emitter.emit('show-dialog', 'confirm', {
      title: 'Confirm',
      body: 'Confirm body',
      okText: 'OK',
      onConfirm: () => {
        emitter.emit('show-dialog', 'prompt', {
          title: 'Enter password',
          placeholder: 'Vault password',
          password: true,
          onConfirm: onNestedConfirm,
        });
      },
    });

    // Fire the confirm OK callback.
    await wrapper.vm.fireCallback('onConfirm');
    await flushPromises();

    // The nested prompt must still be visible (not torn down by the parent).
    expect(wrapper.vm.state.show).toBe(true);
    expect(wrapper.vm.state.type).toBe('prompt');
  });

  it('closes a plain prompt after its own confirm runs', async () => {
    const wrapper = mountDialog();
    emitter.emit('show-dialog', 'prompt', {
      title: 'Ask',
      placeholder: 'Value',
      onConfirm: () => {},
    });

    await wrapper.vm.fireCallback('onConfirm');
    await flushPromises();

    expect(wrapper.vm.state.show).toBe(false);
  });
});
