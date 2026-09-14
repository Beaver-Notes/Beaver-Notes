import { describe, it, expect, vi } from 'vitest';

const routeMock = { name: 'Home' };
vi.mock('vue-router', () => ({
  useRoute: () => routeMock,
}));
vi.mock('@/utils/sync/path', () => ({
  getSyncPath: vi.fn(async () => {}),
}));
vi.mock('@/utils/crypto/encryption.js', () => ({
  tryRestoreKeyFromSafeStorage: vi.fn(async () => true),
  encryptionIsConfigured: vi.fn(async () => true),
  isKeyLoaded: vi.fn(() => false),
}));

import {
  useAppEncryptionGate,
} from '../useAppEncryptionGate.js';
import {
  tryRestoreKeyFromSafeStorage,
  encryptionIsConfigured,
  isKeyLoaded,
} from '@/utils/crypto/encryption.js';

function setup({ routeName = 'Home' } = {}) {
  routeMock.name = routeName;
  const finishWorkspaceInit = vi.fn(async () => {});
  const onUnlockError = vi.fn();
  return { finishWorkspaceInit, onUnlockError };
}

describe('useAppEncryptionGate', () => {
  it('restores the key then reflects the locked state', async () => {
    const { finishWorkspaceInit, onUnlockError } = setup();
    const gate = useAppEncryptionGate({ finishWorkspaceInit, onUnlockError });
    await gate.restoreEncryptionKeys();
    expect(tryRestoreKeyFromSafeStorage).toHaveBeenCalled();
    expect(encryptionIsConfigured).toHaveBeenCalled();
    expect(gate.appEncryptionGate.show).toBe(true);
    expect(gate.appEncryptionGate.deriving).toBe(false);
  });

  it('keeps the gate hidden while onboarding is showing', async () => {
    const { finishWorkspaceInit, onUnlockError } = setup({ routeName: 'Onboarding' });
    const gate = useAppEncryptionGate({ finishWorkspaceInit, onUnlockError });
    await gate.restoreEncryptionKeys();
    expect(gate.appEncryptionGate.show).toBe(false);
  });

  it('hides the gate when the key is already loaded', async () => {
    isKeyLoaded.mockReturnValue(true);
    const { finishWorkspaceInit, onUnlockError } = setup();
    const gate = useAppEncryptionGate({ finishWorkspaceInit, onUnlockError });
    await gate.restoreEncryptionKeys();
    expect(gate.appEncryptionGate.show).toBe(false);
  });

  it('runs the deferred workspace init on unlock', async () => {
    const { finishWorkspaceInit, onUnlockError } = setup();
    const gate = useAppEncryptionGate({ finishWorkspaceInit, onUnlockError });
    gate.handleEncryptionUnlocked();
    expect(finishWorkspaceInit).toHaveBeenCalled();
    expect(gate.appEncryptionGate.show).toBe(false);
  });

  it('calls onUnlockError when the deferred init fails', async () => {
    const { finishWorkspaceInit, onUnlockError } = setup();
    finishWorkspaceInit.mockRejectedValueOnce(new Error('boom'));
    const gate = useAppEncryptionGate({ finishWorkspaceInit, onUnlockError });
    await gate.handleEncryptionUnlocked();
    expect(onUnlockError).toHaveBeenCalled();
  });
});
