import { describe, it, expect, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';
import Modal from '../Modal.vue';

describe('Modal close affordances', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('does not render the X close icon', async () => {
    const wrapper = mount(Modal, {
      props: { modelValue: true },
      slots: { header: '<h3>Title</h3>', default: '<p>Body</p>' },
      global: { stubs: ['v-remixicon'] },
    });

    expect(document.body.innerHTML).not.toContain('riCloseLine');
    wrapper.unmount();
  });
});
