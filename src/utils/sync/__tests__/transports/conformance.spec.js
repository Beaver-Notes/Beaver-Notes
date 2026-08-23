import { describe, expect, it, beforeEach } from 'vitest';
import { Transport } from '../../transports/transport.js';

/**
 * Conformance suite — shared contract that every Transport implementation
 * must satisfy.  Import the transport factory and run `conformanceTests()`.
 *
 * Usage:
 *   import { conformanceTests } from './conformance.spec.js';
 *   conformanceTests(() => new MyTransport({ ... }));
 */

export function conformanceTests(createTransport) {
  describe('Transport conformance', () => {
    let transport;

    beforeEach(() => {
      transport = createTransport();
    });

    describe('pull()', () => {
      it('returns { updates } with an array', async () => {
        const result = await transport.pull();
        expect(result).toHaveProperty('updates');
        expect(Array.isArray(result.updates)).toBe(true);
      });

      it('each update has noteId, update (Uint8Array), device, ts, sequence', async () => {
        const result = await transport.pull();
        for (const u of result.updates) {
          expect(u).toHaveProperty('noteId');
          expect(u).toHaveProperty('update');
          expect(u).toHaveProperty('device');
          expect(u).toHaveProperty('ts');
          expect(u).toHaveProperty('sequence');
          expect(typeof u.noteId).toBe('string');
          expect(u.update).toBeInstanceOf(Uint8Array);
          expect(typeof u.device).toBe('string');
          expect(typeof u.ts).toBe('number');
          expect(typeof u.sequence).toBe('number');
        }
      });
    });

    describe('push()', () => {
      it('returns { updates, pushed }', async () => {
        const result = await transport.push();
        expect(result).toHaveProperty('updates');
        expect(result).toHaveProperty('pushed');
        expect(Array.isArray(result.updates)).toBe(true);
        expect(typeof result.pushed).toBe('number');
      });
    });

    describe('seedOnce()', () => {
      it('is idempotent — calling twice does not throw', async () => {
        await transport.seedOnce();
        await transport.seedOnce();
      });
    });

    describe('compact()', () => {
      it('does not throw', async () => {
        await expect(transport.compact()).resolves.not.toThrow();
      });
    });
  });
}

describe('Transport base class', () => {
  it('throws from pull() by default', async () => {
    const t = new Transport();
    await expect(t.pull()).rejects.toThrow('not implemented');
  });

  it('throws from push() by default', async () => {
    const t = new Transport();
    await expect(t.push()).rejects.toThrow('not implemented');
  });

  it('seedOnce() is a no-op by default', async () => {
    const t = new Transport();
    await expect(t.seedOnce()).resolves.not.toThrow();
  });

  it('compact() is a no-op by default', async () => {
    const t = new Transport();
    await expect(t.compact()).resolves.not.toThrow();
  });
});
