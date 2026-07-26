import { getApiClient } from './client';

export async function listCommits(workspaceId, noteId) {
  const client = await getApiClient();
  const response = await client.request({
    method: 'GET',
    url: `/workspace/${workspaceId}/commits?noteId=${noteId}`,
  });
  return response.data.commits || [];
}

export async function getCommitSnapshot(commitHash) {
  const client = await getApiClient();
  const response = await client.request({
    method: 'GET',
    url: `/commits/${commitHash}/snapshot`,
  });
  return response.data;
}