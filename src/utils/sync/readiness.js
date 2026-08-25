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

  const subPlan =
    accountStore.activeOrg?.subscription?.plan ??
    accountStore.subscription?.plan ??
    accountStore.plan;

  const free = subPlan === 'free';
  const syncAllowed = wantsCloud && isAuth && !free;

  // Encryption is always on after onboarding — just check key availability.
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
