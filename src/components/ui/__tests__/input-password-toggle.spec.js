import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import Input from '../Input.vue';

describe('Input password toggle', () => {
  it('toggles input type when the eye is clicked', async () => {
    const wrapper = mount(Input, { props: { password: true, modelValue: 'secret' } });
    const input = wrapper.find('input');
    expect(input.attributes('type')).toBe('password');
    await wrapper.find('button').trigger('click');
    expect(input.attributes('type')).toBe('text');
  });
});
