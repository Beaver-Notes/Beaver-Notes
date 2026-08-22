import { getClient } from './client';

export async function listSsoConfigs(workspaceId, { baseUrl, signal } = {}) {
  const client = getClient(baseUrl);
  const raw = await client.get(`/workspaces/${encodeURIComponent(workspaceId)}/sso`, { signal });
  return raw?.configs ?? [];
}

export async function getSsoConfig(workspaceId, configId, { baseUrl, signal } = {}) {
  const client = getClient(baseUrl);
  const raw = await client.get(`/workspaces/${encodeURIComponent(workspaceId)}/sso/${encodeURIComponent(configId)}`, { signal });
  return raw?.config ?? null;
}

export async function createSsoConfig(workspaceId, data, { baseUrl, signal } = {}) {
  const client = getClient(baseUrl);
  const raw = await client.post(`/workspaces/${encodeURIComponent(workspaceId)}/sso`, data, { signal });
  return raw?.config ?? null;
}

export async function updateSsoConfig(workspaceId, configId, data, { baseUrl, signal } = {}) {
  const client = getClient(baseUrl);
  const raw = await client.patch(`/workspaces/${encodeURIComponent(workspaceId)}/sso/${encodeURIComponent(configId)}`, data, { signal });
  return raw?.config ?? null;
}

export async function deleteSsoConfig(workspaceId, configId, { baseUrl, signal } = {}) {
  const client = getClient(baseUrl);
  await client.delete(`/workspaces/${encodeURIComponent(workspaceId)}/sso/${encodeURIComponent(configId)}`, { signal });
}
