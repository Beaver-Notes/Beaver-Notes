import { getApiClient } from './client';

export async function listCommits(workspaceId, noteId) {
  const client = getApiClient();
  const response = await client.get(
    `/workspace/${encodeURIComponent(workspaceId)}/commits`,
    { query: { noteId } }
  );
  return response?.data?.commits || response?.commits || [];
}

export async function getCommitSnapshot(commitHash) {
  const client = getApiClient();
  const response = await client.get(
    `/commits/${encodeURIComponent(commitHash)}/snapshot`
  );
  return response?.data || response;
}
