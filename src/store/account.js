import { defineStore } from 'pinia';
import { getSettingSync, setSetting } from '@/lib/settings';
import { PAID_PLANS, PLAN_NAMES } from '@/lib/api/types';
import {
  getActiveAccountId,
  listAccounts,
  loadIndex,
  removeAccountRecord,
  setActiveAccountId,
  upsertAccount,
} from '@/lib/accounts-index';
import { clearAllAccountStorage, loadSessionToken } from '@/lib/account-storage';

const PLAN_LIMITS_KEY = 'accountPlanLimits';

function getCachedPlanLimits() {
  const cached = getSettingSync(PLAN_LIMITS_KEY);
  if (!cached) return null;
  // Only trust it if it describes a plan we still know about.
  return typeof cached.plan === 'string' &&
    Number.isFinite(cached.quotaBytes) &&
    (cached.historyDays === null || Number.isFinite(cached.historyDays))
    ? cached
    : null;
}

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
    // Legacy fields for compat.
    profile: null,
    subscription: null,
    // Limits for the effective plan, from GET /plans. Falls back to the last
    // known good value so a down server does not blank the plan UI. Null until
    // either source has produced something.
    planLimits: getCachedPlanLimits(),
    devices: [],
    activeSessions: [],
    error: '',
    busy: false,
    seedStatus: 'idle',
    seedProgress: { total: 0, uploaded: 0, phase: '' },
    seedError: '',
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
      // Org subscription first, legacy fallback, fail-closed to free.
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

    // Null = not loaded yet, 0 = genuinely no history (free). Callers must treat
    // null as "unknown", not as "none".
    historyDays: (state) => state.planLimits?.historyDays ?? null,
    planQuotaBytes: (state) => state.planLimits?.quotaBytes ?? null,
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

    // Fail-closed: only http(s) URLs are stored. Returns false when refused.
    // Non-loopback cleartext is additionally blocked by the desktop CSP.
    setServerUrl(url) {
      const next = (url || '').trim().replace(/\/+$/, '');
      let protocol = '';
      try {
        protocol = new URL(next).protocol;
      } catch {
        return false;
      }
      if (protocol !== 'http:' && protocol !== 'https:') return false;
      this.serverUrl = next;
      return true;
    },

    setToken(token, accountId = this.activeAccountId) {
      // A refresh can land after the user switched away; the token belongs to the
      // account that made the call, not to whichever one is active by then.
      if (accountId && accountId !== this.activeAccountId) return;
      this.token = token || null;
    },

    setProfile(profile) {
      this.profile = profile || null;
    },

    setSubscription(subscription) {
      this.subscription = subscription || null;
    },

    setPlanLimits(limits) {
      this.planLimits = limits || null;
      // Fire and forget: the cache is an optimisation, never authoritative.
      setSetting(PLAN_LIMITS_KEY, limits || null).catch(() => {});
    },

    setDevices(devices) {
      this.devices = Array.isArray(devices) ? devices : [];
    },

    setActiveSessions(sessions) {
      this.activeSessions = Array.isArray(sessions) ? sessions : [];
    },

    // Multi-account actions

    // Restart path: the accounts and their cached lists come back from the index,
    // and whichever one was active is re-selected.
    async hydrateAccounts() {
      await loadIndex();
      this.accounts = listAccounts();
      const activeId = getActiveAccountId();
      if (activeId) await this.activateAccount(activeId);
    },

    // Swaps every per-account field in one pass. Unknown ids are refused: an id
    // that is not in the index must never become active.
    async activateAccount(accountId) {
      const account = listAccounts().find((a) => a.id === accountId);
      if (!account) return;
      this.accounts = listAccounts();
      setActiveAccountId(accountId);
      this.activeAccountId = accountId;
      this.token = await loadSessionToken(accountId);
      this.profile = account.profile ?? null;
      this.subscription = account.subscription ?? null;
      this.activeOrgId = account.activeOrgId ?? null;
      this.activeWorkspaceId = account.activeWorkspaceId ?? null;
      // Direct assignment: setPlanLimits would rewrite the install-level cache.
      this.planLimits = account.planLimits ?? null;
      // Only some API callers pass a base URL, so it has to follow the account.
      if (account.serverUrl) this.serverUrl = account.serverUrl;
      this.status = this.token ? 'authenticated' : 'anonymous';
    },

    // Signing in is what makes an account active, so saving the record of the
    // account just signed in also selects it.
    async persistActiveAccount(patch) {
      await upsertAccount(patch);
      await this.activateAccount(patch.id);
    },

    async forgetAccount(accountId) {
      const wasActive = this.activeAccountId === accountId;
      await removeAccountRecord(accountId);
      // Per-account slots only: the device registration is install-level and
      // belongs to the accounts that remain.
      await clearAllAccountStorage(accountId);
      const remaining = listAccounts();
      this.accounts = remaining;
      if (!wasActive) return;
      if (remaining.length) {
        await this.activateAccount(remaining[0].id);
        return;
      }
      this.activeAccountId = null;
      this.activeOrgId = null;
      this.activeWorkspaceId = null;
      this.token = null;
      this.profile = null;
      this.subscription = null;
      this.planLimits = null;
      this.status = 'anonymous';
    },

    removeAccount(accountId) {
      return this.forgetAccount(accountId);
    },

    setSeedStatus(status) {
      this.seedStatus = status;
    },

    setSeedProgress(progress) {
      this.seedProgress = progress;
    },

    setSeedError(message) {
      this.seedError = message || '';
    },
  },
});
