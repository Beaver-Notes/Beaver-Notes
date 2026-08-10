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

export async function listCollaboratorPublicKeys(noteId, { baseUrl, signal } = {}) {
  const client = getClient(baseUrl);
  return client.get(`/collaboration/public-keys/${encodeURIComponent(noteId)}`, { signal });
}

export async function storeRecipients(noteId, recipients, { baseUrl, signal } = {}) {
  const client = getClient(baseUrl);
  return client.post(`/collaboration/keys/${encodeURIComponent(noteId)}/recipients`, { recipients }, { signal });
}

export async function storeRecipient(noteId, recipientUserId, wrappedKey, { baseUrl, signal } = {}) {
  const client = getClient(baseUrl);
  return client.post(`/collaboration/keys/${encodeURIComponent(noteId)}/recipient`, { recipientUserId, wrappedKey }, { signal });
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

export async function generateInviteLink(noteId, { role, requireApproval, expiresIn, baseUrl, signal } = {}) {
  const client = getClient(baseUrl);
  const response = await client.post(`/collaboration/links/${encodeURIComponent(noteId)}`, {
    role,
    requireApproval,
    expiresIn,
  }, { signal });
  return response;
}

export async function listInviteLinks(noteId, { baseUrl, signal } = {}) {
  const client = getClient(baseUrl);
  const response = await client.get(`/collaboration/links/${encodeURIComponent(noteId)}`, { signal });
  return response?.links || [];
}

export async function revokeInviteLink(noteId, linkId, { baseUrl, signal } = {}) {
  const client = getClient(baseUrl);
  const response = await client.delete(
    `/collaboration/links/${encodeURIComponent(noteId)}/${encodeURIComponent(linkId)}`,
    { signal }
  );
  return response;
}

export async function joinViaInviteLink(token, { baseUrl, signal } = {}) {
  const client = getClient(baseUrl);
  const response = await client.post(`/collaboration/join/${encodeURIComponent(token)}`, {}, { signal });
  return response;
}
