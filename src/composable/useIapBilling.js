import { ref } from 'vue';
import { isMobileRuntime, isIOSRuntime } from '@/lib/tauri/runtime';

export const IAP_PRODUCT_IDS = {
  'starter-monthly': 'com.beavernotes.starter.monthly',
  'starter-yearly': 'com.beavernotes.starter.yearly',
  'pro-monthly': 'com.beavernotes.pro.monthly',
  'pro-yearly': 'com.beavernotes.pro.yearly',
};

const REVERSE = Object.fromEntries(
  Object.entries(IAP_PRODUCT_IDS).map(([k, v]) => [v, k]),
);

export function planFromProductId(productId) {
  const key = REVERSE[productId];
  if (!key) return null;
  const [plan, interval] = key.split('-');
  return { plan, interval };
}

export const MOBILE_PLANS = [
  { plan: 'starter', interval: 'monthly' },
  { plan: 'starter', interval: 'yearly' },
  { plan: 'pro', interval: 'monthly' },
  { plan: 'pro', interval: 'yearly' },
];

async function loadIap() {
  return import('@choochmeque/tauri-plugin-iap-api');
}

export function useIapBilling({ accountStore } = {}) {
  const products = ref([]);
  const loading = ref(false);
  const error = ref('');
  const isMobile = isMobileRuntime();

  async function loadProducts() {
    loading.value = true;
    error.value = '';
    try {
      const iap = await loadIap();
      products.value = await iap.getProducts(Object.values(IAP_PRODUCT_IDS), 'subs');
      await subscribeUpdates(iap);
    } catch (e) {
      error.value = e?.message || 'Store unavailable. Please try again.';
    } finally {
      loading.value = false;
    }
  }

  let updatesSubscribed = false;
  async function subscribeUpdates(iap) {
    if (updatesSubscribed) return;
    updatesSubscribed = true;
    const { useAccountAuth } = await import('@/composable/useAccountAuth');
    await iap
      .onPurchaseUpdated(() => useAccountAuth().refreshProfile().catch(() => {}))
      .catch(() => {});
  }

  async function pollForProvision(refreshProfile, tries = 20) {
    for (let i = 0; i < tries; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      const data = await refreshProfile().catch(() => null);
      const plan = data?.subscription?.plan;
      if (plan === 'starter' || plan === 'pro') return plan;
    }
    return null;
  }

  async function buy(plan, interval) {
    const { useAccountAuth } = await import('@/composable/useAccountAuth');
    const { refreshProfile } = useAccountAuth();
    const productId = IAP_PRODUCT_IDS[`${plan}-${interval}`];
    if (!productId) throw new Error(`No store product for ${plan}/${interval}`);
    const iap = await loadIap();
    // ponytail: accountId is crypto.randomUUID, maps 1:1 to Apple's appAccountToken
    const accountId = accountStore?.profile?.id ?? accountStore?.activeAccountId;
    const options = isIOSRuntime()
      ? { appAccountToken: accountId }
      : { obfuscatedAccountId: accountId };
    let result;
    try {
      result = await iap.purchase(productId, 'subs', options);
    } catch (e) {
      if (/cancel/i.test(e?.message || String(e))) return null;
      throw e;
    }
    if (!isIOSRuntime() && result?.purchaseToken) {
      await iap.acknowledgePurchase(result.purchaseToken).catch(() => {});
    }
    return pollForProvision(refreshProfile);
  }

  async function restore() {
    const { useAccountAuth } = await import('@/composable/useAccountAuth');
    const { refreshProfile } = useAccountAuth();
    const iap = await loadIap();
    const restored = await iap.restorePurchases('subs');
    if (!isIOSRuntime() && Array.isArray(restored)) {
      for (const p of restored) {
        if (p?.purchaseToken && !p?.isAcknowledged) {
          await iap.acknowledgePurchase(p.purchaseToken).catch(() => {});
        }
      }
    }
    return refreshProfile();
  }

  async function openManage() {
    const url = isIOSRuntime()
      ? 'itms-apps://apps.apple.com/account/subscriptions'
      : 'https://play.google.com/store/account/subscriptions';
    try {
      const { openUrl } = await import('@tauri-apps/plugin-opener');
      await openUrl(url);
    } catch {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  }

  return { isMobile, products, loading, error, loadProducts, buy, restore, openManage };
}
