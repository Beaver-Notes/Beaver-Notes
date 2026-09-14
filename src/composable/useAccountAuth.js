import { onMounted } from 'vue';
import { useAccountStore } from '@/store/account';
import {
  loadSessionToken,
  saveSessionToken,
  clearSessionToken,
  loadCachedProfile,
  saveCachedProfile,
  clearCachedProfile,
  loadAccountDeviceId,
  saveAccountDeviceId,
  clearAllAccountStorage,
} from '@/lib/account-storage';
import { resetApiClient } from '@/lib/api/client';
import * as authApi from '@/lib/api/auth';
import * as accountApi from '@/lib/api/account';
import { loadOrCreateIdentity, publishIdentity } from '@/utils/crypto/identity';
import { logger } from '@/utils/logger';

function deriveDeviceLabel() {
  if (typeof navigator === 'undefined') return 'Unknown device';
  const ua = navigator.userAgent || '';
  const platform = (navigator.platform || '').trim();
  const isMac = /Mac/.test(platform) || /Mac OS X/.test(ua);
  const isWindows = /Windows/.test(platform) || /Windows NT/.test(ua);
  const isLinux = /Linux/.test(platform) && !/Android/.test(ua);
  const isAndroid = /Android/.test(ua);
  const isIPhone = /iPhone/.test(ua);
  const isIPad =
    /iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);

  let os = 'Unknown OS';
  if (isMac) os = 'macOS';
  else if (isWindows) os = 'Windows';
  else if (isLinux) os = 'Linux';
  else if (isAndroid) os = 'Android';
  else if (isIPhone) os = 'iOS';
  else if (isIPad) os = 'iPadOS';

  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /Chrome\//.test(ua)
    ? 'Chrome'
    : /Firefox\//.test(ua)
    ? 'Firefox'
    : /Safari\//.test(ua)
    ? 'Safari'
    : 'Browser';

  return `${browser} on ${os}`;
}

function normalizeError(err) {
  if (!err) return 'Unknown error.';
  if (typeof err === 'string') return err;
  if (err.message) return err.message;
  return String(err);
}

// Rust emits `sync:progress` with these phases when it starts seeding or
// bootstrapping; either means the scheduler picked up the seed work.
const SEED_START_PHASES = new Set(['seed', 'bootstrap']);
const SEED_START_TIMEOUT_MS = 8000;
// Transient statuses keep the UI in "seeding" instead of failing the setup.
const SEED_TRANSIENT_STATUSES = new Set(['retrying', 'offline']);

let seedWatchUnlisten = [];

async function stopSeedWatch() {
  const unlisten = seedWatchUnlisten;
  seedWatchUnlisten = [];
  for (const fn of unlisten) {
    try {
      await fn();
    } catch {}
  }
}

export function useAccountAuth() {
  const accountStore = useAccountStore();

  function activeBaseUrl() {
    return accountStore.serverUrl;
  }

  function setAuthError(message) {
    accountStore.setError(message);
  }

  function clearAuthError() {
    accountStore.setError('');
  }

  function setStatus(status) {
    accountStore.setStatus(status);
  }

  async function persistToken(token, profile) {
    if (token) {
      try {
        await saveSessionToken(token);
      } catch (err) {
        console.error('[auth] persistToken failed:', err);
      }
    } else {
      await clearSessionToken();
    }
    if (profile) {
      try {
        await saveCachedProfile(profile);
      } catch (err) {
        console.error('[auth] persist profile failed:', err);
      }
    } else if (!token) {
      await clearCachedProfile();
    }
    resetApiClient();
  }

  async function fetchProfile() {
    try {
      const data = await accountApi.getAccount({ baseUrl: activeBaseUrl() });
      if (data) {
        accountStore.setProfile(data.profile);
        accountStore.setSubscription(data.subscription);
        accountStore.setDevices(data.devices || []);
        if (data.profile) {
          await saveCachedProfile(data.profile);
        }
        if (data.organizations?.length > 0) {
          const org = data.organizations[0];
          accountStore.activeOrgId = org.id;
          if (org.workspaces?.length > 0) {
            accountStore.activeWorkspaceId = org.workspaces[0].id;
          }
        }
      }
      return data;
    } catch (err) {
      if (err && err.status === 401) {
        // Keep auth on 401: may be wrong URL or transient, token still valid.
        console.warn('[auth] fetchProfile 401: keeping auth state, token may still be valid');
      } else {
        console.error('[auth] fetchProfile failed:', err);
      }
      return null;
    }
  }

  async function ensureDeviceId() {
    let id = await loadAccountDeviceId();
    if (!id) {
      id =
        typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : `dev-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
      try {
        await saveAccountDeviceId(id);
      } catch (err) {
        console.error('[auth] saveAccountDeviceId failed:', err);
      }
    }
    return id;
  }

  async function performSignIn({ token, user, subscription, persist = true }) {
    if (!token) {
      throw new Error('Sign-in response did not include a session token.');
    }
    if (persist) {
      await persistToken(token, user);
    }
    accountStore.setToken(token);
    setStatus('authenticated');
    if (user) accountStore.setProfile(user);
    if (subscription) accountStore.setSubscription(subscription);
    await fetchProfile();
    // E2E identity: ensure a keypair exists and the server knows its public key
    try {
      const identity = await loadOrCreateIdentity();
      const deviceId = await ensureDeviceId();
      const userKem = accountStore.profile?.kemPublicKey;
      if (!userKem || userKem !== identity.publicKeyHex) {
        await publishIdentity(identity, deviceId);
        await fetchProfile();
      }
    } catch (err) {
      console.warn('[e2e] identity reconcile failed:', err?.message);
    }
    return { token, user, subscription };
  }

  async function runAuthFlow(fn) {
    clearAuthError();
    setStatus('authenticating');
    accountStore.setBusy(true);
    try {
      return await fn();
    } catch (err) {
      setStatus('anonymous');
      setAuthError(normalizeError(err));
      throw err;
    } finally {
      accountStore.setBusy(false);
    }
  }

  async function signInWithPasskey(email) {
    return runAuthFlow(async () => {
      const normalizedEmail = String(email || '').trim();
      if (!normalizedEmail) {
        throw new Error('Email is required.');
      }
      const requestOptions = await authApi.passkeyLoginBegin(normalizedEmail, {
        baseUrl: activeBaseUrl(),
      });
      const result = await authApi.passkeyLoginComplete(
        normalizedEmail,
        { baseUrl: activeBaseUrl() },
        requestOptions
      );
      await ensureDeviceId();
      return performSignIn(result || {});
    });
  }

  async function signUpWithPasskey(email) {
    return runAuthFlow(async () => {
      const normalizedEmail = String(email || '').trim();
      if (!normalizedEmail) {
        throw new Error('Email is required.');
      }
      const deviceLabel = deriveDeviceLabel();
      const createOptions = await authApi.passkeyRegisterBegin(
        normalizedEmail,
        deviceLabel,
        { baseUrl: activeBaseUrl() }
      );
      const result = await authApi.passkeyRegisterComplete(
        normalizedEmail,
        { baseUrl: activeBaseUrl() },
        createOptions
      );
      await ensureDeviceId();
      return performSignIn(result || {});
    });
  }

  async function signInWithPassword(email, password) {
    return runAuthFlow(async () => {
      const normalizedEmail = String(email || '').trim();
      if (!normalizedEmail || !password) {
        throw new Error('Email and password are required.');
      }
      const result = await authApi.passwordLogin(normalizedEmail, password, {
        baseUrl: activeBaseUrl(),
      });
      await ensureDeviceId();
      return performSignIn(result || {});
    });
  }

  async function signUpWithPassword(email, password, username) {
    return runAuthFlow(async () => {
      const normalizedEmail = String(email || '').trim();
      if (!normalizedEmail || !password) {
        throw new Error('Email and password are required.');
      }
      if (password.length < 12) {
        throw new Error('Password must be at least 12 characters.');
      }
      const identity = await loadOrCreateIdentity();
      const result = await authApi.passwordRegister(normalizedEmail, password, {
        baseUrl: activeBaseUrl(),
        kemPublicKey: identity.publicKeyHex,
        username: typeof username === 'string' ? username.trim().slice(0, 50) : undefined,
      });
      await ensureDeviceId();
      return performSignIn(result || {});
    });
  }

  async function startQuickConnect() {
    clearAuthError();
    try {
      const result = await authApi.quickConnectInitiate({
        baseUrl: activeBaseUrl(),
      });
      return result;
    } catch (err) {
      setAuthError(normalizeError(err));
      throw err;
    }
  }

  async function pollQuickConnect(secret) {
    try {
      const result = await authApi.quickConnectPoll(secret, {
        baseUrl: activeBaseUrl(),
      });
      if (result && result.authorized && result.payload) {
        await performSignIn({ token: result.payload });
      }
      return result;
    } catch (err) {
      setAuthError(normalizeError(err));
      throw err;
    }
  }

  async function authorizeQuickConnect(code, payload = null) {
    clearAuthError();
    try {
      return await authApi.quickConnectAuthorize(code, payload, {
        baseUrl: activeBaseUrl(),
      });
    } catch (err) {
      setAuthError(normalizeError(err));
      throw err;
    }
  }

  async function signOut() {
    try {
      await authApi.logout({ baseUrl: activeBaseUrl() });
    } catch (err) {
      console.warn('[auth] logout server call failed:', err);
    }
    await clearAllAccountStorage();
    resetApiClient();
    try {
      const { stopRustSync } = await import('@/utils/sync/rust-shim.js');
      await stopRustSync();
    } catch {}
    setStatus('anonymous');
    accountStore.setToken(null);
    accountStore.setProfile(null);
    accountStore.setSubscription(null);
    accountStore.setDevices([]);
    accountStore.setActiveSessions([]);
  }

  async function signOutEverywhere() {
    clearAuthError();
    try {
      const result = await authApi.revokeAllSessions({
        baseUrl: activeBaseUrl(),
        keepCurrent: true,
      });
      return result;
    } catch (err) {
      setAuthError(normalizeError(err));
      throw err;
    }
  }

  async function listActiveSessions() {
    try {
      const sessions = await authApi.listSessions({
        baseUrl: activeBaseUrl(),
      });
      accountStore.setActiveSessions(sessions || []);
      return sessions || [];
    } catch (err) {
      setAuthError(normalizeError(err));
      throw err;
    }
  }

  async function revokeActiveSession(id) {
    try {
      await authApi.revokeSession(id, { baseUrl: activeBaseUrl() });
      await listActiveSessions();
    } catch (err) {
      setAuthError(normalizeError(err));
      throw err;
    }
  }

  async function refreshProfile() {
    return fetchProfile();
  }

  async function revokeDevice(deviceId) {
    try {
      await accountApi.deleteDevice(deviceId, {
        baseUrl: activeBaseUrl(),
      });
      await fetchProfile();
    } catch (err) {
      setAuthError(normalizeError(err));
      throw err;
    }
  }

  async function deleteAccount(password) {
    clearAuthError();
    accountStore.setBusy(true);
    try {
      await accountApi.deleteAccount(password, { baseUrl: activeBaseUrl() });
      await clearAllAccountStorage();
      resetApiClient();
      accountStore.removeAccount(accountStore.activeAccountId);
      if (accountStore.accounts.length === 0) {
        setStatus('anonymous');
        accountStore.setProfile(null);
        accountStore.setSubscription(null);
        accountStore.setDevices([]);
        accountStore.setActiveSessions([]);
      }
    } catch (err) {
      setAuthError(normalizeError(err));
      throw err;
    } finally {
      accountStore.setBusy(false);
    }
  }

  async function hydrate() {
    const token = await loadSessionToken();
    if (!token) {
      setStatus('anonymous');
      const cached = await loadCachedProfile();
      if (cached) {
        accountStore.setProfile(cached);
      }
      return false;
    }
    accountStore.setToken(token);
    setStatus('authenticated');
    const cached = await loadCachedProfile();
    if (cached) accountStore.setProfile(cached);
    await ensureDeviceId();
    await fetchProfile();
    return true;
  }

  async function triggerSeed(onProgress) {
    if (!accountStore.isAuthenticated) return false;
    if (!accountStore.isPaidPlan) return false;

    const transportSetting = await import('@/lib/settings').then(
      (m) => m.getSettingSync('syncTransport')
    );
    const { normalizeSyncTransport } = await import('@/lib/api/types.js');
    if (transportSetting && normalizeSyncTransport(transportSetting) !== 'remote') {
      return false;
    }

    accountStore.setSeedStatus('seeding');
    accountStore.setSeedError('');
    accountStore.setSeedProgress({ phase: 'starting', uploaded: 0, total: 0 });

    // Listen before starting the scheduler: Rust runs a tick immediately on
    // `sync:start`, so subscribing afterwards would race the first `seed`.
    await stopSeedWatch();
    const { backend } = await import('@/lib/tauri-bridge');
    const { describeStatus } = await import('@/store/sync-progress');

    let resolveStarted;
    const started = new Promise((resolve) => {
      resolveStarted = resolve;
    });
    let settled = false;
    let sawActivity = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolveStarted();
    };

    const handleProgress = (payload) => {
      const phase = payload?.phase;
      if (!phase) return;
      sawActivity = true;
      const progress = {
        phase,
        uploaded: payload.processed || 0,
        total: payload.total || 0,
      };
      accountStore.setSeedProgress(progress);
      onProgress?.(progress);
      if (SEED_START_PHASES.has(phase)) finish();
      if (phase === 'done') {
        accountStore.setSeedStatus('done');
        stopSeedWatch();
      }
    };

    const onStatus = (payload) => {
      const status = payload?.status;
      if (!status || status === 'syncing' || status === 'idle') return;
      if (status === 'complete') {
        if (accountStore.seedStatus === 'seeding') {
          accountStore.setSeedStatus('done');
        }
        stopSeedWatch();
        return;
      }
      if (SEED_TRANSIENT_STATUSES.has(status)) return;
      const described = describeStatus(status, payload?.message);
      accountStore.setSeedStatus('error');
      accountStore.setSeedError(
        described?.text || payload?.message || 'Sync setup failed.',
      );
      finish();
      stopSeedWatch();
    };

    const onError = (payload) => {
      accountStore.setSeedStatus('error');
      accountStore.setSeedError(payload?.message || 'Sync setup failed.');
      finish();
      stopSeedWatch();
    };

    seedWatchUnlisten = [
      await backend.listenPayload('sync:progress', handleProgress),
      await backend.listenPayload('sync:status', onStatus),
      await backend.listenPayload('sync:error', onError),
    ];

    try {
      const { initAppSync } = await import('@/utils/sync/app-sync.js');
      const { startRustSync, kickRustSync } = await import(
        '@/utils/sync/rust-shim.js'
      );
      await initAppSync();
      // initAppSync may skip when no target is configured; seed always has a
      // cloud target, so start the scheduler explicitly to reset its guards.
      await startRustSync();
      kickRustSync();
    } catch (err) {
      logger.error('[auth] seed failed:', err?.message || err);
      accountStore.setSeedStatus('error');
      accountStore.setSeedError(err?.message || 'Sync setup failed.');
      await stopSeedWatch();
      return false;
    }

    await Promise.race([
      started,
      new Promise((resolve) => setTimeout(resolve, SEED_START_TIMEOUT_MS)),
    ]);

    if (!settled && !sawActivity) {
      logger.error('[auth] seed did not start within timeout');
      accountStore.setSeedStatus('error');
      accountStore.setSeedError('Sync setup timed out.');
      await stopSeedWatch();
      return false;
    }
    return true;
  }

  onMounted(() => {
    hydrate().catch((err) => console.error('[auth] hydrate failed:', err));
  });

  return {
    signInWithPasskey,
    signUpWithPasskey,
    signInWithPassword,
    signUpWithPassword,
    startQuickConnect,
    pollQuickConnect,
    authorizeQuickConnect,
    signOut,
    signOutEverywhere,
    listActiveSessions,
    revokeActiveSession,
    refreshProfile,
    revokeDevice,
    deleteAccount,
    hydrate,
    deriveDeviceLabel,
    triggerSeed,
  };
}
