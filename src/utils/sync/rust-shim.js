import { applyRemote } from '@/lib/yjs/shared.js';
import { base64ToBuf } from '@/utils/crypto/codec.js';
import { getSettingSync } from '@/lib/settings';
import { normalizeSyncTransport } from '@/lib/api/types';
import { logger } from '@/utils/logger';

let rustSyncActive = false;
let rustFolderOwned = false;
let unlistenApplied = null;
let unlistenPushed = null;
let kickTimer = null;
let dirtyTimer = null;

export function isRustSyncActive() {
  return rustSyncActive;
}

export function isRustFolderOwner() {
  return rustFolderOwned;
}

export async function refreshRustOwnership() {
  try {
    const { getSyncPath } = await import('./path.js');
    const folderId = (await getSyncPath().catch(() => '')) || '';
    rustFolderOwned = rustSyncActive && Boolean(folderId) && !folderId.startsWith('scoped:');
  } catch {}
  return rustFolderOwned;
}

async function getSyncConfig() {
  const { useAccountStore } = await import('@/store/account');
  const { useWorkspaceStore } = await import('@/store/workspace');
  const { getSyncPath } = await import('./path.js');
  let folderId = '';
  try {
    folderId = (await getSyncPath()) || '';
  } catch {
    folderId = '';
  }

  // Canonical transport decision mirrors `app-sync.js` (`wantsCloud`); Rust
  // only special-cases `"folder"` to disable the cloud path.
  const transport = normalizeSyncTransport(getSettingSync('syncTransport'));

  return {
    workspace_id: useWorkspaceStore().activeId || '',
    server_url: useAccountStore().serverUrl || '',
    token: useAccountStore().token || '',
    folder_id: folderId,
    transport,
  };
}

async function invokeSync(channel) {
  const { backend } = await import('@/lib/tauri-bridge');
  return backend.invoke(channel, await getSyncConfig());
}

async function hydrateAfterApply(noteIds) {
  try {
    const { writeStoresFromWorkspace } = await import('@/lib/yjs/meta-store.js');
    // Folders/labels/colors live inside the workspace ('meta') doc and the
    // incremental path only rebuilds them when flagged. A pulled meta update
    // must set the flags, otherwise peer folders/labels never appear.
    const metaChanged = noteIds.includes('meta');
    await writeStoresFromWorkspace(new Set(noteIds), {
      labels: metaChanged,
      labelColors: metaChanged,
      folders: metaChanged,
      deleted: false,
    });
  } catch (err) {
    logger.warn('[sync] store refresh after rust pull failed:', err?.message);
  }
  // ponytail: no placeholder creation here. Synthesizing title:'' for ids
  // whose meta hasn't arrived yet is what flashes "Untitled". The note
  // appears one tick later with its real title instead.
}

export async function applySyncedNotes(noteIds) {
  if (!noteIds?.length) return;
  logger.debug('[sync] applied notes from rust pull:', noteIds.join(','));
  const { backend } = await import('@/lib/tauri-bridge');
  try {
    const { invoke } = await import('@/lib/tauri-bridge').catch(() => ({}));
    void invoke;
    const snapshots = await backend.invoke('yjs:getSnapshots', noteIds);
    const entries = Array.isArray(snapshots)
      ? snapshots
      : Object.entries(snapshots || {}).map(([noteId, snapshot]) => ({ noteId, snapshot }));
    // Meta first so workspace titles exist before content previews hydrate.
    entries.sort((a, b) => {
      const aid = a.noteId ?? a[0];
      const bid = b.noteId ?? b[0];
      if (aid === 'meta') return -1;
      if (bid === 'meta') return 1;
      return 0;
    });
    for (const entry of entries) {
      try {
        const noteId = entry.noteId ?? entry[0];
        const snapshot = entry.snapshot ?? entry[1];
        if (!noteId || !snapshot) continue;
        applyRemote(noteId, base64ToBuf(snapshot));
      } catch (err) {
        logger.warn('[sync] snapshot apply failed, skipping note in batch', err?.message);
      }
    }
  } catch {
    for (const noteId of noteIds) {
      try {
        const snapshot = await backend.invoke('yjs:getSnapshot', noteId);
        if (!snapshot) continue;
        applyRemote(noteId, base64ToBuf(snapshot));
      } catch (err) {
        logger.warn('[sync] snapshot apply failed for', noteId, err?.message);
      }
    }
  }
  await hydrateAfterApply(noteIds);
}

export async function stopRustSync() {
  rustSyncActive = false;
  rustFolderOwned = false;
  if (kickTimer) { clearTimeout(kickTimer); kickTimer = null; }
  if (dirtyTimer) { clearTimeout(dirtyTimer); dirtyTimer = null; }
  try {
    const { backend } = await import('@/lib/tauri-bridge');
    await backend.invoke('sync:stop');
  } catch {}
}

export async function startRustSync() {
  const config = await getSyncConfig();
  const { backend } = await import('@/lib/tauri-bridge');

  await backend.invoke('sync:start', config);
  rustSyncActive = true;
  rustFolderOwned =
    Boolean(config.folder_id) && !config.folder_id.startsWith('scoped:');
  if (!unlistenApplied) {
    unlistenApplied = await backend.listenPayload('sync:applied', (payload) => {
      applySyncedNotes(payload?.noteIds ?? []).catch(() => {});
    });
  }
  if (!unlistenPushed) {
    unlistenPushed = await backend.listenPayload('sync:pushed', (payload) => {
      void handlePushed(payload);
    });
  }
}

async function handlePushed(payload) {
  try {
    const { ensureSyncKeyReadyForWrite } = await import('./crypto.js');
    await ensureSyncKeyReadyForWrite();
  } catch (err) {
    logger.debug('[sync] skipping history commits, key not ready:', err?.message);
    return;
  }
  try {
    const { recordPushedCommits } = await import('./record-commits.js');
    await recordPushedCommits(payload?.noteIds ?? []);
  } catch (err) {
    logger.warn('[sync] history commit recording failed:', err?.message);
  }
}

function kick(timerName, channel, ms) {
  if (!rustSyncActive) return timerName === 'kick' ? false : undefined;
  if (timerName === 'kick') {
    if (kickTimer) return true;
    kickTimer = setTimeout(async () => {
      kickTimer = null;
      try {
        await invokeSync(channel);
      } catch {}
    }, ms);
    return true;
  }
  if (dirtyTimer) return undefined;
  dirtyTimer = setTimeout(async () => {
    dirtyTimer = null;
    try {
      await invokeSync(channel);
    } catch {}
  }, ms);
  return undefined;
}

export function kickRustSync() {
  return kick('kick', 'sync:kick', 150);
}

export function kickRustDirty() {
  return kick('dirty', 'sync:kick-dirty', 300);
}
