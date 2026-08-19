import { describe, expect, it } from 'vitest';
import { Transport } from '../../transports/transport.js';

describe('Transport', () => {
  it('pull throws not-implemented by default', async () => {
    const t = new Transport();
    await expect(t.pull()).rejects.toThrow('not implemented');
  });

  it('push throws not-implemented by default', async () => {
    const t = new Transport();
    await expect(t.push()).rejects.toThrow('not implemented');
  });
});
