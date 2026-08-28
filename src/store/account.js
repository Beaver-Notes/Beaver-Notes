import { defineStore } from 'pinia';
import { getSettingSync } from '@/lib/settings';
import { PAID_PLANS, PLAN_NAMES } from '@/lib/api/types';

export const useAccountStore = defineStore('account', {
  state: () => ({
    status: 'anonymous',
    serverUrl:
      getSettingSync('beaverAccountServerUrl') || 'https://api.beavernotes.com',
    token: null,
    accounts: [],
    activeAccountId: null,
    activeOrgId: null,
    activeWorkspaceId: null,
    // Legacy fields kept for backward compatibility
    profile: null,
    subscription: null,
    devices: [],
    activeSessions: [],
    error: '',
    busy: false,
    seedStatus: 'idle',
    seedProgress: { total: 0, uploaded: 0, phase: '' },
  }),

  getters: {
    isAuthenticated: (state) => state.status === 'authenticated' && !!state.token,
    isAnonymous: (state) => state.status === 'anonymous',

    activeAccount: (state) =>
      state.accounts.find((a) => a.id === state.activeAccountId) ?? null,

    activeOrg: (state) => {
      const account = state.accounts.find(
        (a) => a.id === state.activeAccountId,
      );
      return (
        account?.organizations?.find((o) => o.id === state.activeOrgId) ??
        null
      );
    },

    plan(state) {
      // Prefer org subscription, fall back to legacy — fail-closed to free
      return this.activeOrg?.subscription?.plan ?? state.subscription?.plan ?? PLAN_NAMES.FREE;
    },

    isPaidPlan(state) {
      const p = this.activeOrg?.subscription?.plan ?? state.subscription?.plan;
      return PAID_PLANS.includes(p);
    },

    canUseCloudSync(state) {
      if (state.status !== 'authenticated') return false;
      return this.isPaidPlan;
    },

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

    setToken(token) {
      this.token = token || null;
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

    // Multi-account actions
    removeAccount(accountId) {
      this.accounts = this.accounts.filter((a) => a.id !== accountId);
      if (this.activeAccountId === accountId) {
        this.activeAccountId = this.accounts[0]?.id ?? null;
        if (this.activeAccountId) {
          const account = this.accounts[0];
          this.activeOrgId = account.organizations?.[0]?.id ?? null;
          this.activeWorkspaceId =
            account.organizations?.[0]?.workspaces?.[0]?.id ?? null;
        }
      }
    },

    setSeedStatus(status) {
      this.seedStatus = status;
    },

    setSeedProgress(progress) {
      this.seedProgress = progress;
    },
  },
});
