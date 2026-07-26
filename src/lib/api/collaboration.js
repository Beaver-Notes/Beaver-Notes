import { getApiClient } from './client';

function getClient(baseUrl) {
  return getApiClient(baseUrl ? { baseUrl } : undefined);
}

export async function createCollaborationKey(noteId, { baseUrl, signal } = {}) {
  const client = getClient(baseUrl);
  return client.post(`/collaboration/keys/${encodeURIComponent(noteId)}`, {}, { signal });
}

export async function getCollaborationKey(noteId, { baseUrl, signal } = {}) {
  const client = getClient(baseUrl);
  return client.get(`/collaboration/keys/${encodeURIComponent(noteId)}`, { signal });
}

export async function inviteCollaborator(noteId, identifier, role = 'editor', { baseUrl, signal } = {}) {
  const client = getClient(baseUrl);
  const body = { role };
  if (identifier.includes('@')) {
    body.email = identifier;
  } else {
    body.username = identifier;
  }
  return client.post(`/collaboration/invite/${encodeURIComponent(noteId)}`, body, { signal });
}

export async function listCollaborators(noteId, { baseUrl, signal } = {}) {
  const client = getClient(baseUrl);
  const raw = await client.get(`/collaboration/invitations/${encodeURIComponent(noteId)}`, { signal });
  return raw?.invitations ?? [];
}

export async function removeCollaborator(noteId, userId, { baseUrl, signal } = {}) {
  const client = getClient(baseUrl);
  return client.delete(
    `/collaboration/invite/${encodeURIComponent(noteId)}/${encodeURIComponent(userId)}`,
    { signal }
  );
}
