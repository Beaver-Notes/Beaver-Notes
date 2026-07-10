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
} from '@/composable/useAccountStorage';
import { getApiClient, resetApiClient } from '@/lib/api/client';
import * as authApi from '@/lib/api/auth';
import * as accountApi from '@/lib/api/account';

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

function buildClient(baseUrl, token) {
  return getApiClient(
    baseUrl
      ? {
          baseUrl,
          getToken: async () => token,
        }
      : {
          getToken: async () => token,
        }
  );
}

function normalizeError(err) {
  if (!err) return 'Unknown error.';
  if (typeof err === 'string') return err;
  if (err.message) return err.message;
  return String(err);
}

export function useAccountAuth() {
  const accountStore = useAccountStore();
  let currentToken = null;

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
    currentToken = token || null;
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
      }
      return data;
    } catch (err) {
      if (err && err.status === 401) {
        await clearAllAccountStorage();
        currentToken = null;
        resetApiClient();
        setStatus('anonymous');
        accountStore.setProfile(null);
        accountStore.setSubscription(null);
        accountStore.setDevices([]);
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
    } else {
      currentToken = token;
    }
    setStatus('authenticated');
    if (user) accountStore.setProfile(user);
    if (subscription) accountStore.setSubscription(subscription);
    await fetchProfile();
    return { token, user, subscription };
  }

  async function signInWithPasskey(email) {
    clearAuthError();
    setStatus('authenticating');
    accountStore.setBusy(true);
    try {
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
    } catch (err) {
      setStatus('anonymous');
      setAuthError(normalizeError(err));
      throw err;
    } finally {
      accountStore.setBusy(false);
    }
  }

  async function signUpWithPasskey(email) {
    clearAuthError();
    setStatus('authenticating');
    accountStore.setBusy(true);
    try {
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
    } catch (err) {
      setStatus('anonymous');
      setAuthError(normalizeError(err));
      throw err;
    } finally {
      accountStore.setBusy(false);
    }
  }

  async function signInWithPassword(email, password) {
    clearAuthError();
    setStatus('authenticating');
    accountStore.setBusy(true);
    try {
      const normalizedEmail = String(email || '').trim();
      if (!normalizedEmail || !password) {
        throw new Error('Email and password are required.');
      }
      const result = await authApi.passwordLogin(normalizedEmail, password, {
        baseUrl: activeBaseUrl(),
      });
      await ensureDeviceId();
      return performSignIn(result || {});
    } catch (err) {
      setStatus('anonymous');
      setAuthError(normalizeError(err));
      throw err;
    } finally {
      accountStore.setBusy(false);
    }
  }

  async function signUpWithPassword(email, password) {
    clearAuthError();
    setStatus('authenticating');
    accountStore.setBusy(true);
    try {
      const normalizedEmail = String(email || '').trim();
      if (!normalizedEmail || !password) {
        throw new Error('Email and password are required.');
      }
      if (password.length < 12) {
        throw new Error('Password must be at least 12 characters.');
      }
      const result = await authApi.passwordRegister(normalizedEmail, password, {
        baseUrl: activeBaseUrl(),
      });
      await ensureDeviceId();
      return performSignIn(result || {});
    } catch (err) {
      setStatus('anonymous');
      setAuthError(normalizeError(err));
      throw err;
    } finally {
      accountStore.setBusy(false);
    }
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
    currentToken = null;
    resetApiClient();
    setStatus('anonymous');
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
      currentToken = null;
      resetApiClient();
      setStatus('anonymous');
      accountStore.setProfile(null);
      accountStore.setSubscription(null);
      accountStore.setDevices([]);
      accountStore.setActiveSessions([]);
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
    currentToken = token;
    setStatus('authenticated');
    const cached = await loadCachedProfile();
    if (cached) accountStore.setProfile(cached);
    await ensureDeviceId();
    await fetchProfile();
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
  };
}
