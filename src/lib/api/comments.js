import { getApiClient } from './client';

function getClient(baseUrl) {
  return getApiClient(baseUrl ? { baseUrl } : undefined);
}

export async function listComments(noteId, { baseUrl, signal } = {}) {
  const client = getClient(baseUrl);
  const response = await client.get(
    `/comments/${encodeURIComponent(noteId)}`,
    { signal }
  );
  return response?.comments || [];
}

export async function createComment(noteId, data, { baseUrl, signal } = {}) {
  const client = getClient(baseUrl);
  return client.post(
    `/comments/${encodeURIComponent(noteId)}`,
    data,
    { signal }
  );
}

export async function updateComment(commentId, data, { baseUrl, signal } = {}) {
  const client = getClient(baseUrl);
  return client.patch(
    `/comments/${encodeURIComponent(commentId)}`,
    data,
    { signal }
  );
}

export async function deleteComment(commentId, { baseUrl, signal } = {}) {
  const client = getClient(baseUrl);
  return client.delete(
    `/comments/${encodeURIComponent(commentId)}`,
    { signal }
  );
}

export async function resolveComment(commentId, { baseUrl, signal } = {}) {
  const client = getClient(baseUrl);
  return client.patch(
    `/comments/${encodeURIComponent(commentId)}/resolve`,
    {},
    { signal }
  );
}
