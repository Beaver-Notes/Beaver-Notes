import { getApiClient } from './client';

function getClient(baseUrl) {
  return getApiClient(baseUrl ? { baseUrl } : undefined);
}

export async function getAdminMembers(workspaceId, { baseUrl, signal } = {}) {
  const client = getClient(baseUrl);
  return client.get(`/admin/workspaces/${encodeURIComponent(workspaceId)}/members`, { baseUrl, signal });
}

export async function getAdminDevices(workspaceId, { baseUrl, signal } = {}) {
  const client = getClient(baseUrl);
  return client.get(`/admin/workspaces/${encodeURIComponent(workspaceId)}/devices`, { baseUrl, signal });
}

export async function getAdminAudit(workspaceId, { baseUrl, signal, query } = {}) {
  const client = getClient(baseUrl);
  return client.get(`/admin/workspaces/${encodeURIComponent(workspaceId)}/audit`, { baseUrl, signal, query });
}

export async function revokeSession(sessionHash, { baseUrl, signal } = {}) {
  const client = getClient(baseUrl);
  return client.delete(`/admin/sessions/${encodeURIComponent(sessionHash)}`, { baseUrl, signal });
}

export async function memberLookup(workspaceId, { email, username } = {}, { baseUrl, signal } = {}) {
  const client = getClient(baseUrl);
  const query = {};
  if (email) query.email = email;
  if (username) query.username = username;
  return client.get(`/workspaces/${encodeURIComponent(workspaceId)}/member-lookup`, { baseUrl, signal, query });
}

export async function changeMemberRole(workspaceId, userId, role, { baseUrl, signal } = {}) {
  const client = getClient(baseUrl);
  return client.patch(`/workspaces/${encodeURIComponent(workspaceId)}/members/${encodeURIComponent(userId)}`, { role }, { baseUrl, signal });
}
