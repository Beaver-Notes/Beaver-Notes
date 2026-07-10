import {
  loadSessionToken,
  clearSessionToken,
} from '@/composable/useAccountStorage';

const DEFAULT_TIMEOUT_MS = 15000;
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
  const timer = setTimeout(
    () => controller.abort(new Error('Request timed out')),
    ms
  );
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
        err?.name === 'AbortError' ? 'Request was aborted.' : 'Network error.',
        { status: 0, code: 'network_error', cause: err }
      );
    }
    cancel();

    if (response.status === 204) return null;

    const body2 = await readBody(response).catch(() => null);

    if (!response.ok) {
      if (response.status === 401 && auth) {
        try {
          await clearToken();
        } catch (err) {
          console.warn('[api] failed to clear token on 401:', err);
        }
      }
      throw normalizeError(response.status, body2);
    }

    return body2;
  }

  return {
    baseUrl: base,
    get: (path, options) =>
      request('GET', path, { ...options, auth: options?.auth !== false }),
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
