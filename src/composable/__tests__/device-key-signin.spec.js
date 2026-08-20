import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('@/lib/api/auth', () => ({ setKeypair: vi.fn().mockResolvedValue({ ok: true }) }));
vi.mock('@/utils/crypto/identity', async () => {
  const actual = await vi.importActual('@/utils/crypto/identity');
  return {
    ...actual,
    loadOrCreateIdentity: vi.fn().mockResolvedValue({ publicKeyHex: 'PUB', privateKeyHex: 'PRIV' }),
  };
});
import { setKeypair } from '@/lib/api/auth';
import { publishIdentity } from '@/utils/crypto/identity';

describe('device key registration', () => {
  beforeEach(() => {
    setKeypair.mockClear();
  });

  it('publishIdentity sends the deviceId to setKeypair', async () => {
    await publishIdentity({ publicKeyHex: 'PUB', privateKeyHex: 'PRIV' }, 'dev-xyz');
    expect(setKeypair).toHaveBeenCalledWith('PUB', { deviceId: 'dev-xyz' });
  });
});
