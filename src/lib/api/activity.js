import { getApiClient } from './client';

function getClient(baseUrl) {
  return getApiClient(baseUrl ? { baseUrl } : undefined);
}

export async function listActivity(noteId, { baseUrl, signal } = {}) {
  const client = getClient(baseUrl);
  const response = await client.get(
    `/activity/${encodeURIComponent(noteId)}`,
    { signal }
  );
  return response?.activity || [];
}

export async function createActivity(noteId, data, { baseUrl, signal } = {}) {
  const client = getClient(baseUrl);
  return client.post(
    `/activity/${encodeURIComponent(noteId)}`,
    data,
    { signal }
  );
}
