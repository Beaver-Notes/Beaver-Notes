import { getApiClient } from './client';

function getClient(baseUrl) {
  return getApiClient(baseUrl ? { baseUrl } : undefined);
}

export async function createCollaborationKey(noteId, { baseUrl, signal, workspaceId } = {}) {
  const client = getClient(baseUrl);
  const body = workspaceId ? { workspaceId } : {};
  return client.post(`/collaboration/keys/${encodeURIComponent(noteId)}`, body, { signal });
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

// L8: replace the note's envelopes with a new key generation after a
// collaborator removal. Only a key-holding collaborator may call this.
export async function rotateNoteKey(noteId, recipients, { baseUrl, signal } = {}) {
  const client = getClient(baseUrl);
  return client.post(`/collaboration/keys/${encodeURIComponent(noteId)}/rotate`, { recipients }, { signal });
}

export async function inviteCollaborator(noteId, identifier, role = 'editor', { baseUrl, signal, workspaceId } = {}) {
  const client = getClient(baseUrl);
  const body = { role };
  if (identifier.includes('@')) {
    body.email = identifier;
  } else {
    body.username = identifier;
  }
  // Names the workspace the note is shared from, so the server can recognise
  // the owner of a note that has not been pushed yet (see callerOwnsNote).
  if (workspaceId) body.workspaceId = workspaceId;
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

export async function generateInviteLink(noteId, { role, requireApproval, expiresIn, baseUrl, signal, workspaceId } = {}) {
  const client = getClient(baseUrl);
  const body = { role, requireApproval, expiresIn };
  // See inviteCollaborator: lets the server recognise the owner of an unpushed note.
  if (workspaceId) body.workspaceId = workspaceId;
  const response = await client.post(`/collaboration/links/${encodeURIComponent(noteId)}`, body, { signal });
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

// Accepts a bare invite token or a full `beaver-notes://join/<token>` (or
// https) link and returns just the token. Query/hash fragments are stripped.
export function normalizeInviteToken(input) {
  const raw = String(input ?? '').trim();
  if (!raw) return '';
  if (!raw.includes('://')) return raw.split(/[?#]/)[0];
  try {
    const url = new URL(raw);
    const segments = url.pathname.split('/').filter(Boolean);
    return (segments[segments.length - 1] || '').split(/[?#]/)[0];
  } catch {
    return raw
      .replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]*\/?/i, '')
      .split(/[?#]/)[0];
  }
}

export async function joinViaInviteLink(token, { baseUrl, signal } = {}) {
  const client = getClient(baseUrl);
  const response = await client.post(`/collaboration/join/${encodeURIComponent(token)}`, {}, { signal });
  return response;
}

export async function listNoteJoinRequests(noteId, { baseUrl, signal } = {}) {
  const client = getClient(baseUrl);
  const res = await client.get(
    `/collaboration/notes/${encodeURIComponent(noteId)}/join-requests`,
    { signal }
  );
  return res?.requests ?? [];
}

export async function listAllNoteJoinRequests({ baseUrl, signal } = {}) {
  const client = getClient(baseUrl);
  const res = await client.get('/collaboration/join-requests', { signal });
  return res?.requests ?? [];
}

export async function approveNoteJoinRequest(requestId, { baseUrl, signal } = {}) {
  const client = getClient(baseUrl);
  return client.post(
    `/collaboration/join-requests/${encodeURIComponent(requestId)}/approve`,
    {},
    { signal }
  );
}

export async function denyNoteJoinRequest(requestId, { baseUrl, signal } = {}) {
  const client = getClient(baseUrl);
  return client.post(
    `/collaboration/join-requests/${encodeURIComponent(requestId)}/deny`,
    {},
    { signal }
  );
}
