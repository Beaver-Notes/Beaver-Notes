import { getApiClient } from './client';
import { normalizeAccountResponse } from './types';

function getClient(baseUrl) {
  return getApiClient(baseUrl ? { baseUrl } : undefined);
}

export async function getAccount({ baseUrl, signal } = {}) {
  const client = getClient(baseUrl);
  const raw = await client.get('/account', { signal });
  return normalizeAccountResponse(raw);
}

export async function updateUsername(username, { baseUrl, signal } = {}) {
  const client = getClient(baseUrl);
  return client.patch('/account/username', { username }, { signal });
}

export async function deleteAccount(password, { baseUrl, signal } = {}) {
  const client = getClient(baseUrl);
  return client.delete('/account', {
    body: { password },
    signal,
  });
}

export async function deleteDevice(deviceId, { baseUrl, signal } = {}) {
  const client = getClient(baseUrl);
  return client.delete(`/account/devices/${encodeURIComponent(deviceId)}`, {
    signal,
  });
}

export async function getAccountExport({ baseUrl, signal } = {}) {
  const client = getClient(baseUrl);
  return client.get('/account/export', { signal });
}

export async function generateRecoveryCode({ baseUrl, signal } = {}) {
  const client = getClient(baseUrl);
  return client.post('/account/recovery-code', {}, { signal });
}

export async function requestEmailVerification({ baseUrl, signal } = {}) {
  const client = getClient(baseUrl);
  return client.post('/account/verify-email/request', {}, { signal });
}

export async function confirmEmailVerification(token, { baseUrl, signal } = {}) {
  const client = getClient(baseUrl);
  return client.post('/account/verify-email/confirm', { token }, { signal, auth: false });
}

export async function changePassword(currentPassword, newPassword, { baseUrl, signal } = {}) {
  const client = getClient(baseUrl);
  return client.patch('/account/password', { currentPassword, newPassword }, { signal });
}
