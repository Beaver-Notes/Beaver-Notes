import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import AudioComponent from '../AudioComponent.vue';

const props = { node: { attrs: { src: 'assets://n1/x.wav', fileName: 'x.wav' } } };

function mountComponent() {
  return mount(AudioComponent, {
    props,
    global: {
      stubs: ['node-view-wrapper', 'v-remixicon'],
      renderStubDefaultSlot: true,
    },
  });
}

describe('AudioComponent', () => {
  it('does not render the file name and avoids a global audio id', () => {
    const wrapper = mountComponent();
    expect(wrapper.text()).not.toContain('x.wav');
    expect(wrapper.find('audio').attributes('id')).not.toBe('audioPlayer');
  });

  it('shows the real duration once metadata loads', async () => {
    const wrapper = mountComponent();
    const audio = wrapper.find('audio').element;
    Object.defineProperty(audio, 'duration', { value: 42.5, configurable: true });
    audio.currentTime = 3;
    await wrapper.find('audio').trigger('loadedmetadata');
    await nextTick();
    expect(wrapper.text()).toContain('0:42');
  });

  it('ignores Infinity durations so the label does not show garbage', async () => {
    const wrapper = mountComponent();
    const audio = wrapper.find('audio').element;
    Object.defineProperty(audio, 'duration', { value: Infinity, configurable: true });
    await wrapper.find('audio').trigger('loadedmetadata');
    await nextTick();
    expect(wrapper.text()).toContain('0:00');
  });
});
