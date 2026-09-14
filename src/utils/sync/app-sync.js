import { startRustSync, kickRustSync } from './rust-shim.js';
import { getSettingSync } from '@/lib/settings';
import { useAccountStore } from '@/store/account';
import { useSyncProgressStore } from '@/store/sync-progress';
import { getSyncPath } from './path.js';
import { SYNC_TRANSPORT, normalizeSyncTransport } from '@/lib/api/types';
import { logger } from '@/utils/logger';

/**
 * Start Rust-owned sync: the progress store and the Rust scheduler, kicked
 * once when a sync target (folder path or authenticated cloud account) is
 * configured. Rust owns the cadence; a cycle without a target is a no-op.
 */
export async function initAppSync() {
  useSyncProgressStore().startListening();

  const syncPath = await getSyncPath();
  const wantsCloud =
    normalizeSyncTransport(getSettingSync('syncTransport')) !==
    SYNC_TRANSPORT.FOLDER;
  const hasSyncTarget =
    Boolean(syncPath) || (wantsCloud && useAccountStore().isAuthenticated);
  if (!hasSyncTarget) return;

  try {
    await startRustSync();
  } catch (err) {
    logger.warn('[sync] Rust scheduler unavailable:', err?.message || err);
    return;
  }

  kickRustSync();
}
