import { applyRemote } from '@/lib/yjs/shared.js';
import { base64ToBuf } from '@/utils/crypto/codec.js';

let rustSyncActive = false;
let rustFolderOwned = false;
let unlistenApplied = null;
let kickTimer = null;
let dirtyTimer = null;

export function isRustSyncActive() {
  return rustSyncActive;
}

export function isRustFolderOwner() {
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

  return {
    workspace_id: useWorkspaceStore().activeId || '',
    server_url: useAccountStore().serverUrl || '',
    token: useAccountStore().token || '',
    folder_id: folderId,
  };
}

async function invokeSync(channel) {
  const { backend } = await import('@/lib/tauri-bridge');
  return backend.invoke(channel, await getSyncConfig());
}

export async function applySyncedNotes(noteIds) {
  if (!noteIds?.length) return;
  const { backend } = await import('@/lib/tauri-bridge');
  for (const noteId of noteIds) {
    try {
      const snapshot = await backend.invoke('yjs:getSnapshot', noteId);
      if (!snapshot) continue;
      applyRemote(noteId, base64ToBuf(snapshot));
    } catch {

    }
  }
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
}

export async function stopRustSync() {
  rustSyncActive = false;
  rustFolderOwned = false;
  if (unlistenApplied) {
    try {
      await unlistenApplied();
    } catch {

    }
    unlistenApplied = null;
  }
  if (kickTimer) {
    clearTimeout(kickTimer);
    kickTimer = null;
  }
  if (dirtyTimer) {
    clearTimeout(dirtyTimer);
    dirtyTimer = null;
  }
  try {
    const { backend } = await import('@/lib/tauri-bridge');
    await backend.invoke('sync:stop', {});
  } catch {

  }
}

export function kickRustSync() {
  if (!rustSyncActive) return false;
  if (kickTimer) return true;
  kickTimer = setTimeout(async () => {
    kickTimer = null;
    try {
      await invokeSync('sync:kick');
    } catch {

    }
  }, 500);
  return true;
}

export function kickRustDirty() {
  if (!rustSyncActive) return;
  if (dirtyTimer) return;
  dirtyTimer = setTimeout(async () => {
    dirtyTimer = null;
    try {
      await invokeSync('sync:kick-dirty');
    } catch {

    }
  }, 1000);
}
