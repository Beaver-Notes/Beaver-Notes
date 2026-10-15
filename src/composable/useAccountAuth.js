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
import { getActiveAccountId, listAccounts } from '@/lib/accounts-index';
import * as authApi from '@/lib/api/auth';
import * as accountApi from '@/lib/api/account';
import { loadOrCreateIdentity, publishIdentity } from '@/utils/crypto/identity';
import { logger } from '@/utils/logger';

// The local workspace every install has (src-tauri/src/shared/mod.rs).
const DEFAULT_WORKSPACE_ID = 'default';

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
        // client.js already cleared the persisted token on this 401, so the session
        // is dead. Leaving the in-memory token would strand the app: REST reads
        // storage (anonymous) while ws-sync reads this store (still authenticating).
        accountStore.setToken(null);
        accountStore.setStatus('anonymous');
        console.warn('[auth] fetchProfile 401: session rejected, signing out');
      } else {
        console.error('[auth] fetchProfile failed:', err);
      }
      return null;
    }
  }

  async function ensureDeviceId() {
    let id = null;
    try {
      // The Rust id is installation-global and survives sign-out, the secure
      // blob does not; prefer it so a re-login keeps its published identity
      // (and session device_id matches account.device_keys).
      const { getSyncDeviceId } = await import('@/utils/sync/sync-repository.js');
      id = await getSyncDeviceId();
    } catch {
      id = null;
    }
    if (!id) {
      id = await loadAccountDeviceId().catch(() => null);
    }
    if (!id) {
      id =
        typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : `dev-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
    }
    try {
      await saveAccountDeviceId(id);
    } catch (err) {
      console.error('[auth] saveAccountDeviceId failed:', err);
    }
    return id;
  }

  async function performSignIn({ token, sessionToken, user, subscription, refreshToken = null, persist = true }) {
    // The passkey replies historically used `sessionToken` only; the server now
    // sends both names, and accepting either keeps sign-in working across a
    // version skew between this client and a deployed API.
    const sessionId = token || sessionToken;
    if (!sessionId) {
      throw new Error('Sign-in response did not include a session token.');
    }
    if (persist) {
      await persistToken(sessionId, user);
      // Keep the rotating refresh token beside the session so a later 401 can
      // be recovered silently instead of signing the user out.
      if (refreshToken) {
        try {
          const { saveRefreshToken } = await import('@/lib/account-storage');
          await saveRefreshToken(refreshToken);
        } catch (err) {
          console.error('[auth] persist refresh token failed:', err);
        }
      }
    }
    accountStore.setToken(sessionId);
    setStatus('authenticated');
    if (user) accountStore.setProfile(user);
    if (subscription) accountStore.setSubscription(subscription);
    await fetchProfile();
    // Re-arm realtime: a prior sign-out called `stop()`, which dropped every
    // provider. Without this, rooms stay dead until an app restart (L7).
    try {
      const { getWsSync } = await import('@/lib/sync/ws-sync.js');
      getWsSync().start();
    } catch (err) {
      console.warn('[auth] ws re-arm failed:', err?.message || err);
    }
    // E2E identity: ensure a keypair exists and the server knows its public key
    try {
      const identity = await loadOrCreateIdentity();
      const deviceId = await ensureDeviceId();
      const userKem = accountStore.profile?.kemPublicKey;
      if (!userKem || userKem !== identity.publicKeyHex) {
        await publishIdentity(identity, deviceId, activeBaseUrl());
        await fetchProfile();
      }
    } catch (err) {
      console.warn('[e2e] identity reconcile failed:', err?.message);
    }
    return { token: sessionId, user, subscription };
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
      await ensureDeviceId();
      const requestOptions = await authApi.passkeyLoginBegin(normalizedEmail, {
        baseUrl: activeBaseUrl(),
      });
      const result = await authApi.passkeyLoginComplete(
        normalizedEmail,
        { baseUrl: activeBaseUrl() },
        requestOptions
      );
      return performSignIn(result || {});
    });
  }

  async function signUpWithPasskey(email) {
    return runAuthFlow(async () => {
      const normalizedEmail = String(email || '').trim();
      if (!normalizedEmail) {
        throw new Error('Email is required.');
      }
      await ensureDeviceId();
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
      await ensureDeviceId();
      const result = await authApi.passwordLogin(normalizedEmail, password, {
        baseUrl: activeBaseUrl(),
      });
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
      await ensureDeviceId();
      const result = await authApi.passwordRegister(normalizedEmail, password, {
        baseUrl: activeBaseUrl(),
        kemPublicKey: identity.publicKeyHex,
        username: typeof username === 'string' ? username.trim().slice(0, 50) : undefined,
      });
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

  // Tear down everything owned by the signed-in account so the next account
  // cannot read or write the previous account's doc, store, or live rooms.
  async function teardownLocalAccountState() {
    // Persist buffered per-note Yjs deltas first: an edit inside the 300ms/2s
    // debounce window would otherwise be dropped when the store/doc are cleared.
    try {
      const { flushAllNoteYjsPending } = await import('@/composable/useNoteYjs.js');
      await flushAllNoteYjsPending();
    } catch (err) {
      console.warn('[auth] note delta flush failed:', err);
    }

    // Stop realtime providers first: no further remote updates land on a doc
    // that is about to be destroyed. Also clears room keys / unwrapped cache.
    try {
      const { getWsSync } = await import('@/lib/sync/ws-sync.js');
      getWsSync().stop();
    } catch (err) {
      console.warn('[auth] ws teardown failed:', err);
    }

    // Flush buffered meta writes before destroying the workspace doc singleton.
    try {
      const [{ flushPendingMetaUpdates }, { destroyWorkspaceDoc }] =
        await Promise.all([
          import('@/lib/yjs/workspace-doc.js'),
          import('@/lib/yjs/meta-doc.js'),
        ]);
      await flushPendingMetaUpdates();
      destroyWorkspaceDoc();
    } catch (err) {
      console.warn('[auth] workspace doc teardown failed:', err);
    }

    // Drop the previous account's notes from the in-memory store; the next
    // account hydrates its own from the workspace doc.
    try {
      const { useNoteStore, clearNoteContentSignatures } = await import('@/store/note');
      const noteStore = useNoteStore();
      noteStore.data = {};
      noteStore.syncInProgress = false;
      // The signatures hold note plaintext and outlive `data`, so they need
      // their own teardown.
      clearNoteContentSignatures();
    } catch (err) {
      console.warn('[auth] note store teardown failed:', err);
    }

    // Drop the collaboration state that carries decrypted text and emails.
    try {
      const [{ useCommentStore }, { useCollaboratorStore }, { useWorkspaceStore }] =
        await Promise.all([
          import('@/store/comment'),
          import('@/store/collaborator'),
          import('@/store/workspace'),
        ]);
      useCommentStore().reset();
      useCollaboratorStore().reset();
      useWorkspaceStore().reset();
    } catch (err) {
      console.warn('[auth] collaboration store teardown failed:', err);
    }

    // Drop the previous account's search index so search can't surface it.
    try {
      const { clearSearchIndex } = await import('@/utils/note/search.js');
      clearSearchIndex();
    } catch (err) {
      console.warn('[auth] search index teardown failed:', err);
    }
  }

  // In place, no reload: the leaving account is flushed and torn down while it
  // is still the active one, so nothing pending can be posted under the
  // arriving account's token.
  async function performSwitch({ accountId, workspaceId } = {}) {
    const accountStore = useAccountStore();
    const { useCloudWorkspaces, resetWorkspaceModuleState } = await import(
      '@/composable/useCloudWorkspaces.js'
    );
    const cloud = useCloudWorkspaces();
    const [{ useWorkspaceStore }, { runWorkspaceInit }] = await Promise.all([
      import('@/store/workspace'),
      import('@/composable/useAppShell'),
    ]);
    const record = listAccounts().find((account) => account.id === accountId);
    if (!record) return { switched: false, reason: 'unknown-account' };

    const targetWorkspaceId =
      workspaceId ||
      record.activeWorkspaceId ||
      record.workspaces?.[0]?.id ||
      DEFAULT_WORKSPACE_ID;

    // The pair, not the workspace alone: one workspace can legitimately appear
    // under two accounts.
    const currentWorkspaceId =
      useWorkspaceStore().activeId || cloud.activeId.value || accountStore.activeWorkspaceId;
    if (getActiveAccountId() === accountId && currentWorkspaceId === targetWorkspaceId) {
      return { switched: false, reason: 'already-active' };
    }

    await cloud.teardownLiveWorkspaceState();
    try {
      const [{ clearWorkspaceKeyCache }, { clearSharedSyncKeys }] = await Promise.all([
        import('@/lib/api/workspaces'),
        import('@/utils/sync/shared-keys'),
      ]);
      clearWorkspaceKeyCache();
      await clearSharedSyncKeys();
    } catch (err) {
      console.warn('[auth] leaving key material cleanup failed:', err?.message || err);
    }

    // The durable half first: if the pool swap fails the index still points at
    // the leaving account, so a relaunch is coherent.
    try {
      const { switchLocalWorkspace } = await import('@/lib/native/workspaces');
      await switchLocalWorkspace(targetWorkspaceId);
    } catch (err) {
      console.warn('[auth] workspace switch failed:', err?.message || err);
      await runWorkspaceInit().catch(() => {});
      return { switched: false, reason: 'workspace-switch-failed' };
    }

    await accountStore.activateAccount(accountId);
    accountStore.activeWorkspaceId = targetWorkspaceId;
    resetWorkspaceModuleState();
    cloud.activeId.value = targetWorkspaceId;
    // Re-runs the live init for the arriving account: profile, plans, identity
    // republish and the meta-room join all ride on it.
    await runWorkspaceInit();
    return { switched: true };
  }

  let switchInFlight = null;
  function switchAccount(options = {}) {
    // shortcut: a switch during a switch joins the first (a double-click);
    // upgrade to a queue if two different targets must both land.
    if (!switchInFlight) {
      switchInFlight = performSwitch(options).finally(() => {
        switchInFlight = null;
      });
    }
    return switchInFlight;
  }

  async function signOut() {
    try {
      await authApi.logout({ baseUrl: activeBaseUrl() });
    } catch (err) {
      console.warn('[auth] logout server call failed:', err);
    }
    try {
      const { stopRustSync } = await import('@/utils/sync/rust-shim.js');
      await stopRustSync();
    } catch {}
    await teardownLocalAccountState();
    await clearAllAccountStorage();
    resetApiClient();
    setStatus('anonymous');
    accountStore.setToken(null);
    accountStore.setProfile(null);
    accountStore.setSubscription(null);
    accountStore.setPlanLimits(null);
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
      try {
        const { stopRustSync } = await import('@/utils/sync/rust-shim.js');
        await stopRustSync();
      } catch {}
      await teardownLocalAccountState();
      await clearAllAccountStorage();
      resetApiClient();
      accountStore.removeAccount(accountStore.activeAccountId);
      if (accountStore.accounts.length === 0) {
        setStatus('anonymous');
        accountStore.setProfile(null);
        accountStore.setSubscription(null);
        accountStore.setPlanLimits(null);
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

  // A skipped seed used to return `false` with nothing recorded, so the
  // onboarding "seeding" phase resolved having done nothing. Report the reason
  // through the seedStatus/seedError pair the failure panel already renders.
  function skipSeed(reason, message) {
    logger.error(`[auth] cloud sync seed skipped: ${reason}`);
    accountStore.setSeedStatus('error');
    accountStore.setSeedError(message);
    return { started: false, reason };
  }

  async function triggerSeed(onProgress) {
    if (!accountStore.isAuthenticated) {
      return skipSeed('not-authenticated', 'Sign in to set up cloud sync.');
    }
    if (!accountStore.isPaidPlan) {
      return skipSeed(
        'plan-not-paid',
        'Cloud sync needs a paid plan. Your notes stay on this device.'
      );
    }

    const settings = await import('@/lib/settings');
    const transportSetting = settings.getSettingSync('syncTransport');
    const { normalizeSyncTransport } = await import('@/lib/api/types.js');
    if (normalizeSyncTransport(transportSetting) !== 'remote') {
      // Folder mode requires a chosen folder: an empty sync path means the
      // `folder` value is just the unset default (Settings sign-in never
      // writes syncTransport), so adopt remote for this paid account and seed.
      const syncPath = settings.getSettingSync('syncPath');
      if (accountStore.isPaidPlan && !String(syncPath ?? '').trim()) {
        await settings.setSetting('syncTransport', 'remote');
      } else {
        return skipSeed(
          'transport-not-remote',
          'Sync is set to a local folder, so there is no cloud copy to seed.'
        );
      }
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
      return { started: false, reason: 'start-failed' };
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
      return { started: false, reason: 'start-timeout' };
    }
    return { started: true, reason: null };
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
    switchAccount,
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
