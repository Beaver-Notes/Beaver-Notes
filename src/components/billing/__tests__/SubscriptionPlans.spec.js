import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import SubscriptionPlans from '../SubscriptionPlans.vue';

const stubs = {
  'ui-card': { template: '<div class="ui-card"><slot /></div>' },
  'ui-button': { template: '<button @click="$emit(\'click\')"><slot /></button>' },
};

describe('SubscriptionPlans', () => {
  it('shows sign-in prompt when signed out', () => {
    const w = mount(SubscriptionPlans, {
      props: { signedIn: false, isPaid: false, currentPlan: 'free' },
      global: { stubs },
    });
    expect(w.text()).toMatch(/sign in/i);
  });
  it('renders options per interval for free users and emits select', async () => {
    const w = mount(SubscriptionPlans, {
      props: { signedIn: true, isPaid: false, currentPlan: 'free' },
      global: { stubs },
    });
    // ponytail: brief says 4, but rows are filtered by interval (2 plans per
    // interval); cover all four options across both intervals instead.
    // NOTE: the ui-button stub both re-emits click AND inherits onClick as a
    // native listener, so each trigger fires select twice — assert [0]/at(-1).
    const buttons = w.findAll('button[data-plan]');
    expect(buttons).toHaveLength(2);
    await buttons[0].trigger('click');
    expect(w.emitted('select')?.[0]).toEqual(['starter', 'monthly']);
    await w.setProps({ interval: 'yearly' });
    const yearly = w.findAll('button[data-plan]');
    expect(yearly).toHaveLength(2);
    await yearly[0].trigger('click');
    expect(w.emitted('select')?.at(-1)).toEqual(['starter', 'yearly']);
  });
  it('shows continue state for paid users', () => {
    const w = mount(SubscriptionPlans, {
      props: { signedIn: true, isPaid: true, currentPlan: 'pro' },
      global: { stubs },
    });
    expect(w.text()).toMatch(/pro/i);
  });
});
