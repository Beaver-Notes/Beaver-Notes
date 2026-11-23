import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ref, nextTick } from 'vue';
import { mount, flushPromises } from '@vue/test-utils';
import emitter from 'tiny-emitter/instance';
import { usePaywall } from '@/utils/paywall';

const ctl = vi.hoisted(() => ({
  isMobile: false,
  wide: true,
  authed: true,
  plan: 'free',
  paid: false,
  buyImpl: null,
  restoreImpl: null,
  products: [],
  getPlansImpl: async () => ({ plan: 'free', prices: null }),
  checkoutImpl: null,
  signInImpl: null,
  openUrl: vi.fn(),
}));

vi.mock('@/store/account', () => ({
  useAccountStore: () => ({
    get isAuthenticated() {
      return ctl.authed;
    },
    get isPaidPlan() {
      return ctl.paid;
    },
    get plan() {
      return ctl.plan;
    },
    serverUrl: 'https://api.test',
    profile: { id: 'u1' },
    subscription: null,
  }),
}));

vi.mock('@/composable/useAccountAuth', () => ({
  useAccountAuth: () => ({
    signInWithPassword: vi.fn(async (...a) => ctl.signInImpl(...a)),
  }),
}));

vi.mock('@/composable/useTranslations', () => ({
  useTranslations: () => ({ translations: ref({}) }),
}));

vi.mock('@/composable/useIapBilling', () => ({
  useIapBilling: () => ({
    isMobile: ctl.isMobile,
    products: ref(ctl.products),
    loading: ref(false),
    error: ref(''),
    loadProducts: vi.fn(),
    buy: (...a) => ctl.buyImpl(...a),
    restore: (...a) => ctl.restoreImpl(...a),
    openManage: vi.fn(),
  }),
}));

vi.mock('@/lib/api/plans', () => ({
  getPlans: vi.fn((...a) => ctl.getPlansImpl(...a)),
}));

vi.mock('@/lib/api/billing', () => ({
  createCheckoutSession: vi.fn((...a) => ctl.checkoutImpl(...a)),
}));

vi.mock('@tauri-apps/plugin-opener', () => ({
  openUrl: (...a) => ctl.openUrl(...a),
}));

import PaywallDialog from '../PaywallDialog.vue';

const mounted = [];
// jsdom has no matchMedia; the dialog's tablet/phone layout switch reads it.
window.matchMedia = (query) => ({
  matches: query.includes('min-width') ? ctl.wide : !ctl.wide,
  addEventListener() {},
  removeEventListener() {},
});
const mountPaywall = () => {
  const w = mount(PaywallDialog, {
    global: {
      stubs: {
        'ui-modal': {
          props: ['modelValue'],
          template:
            '<div v-if="modelValue"><slot name="header" /><slot /><slot name="actions" /></div>',
        },
        'ui-beaver-character': true,
        'ui-input': true,
        'ui-card': { template: '<div><slot /></div>' },
        'ui-button': { template: '<button><slot /></button>' },
        'v-remixicon': true,
      },
    },
  });
  mounted.push(w);
  return w;
};

const radios = (w) => w.findAll('[role="radio"]');

beforeEach(() => {
  ctl.isMobile = false;
  ctl.wide = true;
  ctl.authed = true;
  ctl.plan = 'free';
  ctl.paid = false;
  ctl.products = [];
  ctl.buyImpl = async () => null;
  ctl.restoreImpl = async () => {};
  ctl.checkoutImpl = async () => ({ url: 'https://checkout.stripe.com/x' });
  ctl.signInImpl = async () => {};
  ctl.getPlansImpl = async () => ({ plan: 'free', prices: null });
});

afterEach(() => {
  while (mounted.length) mounted.pop().unmount();
  emitter.off('show-paywall');
});

describe('PaywallDialog triggering + copy', () => {
  it('changes the headline per trigger reason', async () => {
    const w = mountPaywall();
    await flushPromises();
    usePaywall().open('history');
    await flushPromises();
    expect(w.text()).toContain('Every edit, safely kept');
    usePaywall().open('storage');
    await flushPromises();
    expect(w.text()).toContain('Room for everything');
    usePaywall().open('nope');
    await flushPromises();
    expect(w.text()).toContain('Choose your plan');
  });
});

describe('PaywallDialog plans (desktop)', () => {
  it('shows Basic, Pro and Team as radios', async () => {
    const w = mountPaywall();
    usePaywall().open('settings');
    await flushPromises();
    const labels = radios(w).map((r) => r.text());
    expect(labels.join(' ')).toMatch(/Basic/);
    expect(labels.join(' ')).toMatch(/Pro/);
    expect(labels.join(' ')).toMatch(/Team/);
    expect(radios(w).length).toBe(3);
  });

  it('shows server prices when /plans returns them', async () => {
    ctl.getPlansImpl = async () => ({
      plan: 'free',
      prices: {
        pro: { monthly: { amount: 700, currency: 'usd' }, yearly: null },
      },
    });
    const w = mountPaywall();
    usePaywall().open('settings');
    await flushPromises();
    expect(w.vm.planPriceText('pro')).toMatch(/\$7(\.\d+)? \/ mo/);
  });

  it('shows no invented amounts when the server has no prices', async () => {
    const w = mountPaywall();
    usePaywall().open('settings');
    await flushPromises();
    expect(w.vm.planPriceText('pro')).toBe('');
    expect(w.vm.savePercent).toBe(0);
  });

  it('marks the current paid plan and offers upgrades only', async () => {
    ctl.plan = 'starter';
    ctl.paid = true;
    const w = mountPaywall();
    usePaywall().open('settings');
    await flushPromises();
    // Shipped behavior: a signed-in opener lands on the plans grid with the
    // current plan preselected and badged — not the success view.
    expect(w.vm.view).toBe('plans');
    expect(w.vm.selected).toBe('starter');
    const cards = radios(w);
    expect(cards[0].text()).toMatch(/Current/);
  });

  it('desktop checkout opens the browser and reports back', async () => {
    const calls = [];
    ctl.checkoutImpl = async (...args) => {
      calls.push(args);
      return { url: 'https://checkout.stripe.com/x' };
    };
    const w = mountPaywall();
    usePaywall().open('settings');
    await flushPromises();
    await w.vm.selectPlan('pro');
    await flushPromises();
    expect(calls).toEqual([
      ['pro', 'monthly', { baseUrl: 'https://api.test' }],
    ]);
    expect(ctl.openUrl).toHaveBeenCalledWith('https://checkout.stripe.com/x');
    expect(w.vm.visibleNotice).toMatch(/Checkout opened/);
  });

  it('surfaces EMAIL_NOT_VERIFIED as a red inline notice', async () => {
    ctl.checkoutImpl = async () => {
      const e = new Error('verify');
      e.body = { error: 'EMAIL_NOT_VERIFIED' };
      throw e;
    };
    const w = mountPaywall();
    usePaywall().open('settings');
    await flushPromises();
    await w.vm.selectPlan('pro');
    await flushPromises();
    expect(w.vm.visibleNotice).toMatch(/Please verify your email/);
    expect(w.vm.view).toBe('plans');
  });

  it('load error offers retry with the plans view after success', async () => {
    ctl.getPlansImpl = async () => {
      throw new Error('network down');
    };
    const w = mountPaywall();
    usePaywall().open('settings');
    await flushPromises();
    expect(w.vm.loadError).toBe('network down');
    ctl.getPlansImpl = async () => ({ plan: 'free', prices: null });
    await w.vm.loadPlans();
    await flushPromises();
    expect(w.vm.loadError).toBe('');
    expect(radios(w).length).toBe(3);
  });
});

describe('PaywallDialog mobile', () => {
  beforeEach(() => {
    ctl.isMobile = true;
    ctl.wide = false; // phones use the bottom sheet
    ctl.products = [
      { productId: 'com.beavernotes.pro.monthly', formattedPrice: '$6.99' },
      { productId: 'com.beavernotes.pro.yearly', formattedPrice: '$59.99' },
    ];
  });

  it('hides Team and shows only Basic + Pro rows', async () => {
    const w = mountPaywall();
    usePaywall().open('settings');
    await flushPromises();
    expect(radios(w).length).toBe(2);
    expect(w.text()).not.toContain('Team');
  });

  it('shows store prices, not external links', async () => {
    const w = mountPaywall();
    usePaywall().open('settings');
    await flushPromises();
    expect(w.vm.mobilePriceText('pro')).toBe('$6.99');
    expect(w.html()).not.toMatch(/createCheckout|checkout\.stripe\.com/);
  });

  it('pending purchase shows the pending state, then success', async () => {
    let resolveBuy;
    ctl.buyImpl = () => new Promise((r) => (resolveBuy = r));
    const w = mountPaywall();
    usePaywall().open('settings');
    await flushPromises();
    const pending = w.vm.selectPlan('pro');
    expect(w.vm.busy).toBe(true);
    await nextTick();
    expect(w.text()).toMatch(/Activating your plan/);
    resolveBuy('pro');
    await pending;
    await flushPromises();
    expect(w.vm.view).toBe('success');
    expect(w.vm.currentPlan).toBe('pro');
    expect(w.text()).toMatch(/Subscribed to Pro/);
  });

  it('buy null keeps plans with a processing notice', async () => {
    ctl.buyImpl = async () => null;
    const w = mountPaywall();
    usePaywall().open('settings');
    await flushPromises();
    await w.vm.selectPlan('pro');
    await flushPromises();
    expect(w.vm.view).toBe('plans');
    expect(w.vm.visibleNotice).toMatch(/Payment processing/);
  });

  it('buy failure surfaces as an inline error', async () => {
    ctl.buyImpl = async () => {
      throw new Error('card declined');
    };
    const w = mountPaywall();
    usePaywall().open('settings');
    await flushPromises();
    await w.vm.selectPlan('pro');
    await flushPromises();
    expect(w.vm.visibleNotice).toBe('card declined');
    // notice is rendered as a live region
    const status = w.find('[role="status"]');
    expect(status.exists()).toBe(true);
  });

  it('buy sign-in-required flips to the inline sign-in step', async () => {
    ctl.buyImpl = async () => {
      throw new Error('Sign in required before purchase');
    };
    const w = mountPaywall();
    usePaywall().open('settings');
    await flushPromises();
    await w.vm.selectPlan('pro');
    await flushPromises();
    expect(w.vm.view).toBe('signing');
  });

  it('restore finds a paid plan and closes into success', async () => {
    ctl.paid = true;
    ctl.plan = 'pro';
    ctl.restoreImpl = async () => {};
    const w = mountPaywall();
    usePaywall().open('settings');
    await flushPromises();
    await w.vm.restorePurchases();
    await flushPromises();
    expect(w.vm.view).toBe('success');
    expect(w.vm.currentPlan).toBe('pro');
  });

  it('restore with nothing owned stays with a neutral notice', async () => {
    const w = mountPaywall();
    usePaywall().open('settings');
    await flushPromises();
    await w.vm.restorePurchases();
    await flushPromises();
    expect(w.vm.view).toBe('plans');
    expect(w.vm.visibleNotice).toMatch(/No purchases found/);
  });
});

describe('PaywallDialog signed-out flow', () => {
  beforeEach(() => {
    ctl.authed = false;
  });

  it('opens at the sign-in step, then returns to plans after signing in', async () => {
    const signInCalls = [];
    let plansCalls = 0;
    ctl.signInImpl = async (...args) => {
      signInCalls.push(args);
      ctl.authed = true;
    };
    ctl.getPlansImpl = async () => {
      plansCalls += 1;
      return { plan: 'free', prices: null };
    };
    const w = mountPaywall();
    usePaywall().open('settings');
    await flushPromises();
    expect(w.vm.view).toBe('signing');
    expect(w.find('[role="radio"]').exists()).toBe(false);
    w.vm.email = 'a@b.c';
    w.vm.password = 'long-enough-password';
    await w.vm.submitSignIn();
    await flushPromises();
    expect(signInCalls).toEqual([['a@b.c', 'long-enough-password']]);
    expect(plansCalls).toBeGreaterThanOrEqual(1);
    expect(w.vm.view).toBe('plans');
    expect(radios(w).length).toBe(3);
  });

  it('selecting a plan while signed out routes to sign-in and back', async () => {
    const calls = [];
    ctl.checkoutImpl = async (...args) => {
      calls.push(args);
      return { url: 'https://checkout.stripe.com/x' };
    };
    const w = mountPaywall();
    usePaywall().open('settings');
    await flushPromises();
    expect(w.vm.view).toBe('signing');
    ctl.signInImpl = async () => {
      ctl.authed = true;
    };
    // finishing sign-in lands back on plans with the choice intact
    w.vm.email = 'a@b.c';
    w.vm.password = 'long-enough-password';
    await w.vm.submitSignIn();
    await flushPromises();
    await w.vm.selectPlan('pro');
    await flushPromises();
    expect(calls.length).toBe(1);
  });

  it('failed sign-in keeps the form with the error message', async () => {
    ctl.signInImpl = async () => {
      throw new Error('Wrong password.');
    };
    const w = mountPaywall();
    usePaywall().open('settings');
    await flushPromises();
    w.vm.email = 'a@b.c';
    w.vm.password = 'long-enough-password';
    await w.vm.submitSignIn();
    await flushPromises();
    expect(w.vm.view).toBe('signing');
    expect(w.vm.signInError).toBe('Wrong password.');
  });
});

describe('PaywallDialog tablet (wide viewport, store billing)', () => {
  beforeEach(() => {
    ctl.isMobile = true;
    ctl.wide = true;
    ctl.products = [
      { productId: 'com.beavernotes.pro.monthly', formattedPrice: '$6.99' },
    ];
  });

  it('uses a centered 2-card grid with the pinned subscribe CTA', async () => {
    const w = mountPaywall();
    usePaywall().open('sync');
    await flushPromises();
    expect(w.vm.contentClass).toBe('max-w-lg');
    expect(radios(w).length).toBe(2);
    expect(w.text()).toContain('Subscribe');
    expect(w.text()).not.toContain('Team');
    // store billing has no per-card buttons: only the pinned CTA buys
    expect(w.html()).not.toContain("You're all set");
    expect(w.html()).not.toMatch(/createCheckout|checkout\.stripe\.com/);
  });
});

describe('PaywallDialog VAT caption', () => {
  it('shows the excl. VAT note on desktop (Stripe) and hides it for mobile IAP', async () => {
    const w = mountPaywall();
    await flushPromises();
    usePaywall().open('history');
    await flushPromises();
    expect(w.text()).toContain('VAT calculated at checkout');
    while (mounted.length) mounted.pop().unmount();
    ctl.isMobile = true;
    const m = mountPaywall();
    await flushPromises();
    expect(m.text()).not.toContain('VAT');
  });
});
