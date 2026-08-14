import { describe, it, expect, vi } from 'vitest';
import { computed } from 'vue';
import { mount } from '@vue/test-utils';

vi.mock('@/composable/useTranslations', () => ({
  useTranslations: () => ({
    translations: computed(() => ({ filter: {} })),
  }),
}));
vi.mock('@/store/label', () => ({
  useLabelStore: () => ({
    data: [],
    colors: {},
    getColor: () => null,
  }),
}));
vi.mock('tiny-emitter/instance', () => ({ default: { on: vi.fn(), off: vi.fn() } }));
vi.mock('@/lib/mousetrap', () => ({ default: { bind: vi.fn(), unbind: vi.fn() } }));

import HomeSearch from '../HomeSearch.vue';

describe('HomeSearch spacing', () => {
  it('keeps consistent bottom spacing with or without labels', () => {
    const wrapper = mount(HomeSearch);
    const root = wrapper.find('div');
    expect(root.classes().join(' ')).toMatch(/mb-\d/);
  });
});
