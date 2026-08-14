import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { setActivePinia, createPinia } from 'pinia';
import LabelNodeView from '../LabelNodeView.vue';

vi.mock('@/store/label', () => ({
  useLabelStore: () => ({
    getColor: (name) => (name === 'work' ? '#ffba00' : null),
  }),
}));

describe('LabelNodeView', () => {
  beforeEach(() => setActivePinia(createPinia()));

  it('renders the label with its color', () => {
    const wrapper = mount(LabelNodeView, {
      props: { node: { attrs: { id: 'work', label: 'work' } } },
    });
    expect(wrapper.text()).toBe('#work');
    expect(wrapper.attributes('style')).toContain('#ffba00');
  });

  it('renders without color when the label has none', () => {
    const wrapper = mount(LabelNodeView, {
      props: { node: { attrs: { id: 'plain', label: 'plain' } } },
    });
    expect(wrapper.text()).toBe('#plain');
    expect(wrapper.attributes('style')).toBeUndefined();
  });
});
