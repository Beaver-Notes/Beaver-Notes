/**
 * Single source of truth for sync readiness: resolves auth, plan, transport,
 * key, and workspace once per cycle so every consumer shares one snapshot
 * instead of scattered lookups that could disagree.
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

  // Fail-closed through the store: unknown plan reads as free, unknown auth as not allowed.
  const syncAllowed = wantsCloud && accountStore.canUseCloudSync;

  // Encryption always on after onboarding: check key availability.
  const keyReady = await syncKeyReady().catch(() => false);

  return {
    isAuth,
    plan: accountStore.plan,
    transport,
    wantsCloud,
    syncAllowed,
    keyReady,
    workspaceId: workspaceStore.activeId,
  };
}
