import { describe, it, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';

vi.mock('@/composable/useTranslations', () => ({
  useTranslations: () => ({ translations: { settings: {} } }),
}));
vi.mock('@/lib/dialog', () => ({ useDialog: () => ({ prompt: vi.fn(), alert: vi.fn(), confirm: vi.fn() }) }));
vi.mock('@/store/passwd', () => ({
  usePasswordStore: () => ({ appPassword: 'mock', retrieve: vi.fn(), setAppPassword: vi.fn(), isValidPassword: vi.fn(), resetPassword: vi.fn() }),
}));
vi.mock('@/store/note', () => ({ useNoteStore: () => ({}) }));
vi.mock('@/utils/crypto/encryption.js', () => ({
  isKeyLoaded: () => true,
  setupEncryption: vi.fn(),
  verifyPassphrase: vi.fn(),
  lockEncryptionKey: vi.fn(),
  generateRecoveryCode: vi.fn(),
  adoptVaultKey: vi.fn(),
  hasRemoteVaultKeyParams: vi.fn(),
}));
vi.mock('@/lib/native/security', () => ({
  migrateAssetEncryption: vi.fn(),
  onAssetMigrationProgress: vi.fn(),
  rotateEncryptionKey: vi.fn(),
  reconcileSyncKeyParams: vi.fn(),
}));
vi.mock('@/utils/sync/vault-key-params.js', () => ({ publishCloudKeyParams: vi.fn() }));

import Security from '../Security.vue';

describe('Security page', () => {
  it('no longer offers a separate app password', async () => {
    const wrapper = mount(Security);
    expect(wrapper.text()).not.toContain('App password is set');
    expect(wrapper.text()).not.toContain('Set your app password');
  });
});
