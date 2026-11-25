import { getActiveAccountId, listAccounts, loadIndex, saveIndex } from '@/lib/accounts-index';
import {
  loadCachedProfile,
  loadRefreshToken,
  loadSessionToken,
  saveRefreshToken,
  saveSessionToken,
} from '@/lib/account-storage';
import { getSettingSync } from '@/lib/settings';
import { fetchSecureBlob, storeSecureBlob } from '@/lib/native/security';
import { identityBlobKey } from '@/utils/crypto/identity';

const LEGACY_IDENTITY_KEY = 'e2eIdentityKeypair';

/**
 * Adopt the pre-multi-account install into the account index.
 *
 * Before accounts were plural every credential lived in one install-level slot.
 * The first launch after the upgrade turns that slot into `accounts[0]` and
 * copies — never moves — its values onto the per-account keys, so an install
 * that downgrades still finds what it had. Idempotent: a populated index is
 * left untouched.
 *
 * @returns {Promise<{migrated: boolean, accountId: string|null}>}
 */
export async function migrateSingleAccountToIndex() {
  await loadIndex();
  if (listAccounts().length > 0) {
    return { migrated: false, accountId: getActiveAccountId() };
  }

  // Read the legacy values before the index exists: with no active account
  // every reader falls back to the unsuffixed slot, which is exactly the
  // pre-migration one.
  const token = await loadSessionToken().catch(() => null);
  if (!token) return { migrated: false, accountId: null };

  const profile = await loadCachedProfile().catch(() => null);
  const refreshToken = await loadRefreshToken().catch(() => null);
  const accountId = profile?.id || crypto.randomUUID();

  await saveIndex({
    accounts: [
      {
        id: accountId,
        email: profile?.email || null,
        // The server and the cached plan limits lived in install settings; carry
        // them so the migrated account does not fall back to the default server
        // or lose its known history window.
        serverUrl: getSettingSync('beaverAccountServerUrl') || null,
        profile: profile || null,
        subscription: null,
        organizations: [],
        planLimits: getSettingSync('accountPlanLimits') || null,
        activeOrgId: null,
        activeWorkspaceId: null,
        workspaces: [],
        cachedAt: null,
      },
    ],
    activeAccountId: accountId,
  });

  if (refreshToken) await saveRefreshToken(refreshToken, accountId).catch(() => {});
  await saveSessionToken(token, accountId).catch(() => {});

  try {
    const keypair = await fetchSecureBlob(LEGACY_IDENTITY_KEY);
    if (keypair) await storeSecureBlob(identityBlobKey(accountId), keypair);
  } catch (err) {
    console.warn('[accounts] identity migration failed:', err?.message || err);
  }

  return { migrated: true, accountId };
}
