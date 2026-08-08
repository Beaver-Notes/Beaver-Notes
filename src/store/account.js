import { defineStore } from 'pinia';
import { getSettingSync } from '@/composable/settings';
import { PAID_PLANS } from '@/lib/api/types';

export const useAccountStore = defineStore('account', {
  state: () => ({
    status: 'anonymous',
    serverUrl:
      getSettingSync('beaverAccountServerUrl') || 'https://api.beavernotes.com',
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
    isAuthenticated: (state) => state.status === 'authenticated',
    isAnonymous: (state) => state.status === 'anonymous',
    isAuthenticating: (state) => state.status === 'authenticating',
    hasAccount: (state) => state.status === 'authenticated',

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

    activeWorkspace: (state) => {
      const org = this.activeOrg;
      return (
        org?.workspaces?.find((w) => w.id === state.activeWorkspaceId) ??
        null
      );
    },

    allAccounts: (state) => state.accounts,

    plan(state) {
      // Prefer org subscription, fall back to legacy
      return this.activeOrg?.subscription?.plan ?? state.subscription?.plan ?? null;
    },

    isPaidPlan(state) {
      const p = this.activeOrg?.subscription?.plan ?? state.subscription?.plan;
      return PAID_PLANS.includes(p);
    },

    canUseCloudSync(state) {
      if (state.status !== 'authenticated') return false;
      return this.isPaidPlan;
    },

    storageUsedBytes: (state) =>
      this.activeOrg?.subscription?.storageUsedBytes ??
      state.subscription?.storage?.usedBytes ??
      0,
    storageQuotaBytes: (state) =>
      this.activeOrg?.subscription?.storageQuotaBytes ??
      state.subscription?.storage?.quotaBytes ??
      0,
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

    // Multi-account actions
    addAccount(account) {
      this.accounts.push(account);
      this.activeAccountId = account.id;
      // Set default org and workspace
      if (account.organizations?.length > 0) {
        this.activeOrgId = account.organizations[0].id;
        if (account.organizations[0].workspaces?.length > 0) {
          this.activeWorkspaceId = account.organizations[0].workspaces[0].id;
        }
      }
    },

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

    switchAccount(accountId) {
      this.activeAccountId = accountId;
      const account = this.accounts.find((a) => a.id === accountId);
      if (account) {
        this.activeOrgId = account.organizations?.[0]?.id ?? null;
        this.activeWorkspaceId =
          account.organizations?.[0]?.workspaces?.[0]?.id ?? null;
      }
    },

    switchOrg(orgId) {
      this.activeOrgId = orgId;
      const org = this.activeOrg;
      if (org) {
        this.activeWorkspaceId = org.workspaces?.[0]?.id ?? null;
      }
    },

    switchWorkspace(workspaceId) {
      this.activeWorkspaceId = workspaceId;
    },

    setSeedStatus(status) {
      this.seedStatus = status;
    },

    setSeedProgress(progress) {
      this.seedProgress = progress;
    },
  },
});
