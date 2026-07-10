import { defineStore } from 'pinia';
import { getSettingSync } from '@/composable/settings';
import { PAID_PLANS } from '@/lib/api/types';

export const useAccountStore = defineStore('account', {
  state: () => ({
    status: 'anonymous',
    serverUrl:
      getSettingSync('beaverAccountServerUrl') || 'https://api.beavernotes.com',
    profile: null,
    subscription: null,
    devices: [],
    activeSessions: [],
    error: '',
    busy: false,
  }),

  getters: {
    isAuthenticated: (state) => state.status === 'authenticated',
    isAnonymous: (state) => state.status === 'anonymous',
    isAuthenticating: (state) => state.status === 'authenticating',
    hasAccount: (state) => state.status === 'authenticated',

    plan(state) {
      return state.subscription?.plan ?? null;
    },

    isPaidPlan(state) {
      return PAID_PLANS.includes(state.subscription?.plan);
    },

    canUseCloudSync(state) {
      if (state.status !== 'authenticated') return false;
      return this.isPaidPlan;
    },

    storageUsedBytes: (state) => state.subscription?.storage?.usedBytes ?? 0,
    storageQuotaBytes: (state) => state.subscription?.storage?.quotaBytes ?? 0,
    storageUsedPercent: (state) =>
      state.subscription?.storage?.usedPercent ?? 0,
  },

  actions: {
    setStatus(status) {
      this.status = status;
    },

    setError(message) {
      this.error = message || '';
    },

    setBusy(value) {
      this.busy = !!value;
    },

    setServerUrl(url) {
      this.serverUrl = (url || '').trim();
    },

    setProfile(profile) {
      this.profile = profile || null;
    },

    setSubscription(subscription) {
      this.subscription = subscription || null;
    },

    setDevices(devices) {
      this.devices = Array.isArray(devices) ? devices : [];
    },

    setActiveSessions(sessions) {
      this.activeSessions = Array.isArray(sessions) ? sessions : [];
    },
  },
});
