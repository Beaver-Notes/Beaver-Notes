import { getApiClient } from './client';

function getClient(baseUrl) {
  return getApiClient(baseUrl ? { baseUrl } : undefined);
}

export async function createCheckoutSession(plan, interval, { baseUrl, signal } = {}) {
  const client = getClient(baseUrl);
  return client.post('/billing/checkout-session', { plan, interval }, { signal });
}

export async function createPortalSession({ baseUrl, signal } = {}) {
  const client = getClient(baseUrl);
  return client.post('/billing/portal-session', {}, { signal });
}
