import { describe, it, expect } from 'vitest';
import { createApiClient } from '../client.js';

// Regression: withTimeout aborted with a plain Error('Request timed out'), whose
// name is 'Error', so the catch classified every timeout as a network error.
describe('api client timeout classification', () => {
  const seen = [];
  const client = createApiClient({
    baseUrl: 'https://sync.example.com',
    getToken: async () => 'tok',
    fetchImpl: (_url, init) => {
      seen.push(init.signal);
      return new Promise((_, reject) => {
        if (init.signal.aborted) {
          reject(init.signal.reason);
          return;
        }
        init.signal.addEventListener('abort', () => reject(init.signal.reason), {
          once: true,
        });
      });
    },
  });

  it('CONTROL: the abort fires and carries the timeout reason', async () => {
    seen.length = 0;
    await expect(client.get('/account', { timeoutMs: 5 })).rejects.toThrow();
    expect(seen[0].aborted).toBe(true);
    expect(seen[0].reason.message).toBe('Request timed out');
  });

  it('reports a timeout as a timeout, not a network error', async () => {
    await expect(client.get('/account', { timeoutMs: 5 })).rejects.toMatchObject({
      message: 'Request timed out.',
      status: 0,
    });
  });

  it('still reports a caller-initiated abort as an abort', async () => {
    const controller = new AbortController();
    const pending = client.get('/account', {
      signal: controller.signal,
      timeoutMs: 5000,
    });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ message: 'Request was aborted.' });
  });
});
