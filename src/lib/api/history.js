import { getApiClient } from './client';

export async function listCommits(workspaceId, noteId) {
  const client = getApiClient();
  const response = await client.get('/commits/history', {
    query: { noteId },
  });
  return response?.commits || [];
}

export async function getCommitSnapshot(commitHash) {
  const client = getApiClient();
  const response = await client.get(
    `/commits/${encodeURIComponent(commitHash)}`
  );
  return response?.data || response;
}
