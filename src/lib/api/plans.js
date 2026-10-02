import { getApiClient } from './client';

function getClient(baseUrl) {
  return getApiClient(baseUrl ? { baseUrl } : undefined);
}

export async function getPlans({ baseUrl, signal } = {}) {
  const client = getClient(baseUrl);
  return client.get('/plans', { baseUrl, signal });
}
