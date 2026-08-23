/**
 * Single source of truth for sync readiness.
 *
 * Called once per sync cycle (or on demand) to resolve auth, plan, transport,
 * encryption key, and workspace state in one shot.  Every consumer reads from
 * this snapshot instead of making their own scattered Pinia/Tauri lookups —
 * eliminates the class of bugs where `_remoteAllowed()` returns false because
 * subscription data hasn't loaded yet.
 */
import { useAccountStore } from '@/store/account';
import { useWorkspaceStore } from '@/store/workspace';
import { getSettingSync } from '@/lib/settings';
import { normalizeSyncTransport, SYNC_TRANSPORT } from '@/lib/api/types';

export async function getSyncReadiness() {
  const accountStore = useAccountStore();
  const workspaceStore = useWorkspaceStore();
  const { syncKeyReady } = await import('@/lib/native/security.js');

  const transport = normalizeSyncTransport(getSettingSync('syncTransport'));
  const wantsCloud = transport !== SYNC_TRANSPORT.FOLDER;
  const isAuth = accountStore.isAuthenticated;

  const subPlan =
    accountStore.activeOrg?.subscription?.plan ??
    accountStore.subscription?.plan ??
    accountStore.plan;

  const free = subPlan === 'free';
  const syncAllowed = wantsCloud && isAuth && !free;

  // Encryption is always on after onboarding vault setup.
  // Just check if the key is available — no need to gate on isEncryptionEnabled().
  const keyReady = await syncKeyReady().catch(() => false);

  return {
    isAuth,
    plan: subPlan,
    transport,
    wantsCloud,
    syncAllowed,
    keyReady,
    workspaceId: workspaceStore.activeId,
  };
}
