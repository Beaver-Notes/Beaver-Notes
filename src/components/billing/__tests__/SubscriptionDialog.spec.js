import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import SubscriptionDialog from '../SubscriptionDialog.vue';

describe('SubscriptionDialog', () => {
  it('renders plans inside modal and forwards select', async () => {
    const w = mount(SubscriptionDialog, {
      props: { modelValue: true, signedIn: true, isPaid: false, currentPlan: 'free' },
      global: {
        stubs: {
          'ui-modal': { template: '<div class="ui-modal"><slot /></div>' },
          'ui-card': { template: '<div><slot /></div>' },
          'ui-button': {
            emits: ['click'],
            template: '<button data-plan="starter" @click="$emit(\'click\')"><slot /></button>',
          },
        },
      },
    });
    expect(w.find('.ui-modal').exists()).toBe(true);
    // ponytail: stub hardcodes data-plan on every ui-button, so the
    // Monthly/Yearly toggle matches too — scope to Choose buttons (first is starter).
    const choose = w.findAll('button').filter((b) => b.text() === 'Choose');
    await choose[0].trigger('click');
    expect(w.emitted('select')?.[0]).toEqual(['starter', 'monthly']);
  });
  it('emits restore from the restore button', async () => {
    const w = mount(SubscriptionDialog, {
      props: { modelValue: true, signedIn: true, isPaid: false, currentPlan: 'free' },
      global: {
        stubs: {
          'ui-modal': { template: '<div class="ui-modal"><slot /></div>' },
          'ui-card': { template: '<div><slot /></div>' },
          'ui-button': {
            emits: ['click'],
            template: '<button @click="$emit(\'click\')"><slot /></button>',
          },
        },
      },
    });
    const restore = w.findAll('button').filter((b) => b.text().match(/restore/i));
    expect(restore).toHaveLength(1);
    await restore[0].trigger('click');
    expect(w.emitted('restore')).toHaveLength(1);
  });
});
