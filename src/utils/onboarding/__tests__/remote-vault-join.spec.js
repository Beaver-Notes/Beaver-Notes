import { describe, expect, it, vi } from 'vitest';
import {
  detectRemoteVaultJoin,
  completeRemoteVaultJoin,
} from '../remote-vault-join.js';

describe('remote vault onboarding', () => {
  it('fetches remote params before detecting an existing vault without a folder', async () => {
    const calls = [];
    const detected = await detectRemoteVaultJoin({
      fetchCloudKeyParams: vi.fn(async () => {
        calls.push('fetch');
        return true;
      }),
      hasRemoteVaultKeyParams: vi.fn(async () => {
        calls.push('has');
        return true;
      }),
    });

    expect(detected).toBe(true);
    expect(calls).toEqual(['fetch']);
  });

  it('rejects wrong passphrases before native adoption or sync advancement', async () => {
    const adopt = vi.fn();
    await expect(completeRemoteVaultJoin({
      workspaceId: 'ws-123',
      passphrase: 'wrong',
      proofBlob: 'remote-blob',
      paramsBlob: '{"version":3}',
      challenge: 'challenge-1',
      deriveProof: vi.fn(async () => 'wrong-proof'),
      verify: vi.fn(async () => { throw new Error('invalid_passphrase'); }),
      adopt,
    })).rejects.toThrow('invalid_passphrase');

    expect(adopt).not.toHaveBeenCalled();
  });

  it('adopts supplied remote key params only after verification', async () => {
    const fetched = await (async () => {
      const result = { proofBlob: 'remote-proof', paramsBlob: '{"version":3}' };
      expect(await detectRemoteVaultJoin({
        fetchCloudKeyParams: vi.fn(async () => result),
        hasRemoteVaultKeyParams: vi.fn(),
      })).toBe(true);
      return result;
    })();
    const adopt = vi.fn(async () => ({ ok: true }));
    const result = await completeRemoteVaultJoin({
      workspaceId: 'ws-123',
      passphrase: 'correct',
     proofBlob: fetched.proofBlob,
     paramsBlob: fetched.paramsBlob,
    challenge: 'challenge-1',
    deriveProof: vi.fn(async (passphrase, workspaceId, proofBlob, challenge) => {
      expect(passphrase).toBe('correct');
      expect(workspaceId).toBe('ws-123');
       expect(proofBlob).toBe('remote-proof');
      expect(challenge).toBe('challenge-1');
      return 'proof';
    }),
    verify: vi.fn(async (workspaceId, proof, challenge) => {
      expect(workspaceId).toBe('ws-123');
      expect(proof).toBe('proof');
      expect(challenge).toBe('challenge-1');
      }),
      adopt,
    });

    expect(result).toEqual({ ok: true });
    expect(adopt).toHaveBeenCalledWith('correct', '{"version":3}');
  });
});
