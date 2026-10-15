import {
  loadSessionToken,
  clearSessionToken,
} from '@/lib/account-storage';

async function defaultGetDeviceId() {
  try {
    const { loadAccountDeviceId } = await import('@/lib/account-storage');
    return await loadAccountDeviceId();
  } catch {
    return null;
  }
}

async function defaultGetDeviceLabel() {
  try {
    const { getDeviceModel } = await import('@/utils/device/device-model');
    return getDeviceModel() || null;
  } catch {
    return null;
  }
}

const DEFAULT_TIMEOUT_MS = 15000;

// Shared by every client instance: `getApiClient(overrides)` hands out more
// than one, and two instances refreshing at once each present the same
// pre-rotation token — the second looks like a replay and burns the family.
let refreshInFlight = null;
const DEFAULT_API_URL =
  (typeof import.meta !== 'undefined' &&
    import.meta.env?.VITE_BEAVER_SYNC_API_URL) ||
  'https://api.beavernotes.com';

export class ApiError extends Error {
  constructor(message, { status, code, body, cause } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.body = body;
    if (cause) this.cause = cause;
  }

  get isAuthError() {
    return this.status === 401 || this.status === 403;
  }

  get isRateLimit() {
    return this.status === 429;
  }

  get isServerError() {
    return this.status >= 500;
  }
}

function resolveBaseUrl(override) {
  const raw = (override || DEFAULT_API_URL || '').trim().replace(/\/+$/, '');
  if (!raw) throw new ApiError('Beaver Sync server URL is not configured.');

  return raw;
}

function buildUrl(base, path, query) {
  if (!path.startsWith('/')) path = `/${path}`;
  let url = `${base}${path}`;
  if (query && typeof query === 'object') {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value == null) continue;
      search.append(key, String(value));
    }
    const qs = search.toString();
    if (qs) url += `?${qs}`;
  }
  return url;
}

function withTimeout(signal, ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    // Name the reason so the catch below can tell our timeout from a caller abort.
    const reason = new Error('Request timed out');
    reason.name = 'TimeoutError';
    controller.abort(reason);
  }, ms);
  if (signal) {
    if (signal.aborted) controller.abort(signal.reason);
    else
      signal.addEventListener('abort', () => controller.abort(signal.reason), {
        once: true,
      });
  }
  return {
    signal: controller.signal,
    cancel: () => clearTimeout(timer),
  };
}

async function readBody(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function readBodyBinary(response) {
  const buf = await response.arrayBuffer();
  return new Uint8Array(buf);
}

function normalizeError(status, body) {
  if (body && typeof body === 'object') {
    if (body.error && body.message) {
      return new ApiError(body.message, { status, code: body.error, body });
    }
    if (body.message) {
      return new ApiError(body.message, { status, body });
    }
  }
  if (typeof body === 'string' && body.trim()) {
    return new ApiError(body, { status, body });
  }
  return new ApiError(`Request failed with status ${status}`, { status, body });
}

export function createApiClient({
  baseUrl,
  getToken = loadSessionToken,
  clearToken = clearSessionToken,
  getDeviceId = defaultGetDeviceId,
  getDeviceLabel = defaultGetDeviceLabel,
  defaultTimeoutMs = DEFAULT_TIMEOUT_MS,
  fetchImpl = typeof fetch !== 'undefined' ? fetch.bind(globalThis) : null,
} = {}) {
  if (!fetchImpl) {
    throw new Error('No fetch implementation available.');
  }

  const base = resolveBaseUrl(baseUrl);

  async function request(method, path, options = {}) {
    const {
      body,
      query,
      headers = {},
      timeoutMs = defaultTimeoutMs,
      signal,
      auth = true,
      contentType,
      responseType,
    } = options;

    const url = buildUrl(base, path, query);
    const finalHeaders = { Accept: 'application/json', ...headers };

    let payload;
    if (body != null) {
      if (
        body instanceof FormData ||
        body instanceof ArrayBuffer ||
        body instanceof Blob
      ) {
        payload = body;
      } else if (body instanceof Uint8Array) {
        payload = body;
      } else {
        finalHeaders['Content-Type'] = contentType || 'application/json';
        payload = JSON.stringify(body);
      }
    }

    if (auth) {
      const token = await getToken();
      if (token) {
        finalHeaders['Authorization'] = `Bearer ${token}`;
      }
    }

    const deviceId = await getDeviceId().catch(() => null);
    if (deviceId) {
      finalHeaders['X-Device-Id'] = deviceId;
    }

    const deviceLabel = await getDeviceLabel().catch(() => null);
    if (deviceLabel) {
      finalHeaders['X-Device-Label'] = deviceLabel;
    }

    const { signal: timeoutSignal, cancel } = withTimeout(signal, timeoutMs);

    let response;
    try {
      response = await fetchImpl(url, {
        method,
        headers: finalHeaders,
        body: payload,
        signal: timeoutSignal,
        credentials: 'omit',
      });
    } catch (err) {
      cancel();
      throw new ApiError(
        err?.name === 'TimeoutError'
          ? 'Request timed out.'
          : err?.name === 'AbortError'
            ? 'Request was aborted.'
            : 'Network error.',
        { status: 0, code: 'network_error', cause: err }
      );
    }
    cancel();

    if (response.status === 204) return null;

    if (responseType === 'arraybuffer') {
      if (!response.ok) {
        const body2 = await readBody(response).catch(() => null);
        throw normalizeError(response.status, body2);
      }
      return readBodyBinary(response);
    }

    const body2 = await readBody(response).catch(() => null);

    if (!response.ok) {
      if (response.status === 401 && auth && !options?.retriedAfterRefresh) {
        // A 401 is recoverable: the session can lapse while the refresh token
        // is still good. Refresh once, retry the call, and only sign the user
        // out when that fails.
        let refreshed = false;
        try {
          refreshed = await tryRefreshToken();
        } catch (err) {
          console.warn('[api] refresh attempt failed:', err);
        }
        if (refreshed) {
          return request(method, path, { ...options, retriedAfterRefresh: true });
        }
        try {
          await clearToken();
        } catch (err) {
          console.warn('[api] failed to clear token on 401:', err);
        }
        // The credential is dead. Clearing only the stored copy left the store
        // reporting `authenticated`, so the app looked signed in while nothing
        // could succeed. Sign the local state out so it asks for a new sign-in
        // (the sync banner already says so) instead of failing silently.
        try {
          const { useAccountStore } = await import('@/store/account');
          const store = useAccountStore();
          store.setToken(null);
          store.setStatus('anonymous');
        } catch (err) {
          console.warn('[api] could not reset the account store after a dead session:', err);
        }
      }
      throw normalizeError(response.status, body2);
    }

    return body2;
  }

  // One refresh at a time (see the module-scoped `refreshInFlight` above):
  // concurrent 401s must not each rotate the token, or the loser of the race
  // would present an already-rotated value and trip the replay guard, killing
  // the whole family.
  function tryRefreshToken() {
    if (!refreshInFlight) {
      refreshInFlight = (async () => {
        const { loadRefreshToken, saveRefreshToken, saveSessionToken, clearRefreshToken } = await import('@/lib/account-storage');
        const refreshToken = await loadRefreshToken();
        if (!refreshToken) return false;
        let data;
        try {
          data = await request('POST', '/auth/refresh', { auth: false, body: { refreshToken } });
        } catch (err) {
          // A rejected refresh token is dead for good; clearing it stops every
          // later request retrying a burnt credential.
          if (err?.status === 401) await clearRefreshToken();
          return false;
        }
        if (!data?.token) return false;
        await saveSessionToken(data.token);
        if (data.refreshToken) await saveRefreshToken(data.refreshToken);
        // The rest of the app reads the token from the store, so a refreshed
        // session has to land there too or nothing but this HTTP client recovers.
        try {
          const { useAccountStore } = await import('@/store/account');
          useAccountStore().setToken(data.token);
        } catch (err) {
          console.warn('[api] could not sync refreshed token to the store:', err);
        }
        // The Rust sync engine holds the token it was started with, so hand it
        // the new one — otherwise background sync keeps presenting the dead
        // session and the banner comes back.
        try {
          const rustSync = await import('@/utils/sync/rust-shim');
          if (rustSync.isRustSyncActive()) await rustSync.startRustSync();
        } catch (err) {
          console.warn('[api] could not re-arm rust sync after refresh:', err);
        }
        return true;
      })()
        .catch(() => false)
        .finally(() => {
          refreshInFlight = null;
        });
    }
    return refreshInFlight;
  }

  return {
    baseUrl: base,
    get: (path, options) =>
      request('GET', path, { ...options, auth: options?.auth !== false }),
    getBinary: (path, options) =>
      request('GET', path, { ...options, auth: options?.auth !== false, responseType: 'arraybuffer' }),
    post: (path, body, options) =>
      request('POST', path, {
        ...options,
        body,
        auth: options?.auth !== false,
      }),
    put: (path, body, options) =>
      request('PUT', path, { ...options, body, auth: options?.auth !== false }),
    patch: (path, body, options) =>
      request('PATCH', path, {
        ...options,
        body,
        auth: options?.auth !== false,
      }),
    delete: (path, options) =>
      request('DELETE', path, { ...options, auth: options?.auth !== false }),
    getAccountVaultKeyParams: (options) =>
      request('GET', '/vault/account/key-params', {
        ...options,
        auth: options?.auth !== false,
      }),
    publishAccountVaultKeyParams: (body, options) =>
      request('PUT', '/vault/account/key-params', {
        ...options,
        body,
        auth: options?.auth !== false,
      }),
    getVaultKeyParams: (workspaceId, options) =>
      request('GET', `/vault/${encodeURIComponent(workspaceId)}/key-params`, {
        ...options,
        auth: options?.auth !== false,
      }),
    publishVaultKeyParams: (workspaceId, body, options) =>
      request('PUT', `/vault/${encodeURIComponent(workspaceId)}/key-params`, {
        ...options,
        body,
        auth: options?.auth !== false,
      }),
    createVaultChallenge: (workspaceId, options) =>
      request('POST', `/vault/${encodeURIComponent(workspaceId)}/challenge`, {
        ...options,
        body: {},
        auth: options?.auth !== false,
      }),
    verifyVaultPassphrase: (workspaceId, passphraseProof, challenge, options) =>
      request('POST', `/vault/${encodeURIComponent(workspaceId)}/verify`, {
        ...options,
        body: { passphraseProof, challenge },
        auth: options?.auth !== false,
      }),
    raw: request,
  };
}

let defaultClient = null;

export function getApiClient(overrides) {
  if (!defaultClient || overrides) {
    defaultClient = createApiClient(overrides || {});
  }
  return defaultClient;
}

export function resetApiClient() {
  defaultClient = null;
}

export { DEFAULT_API_URL };
