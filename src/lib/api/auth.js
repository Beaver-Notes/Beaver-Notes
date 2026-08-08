import { getApiClient } from './client';

let _isTauri = null;
function isTauri() {
  if (_isTauri !== null) return _isTauri;
  _isTauri =
    typeof window !== 'undefined' && window.__TAURI_INTERNALS__ !== undefined;
  return _isTauri;
}

function getOrigin(baseUrl) {
  if (!baseUrl) {
    try {
      return window.location.origin;
    } catch {
      return '';
    }
  }
  try {
    return new URL(baseUrl).origin;
  } catch {
    return baseUrl;
  }
}

function toBase64Url(value) {
  if (value == null) return null;
  if (typeof value === 'string') return value;
  if (value instanceof ArrayBuffer) {
    return toBase64Url(new Uint8Array(value));
  }
  let binary = '';
  const bytes =
    value instanceof Uint8Array ? value : new Uint8Array(value.buffer || value);
  for (let i = 0; i < bytes.byteLength; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  const b64 =
    typeof btoa === 'function'
      ? btoa(binary)
      : Buffer.from(binary, 'binary').toString('base64');
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(base64url) {
  if (!base64url) return null;
  if (base64url instanceof ArrayBuffer) return base64url;
  if (base64url instanceof Uint8Array)
    return base64url.buffer.slice(
      base64url.byteOffset,
      base64url.byteOffset + base64url.byteLength
    );
  if (typeof base64url !== 'string') {
    return new Uint8Array(0).buffer;
  }
  const padded = base64url.replace(/-/g, '+').replace(/_/g, '/');
  const remainder = padded.length % 4;
  const final = remainder ? padded + '='.repeat(4 - remainder) : padded;
  if (typeof atob === 'function') {
    const binary = atob(final);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  }
  const buf = Buffer.from(final, 'base64');
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

function publicKeyCredentialToJSON(cred) {
  if (!cred) return null;
  const response = cred.response || {};
  const result = {
    id: cred.id,
    rawId: toBase64Url(cred.rawId),
    type: cred.type || 'public-key',
  };

  if (response.clientDataJSON) {
    result.response = {
      clientDataJSON: toBase64Url(response.clientDataJSON),
    };
    if (response.attestationObject) {
      result.response.attestationObject = toBase64Url(
        response.attestationObject
      );
    }
    if (response.authenticatorData) {
      result.response.authenticatorData = toBase64Url(
        response.authenticatorData
      );
    }
    if (response.signature) {
      result.response.signature = toBase64Url(response.signature);
    }
    if (response.userHandle) {
      result.response.userHandle = toBase64Url(response.userHandle);
    }
  } else {
    result.response = response;
  }

  if (cred.authenticatorAttachment) {
    result.authenticatorAttachment = cred.authenticatorAttachment;
  }
  if (cred.clientExtensionResults) {
    result.clientExtensionResults = cred.clientExtensionResults;
  }
  return result;
}

function decodeRegistrationOptions(options) {
  if (!options) return null;
  return {
    ...options,
    challenge: fromBase64Url(options.challenge),
    user: options.user
      ? {
          ...options.user,
          id: fromBase64Url(options.user.id),
        }
      : undefined,
    excludeCredentials: Array.isArray(options.excludeCredentials)
      ? options.excludeCredentials.map((cred) => ({
          ...cred,
          id: fromBase64Url(cred.id),
        }))
      : undefined,
  };
}

function decodeAuthenticationOptions(options) {
  if (!options) return null;
  return {
    ...options,
    challenge: fromBase64Url(options.challenge),
    allowCredentials: Array.isArray(options.allowCredentials)
      ? options.allowCredentials.map((cred) => ({
          ...cred,
          id: fromBase64Url(cred.id),
        }))
      : undefined,
  };
}

export function isWebAuthnAvailable() {
  if (isTauri()) return true;
  return (
    typeof window !== 'undefined' &&
    !!window.PublicKeyCredential &&
    typeof navigator !== 'undefined' &&
    !!navigator.credentials &&
    typeof navigator.credentials.get === 'function' &&
    typeof navigator.credentials.create === 'function'
  );
}

export function isConditionalMediationAvailable() {
  return (
    typeof window !== 'undefined' &&
    !!window.PublicKeyCredential?.isConditionalMediationAvailable
  );
}

async function ensureWebAuthn() {
  if (!isWebAuthnAvailable()) {
    throw new Error('Passkeys are not supported in this browser.');
  }
}

function getClient(baseUrl) {
  return getApiClient(baseUrl ? { baseUrl } : undefined);
}

export async function passkeyRegisterBegin(
  email,
  deviceLabel,
  { baseUrl } = {}
) {
  const client = getClient(baseUrl);
  return client.post('/auth/passkey/register/begin', {
    email,
    deviceLabel,
  });
}

export async function passkeyRegisterComplete(
  email,
  { baseUrl, signal } = {},
  createOptions
) {
  let registrationResponse;
  if (isTauri()) {
    const { invoke } = await import('@tauri-apps/api/core');
    const origin = getOrigin(baseUrl);
    registrationResponse = await invoke('plugin:webauthn|register', {
      origin,
      options: createOptions,
    });
  } else {
    await ensureWebAuthn();
    const decoded = decodeRegistrationOptions(createOptions);
    const credential = await navigator.credentials.create({
      publicKey: decoded,
    });
    if (!credential) {
      throw new Error('Passkey registration was cancelled.');
    }
    registrationResponse = publicKeyCredentialToJSON(credential);
  }
  const client = getClient(baseUrl);
  return client.post(
    '/auth/passkey/register/complete',
    { email, registrationResponse },
    { signal }
  );
}

export async function passkeyLoginBegin(email, { baseUrl } = {}) {
  const client = getClient(baseUrl);
  return client.post('/auth/passkey/login/begin', { email });
}

export async function passkeyLoginComplete(
  email,
  { baseUrl, signal, mediation } = {},
  requestOptions
) {
  let authenticationResponse;
  if (isTauri()) {
    const { invoke } = await import('@tauri-apps/api/core');
    const origin = getOrigin(baseUrl);
    authenticationResponse = await invoke('plugin:webauthn|authenticate', {
      origin,
      options: requestOptions,
    });
  } else {
    await ensureWebAuthn();
    const decoded = decodeAuthenticationOptions(requestOptions);
    const publicKey = { ...decoded };
    if (mediation) publicKey.mediation = mediation;
    const credential = await navigator.credentials.get({ publicKey });
    if (!credential) {
      throw new Error('Passkey sign-in was cancelled.');
    }
    authenticationResponse = publicKeyCredentialToJSON(credential);
  }
  const client = getClient(baseUrl);
  return client.post(
    '/auth/passkey/login/complete',
    { email, authenticationResponse },
    { signal }
  );
}

export async function passwordLogin(email, password, { baseUrl, signal } = {}) {
  const client = getClient(baseUrl);
  return client.post('/auth/token', { email, password }, { signal });
}

export async function passwordRegister(
  email,
  password,
  { baseUrl, signal } = {}
) {
  const client = getClient(baseUrl);
  return client.post('/auth/register', { email, password }, { signal });
}

export async function quickConnectInitiate({ baseUrl } = {}) {
  const client = getClient(baseUrl);
  return client.post('/auth/quickconnect/initiate', {});
}

export async function quickConnectAuthorize(
  code,
  payload,
  { baseUrl, signal } = {}
) {
  const client = getClient(baseUrl);
  return client.post(
    `/auth/quickconnect/authorize/${encodeURIComponent(code)}`,
    payload ? { payload } : {},
    { signal }
  );
}

export async function quickConnectPoll(secret, { baseUrl, signal } = {}) {
  const client = getClient(baseUrl);
  return client.get('/auth/quickconnect/connect', {
    query: { secret },
    signal,
  });
}

export async function logout({ baseUrl, signal } = {}) {
  const client = getClient(baseUrl);
  return client.post('/auth/logout', {}, { signal });
}

export async function listSessions({ baseUrl, signal } = {}) {
  const client = getClient(baseUrl);
  return client.get('/auth/sessions', { signal });
}

export async function revokeSession(id, { baseUrl, signal } = {}) {
  const client = getClient(baseUrl);
  return client.delete(`/auth/sessions/${encodeURIComponent(id)}`, { signal });
}

export async function revokeAllSessions({
  baseUrl,
  signal,
  keepCurrent = true,
} = {}) {
  const client = getClient(baseUrl);
  return client.post('/auth/sessions/revoke-all', { keepCurrent }, { signal });
}

export async function verifySession({ baseUrl, signal } = {}) {
  const client = getClient(baseUrl);
  return client.post('/auth/verify-session', {}, { signal });
}

export const webauthn = {
  isAvailable: isWebAuthnAvailable,
  isConditionalMediationAvailable,
  decodeRegistrationOptions,
  decodeAuthenticationOptions,
  publicKeyCredentialToJSON,
};
