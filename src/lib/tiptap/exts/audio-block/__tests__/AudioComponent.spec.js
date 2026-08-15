import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import AudioComponent from '../AudioComponent.vue';

const props = { node: { attrs: { src: 'assets://n1/x.wav', fileName: 'x.wav' } } };

describe('AudioComponent', () => {
  it('does not render the file name and avoids a global audio id', () => {
    const wrapper = mount(AudioComponent, {
      props,
      global: {
        stubs: ['node-view-wrapper', 'v-remixicon'],
        renderStubDefaultSlot: true,
      },
    });
    expect(wrapper.text()).not.toContain('x.wav');
    expect(wrapper.find('audio').attributes('id')).not.toBe('audioPlayer');
  });
});
