import { getApiClient } from './client';

function getClient(baseUrl) {
  return getApiClient(baseUrl ? { baseUrl } : undefined);
}

export async function getWorkspaces({ baseUrl, signal } = {}) {
  const client = getClient(baseUrl);
  const raw = await client.get('/workspaces', { signal });
  return raw?.workspaces ?? [];
}

export async function createWorkspace(name, { baseUrl, signal } = {}) {
  const client = getClient(baseUrl);
  return client.post('/workspaces', { name }, { signal });
}

export async function deleteWorkspace(id, { baseUrl, signal } = {}) {
  const client = getClient(baseUrl);
  return client.delete(`/workspaces/${encodeURIComponent(id)}`, { signal });
}

export async function addMember(workspaceId, identifier, role = 'editor', { baseUrl, signal } = {}) {
  const client = getClient(baseUrl);
  return client.post(
    `/workspaces/${encodeURIComponent(workspaceId)}/members`,
    { identifier, role },
    { signal }
  );
}

export async function removeMember(workspaceId, userId, { baseUrl, signal } = {}) {
  const client = getClient(baseUrl);
  return client.delete(
    `/workspaces/${encodeURIComponent(workspaceId)}/members/${encodeURIComponent(userId)}`,
    { signal }
  );
}

export async function joinWorkspace(token, { baseUrl, signal } = {}) {
  const client = getClient(baseUrl);
  return client.post(`/workspaces/join/${encodeURIComponent(token)}`, {}, { signal });
}
