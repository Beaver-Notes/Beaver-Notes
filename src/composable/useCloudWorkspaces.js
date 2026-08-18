import { ref, computed } from 'vue';
import { useAccountStore } from '@/store/account';
import {
  getWorkspaces as apiGetWorkspaces,
  createWorkspace as apiCreateWorkspace,
  renameWorkspace as apiRenameWorkspace,
  deleteWorkspace as apiDeleteWorkspace,
  addMember as apiAddMember,
  removeMember as apiRemoveMember,
  joinWorkspace as apiJoinWorkspace,
  getWorkspaceMembers as apiGetWorkspaceMembers,
  provisionWorkspaceKey as apiProvisionWorkspaceKey,
} from '@/lib/api/workspaces';
import { normalizeWorkspaceList } from '@/lib/api/types';

const workspaces = ref([]);
const activeId = ref(null);
const loading = ref(false);
const error = ref('');

let fetchController = null;
let fetchInFlight = null;

export function computeRemovedSharedWorkspaces(localWorkspaces, backendWorkspaces) {
  const backendIds = new Set((backendWorkspaces || []).map((w) => w.id));
  return (localWorkspaces || [])
    .filter((w) => w.workspaceType === 'shared' && w.cloudSync && !backendIds.has(w.id))
    .map((w) => w.id);
}

async function reconcileRemovedSharedWorkspaces(backendWorkspaces) {
  try {
    const {
      listLocalWorkspaces,
      getActiveLocalWorkspace,
      switchLocalWorkspace,
      deleteLocalWorkspace,
    } = await import('@/lib/native/workspaces');
    const localWorkspaces = (await listLocalWorkspaces().catch(() => [])) || [];
    const removed = computeRemovedSharedWorkspaces(localWorkspaces, backendWorkspaces);
    if (removed.length === 0) return;

    const active = await getActiveLocalWorkspace().catch(() => null);
    const activeId = active?.id;
    const remainingPersonal = localWorkspaces.find(
      (w) => w.workspaceType === 'personal' && !removed.includes(w.id)
    );
    const fallbackId = remainingPersonal?.id ?? 'default';

    for (const id of removed) {
      try {
        if (id === activeId) {
          await switchLocalWorkspace(fallbackId);
        }
        await deleteLocalWorkspace(id);
      } catch (err) {
        console.warn(
          `[useCloudWorkspaces] could not delete removed shared workspace ${id}:`,
          err?.message || err
        );
      }
    }
  } catch (err) {
    console.warn('[useCloudWorkspaces] local workspace reconciliation skipped:', err);
  }
}

async function registerCloudWorkspaces(backendWorkspaces, accountStore) {
  if (!Array.isArray(backendWorkspaces) || backendWorkspaces.length === 0) return;
  const { registerLocalWorkspace } = await import('@/lib/native/workspaces');
  const personalOrgId =
    accountStore.activeAccount?.organizations?.[0]?.id ??
    accountStore.activeOrgId ??
    null;
  for (const ws of backendWorkspaces) {
    const isShared = Boolean(ws.orgId) && ws.orgId !== personalOrgId;
    try {
      await registerLocalWorkspace({
        id: ws.id,
        name: ws.name,
        orgId: ws.orgId,
        ownerId: ws.ownerId,
        workspaceType: isShared ? 'shared' : 'personal',
        createdAt: ws.createdAt,
      });
    } catch (err) {
      console.warn(
        `[useCloudWorkspaces] could not register workspace ${ws.id}:`,
        err?.message || err
      );
    }
  }
}

export function useCloudWorkspaces() {
  const accountStore = useAccountStore();

  function activeBaseUrl() {
    return accountStore.serverUrl;
  }

  const activeWorkspace = computed(() =>
    workspaces.value.find((w) => w.id === activeId.value) ?? null
  );

  const isPaid = computed(() => accountStore.isPaidPlan);
  const isAuthenticated = computed(() => accountStore.isAuthenticated);

  async function fetchWorkspaces() {
    if (!isAuthenticated.value) return;
    // Coalesce concurrent callers (e.g. App.vue mount + workspace store boot)
    // into a single request instead of aborting and re-firing.
    if (fetchInFlight) return fetchInFlight;
    loading.value = true;
    error.value = '';
    if (fetchController) fetchController.abort();
    fetchController = new AbortController();
    fetchInFlight = (async () => {
      try {
        const raw = await apiGetWorkspaces({ baseUrl: activeBaseUrl(), signal: fetchController.signal });
        workspaces.value = normalizeWorkspaceList(raw);
        if (!activeId.value && workspaces.value.length > 0) {
          activeId.value = workspaces.value[0].id;
        }
        await registerCloudWorkspaces(workspaces.value, accountStore);
        void autoProvisionPendingKeys();
        // Removal reconciliation must not hold `loading` during the delete loop.
        void reconcileRemovedSharedWorkspaces(workspaces.value);
      } catch (err) {
        if (err?.name === 'AbortError') return;
        error.value = err?.message || 'Failed to load workspaces';
        console.error('[useCloudWorkspaces] fetchWorkspaces failed:', err);
      } finally {
        loading.value = false;
        fetchInFlight = null;
      }
    })();
    return fetchInFlight;
  }

  async function createWorkspace(name) {
    if (!isPaid.value) throw new Error('Cloud workspaces require a paid plan');
    try {
      const raw = await apiCreateWorkspace(name, { baseUrl: activeBaseUrl() });
      const ws = {
        id: raw.id,
        name: raw.name || name,
        role: 'owner',
        ownerId: null,
        storageUsedBytes: 0,
        createdAt: raw.createdAt || null,
      };
      workspaces.value.push(ws);
      activeId.value = ws.id;
      void registerCloudWorkspaces([ws], accountStore);
      return ws;
    } catch (err) {
      error.value = err?.message || 'Failed to create workspace';
      throw err;
    }
  }

  async function deleteWorkspace(id) {
    if (!isPaid.value) throw new Error('Cloud workspaces require a paid plan');
    const previous = workspaces.value.slice();
    workspaces.value = workspaces.value.filter((w) => w.id !== id);
    if (activeId.value === id) {
      activeId.value = workspaces.value[0]?.id ?? null;
    }
    try {
      await apiDeleteWorkspace(id, { baseUrl: activeBaseUrl() });
    } catch (err) {
      workspaces.value = previous;
      error.value = err?.message || 'Failed to delete workspace';
      throw err;
    }
  }

  async function renameWorkspace(id, newName) {
    if (!isPaid.value) throw new Error('Cloud workspaces require a paid plan');

    const ws = workspaces.value.find((w) => w.id === id);
    if (!ws) throw new Error('Workspace not found');

    const { loadOrCreateIdentity } = await import('@/utils/crypto/identity');
    const { unwrapNoteKey } = await import('@/utils/crypto/note-key');
    const { importCollabKey } = await import('@/utils/crypto/collab');
    const { encryptName } = await import('@/utils/crypto/comment-crypto');

    const identity = await loadOrCreateIdentity();
    if (!identity?.privateKeyHex) throw new Error('Missing encryption identity');

    const raw = await apiGetWorkspaces({ baseUrl: activeBaseUrl() });
    const wsData = raw.find((w) => w.id === id);
    if (!wsData?.wrappedKey) throw new Error('Cannot decrypt workspace key');

    const workspaceKeyHex = await unwrapNoteKey(identity.privateKeyHex, wsData.wrappedKey);
    const key = await importCollabKey(workspaceKeyHex);
    const nameEncrypted = await encryptName(key, newName);

    await apiRenameWorkspace(id, nameEncrypted, { baseUrl: activeBaseUrl() });

    ws.name = newName;
    return ws;
  }

  async function switchWorkspace(id) {
    if (activeId.value === id) return;
    const previous = activeId.value;
    activeId.value = id;
    return { previous };
  }

  async function addMember(workspaceId, identifier, role = 'editor') {
    if (!isPaid.value) throw new Error('Cloud workspaces require a paid plan');
    return apiAddMember(workspaceId, identifier, role, { baseUrl: activeBaseUrl() });
  }

  async function removeMember(workspaceId, userId) {
    if (!isPaid.value) throw new Error('Cloud workspaces require a paid plan');
    return apiRemoveMember(workspaceId, userId, { baseUrl: activeBaseUrl() });
  }

  async function joinWorkspace(token) {
    if (!isPaid.value) throw new Error('Cloud workspaces require a paid plan');
    const raw = await apiJoinWorkspace(token, { baseUrl: activeBaseUrl() });
    await fetchWorkspaces();
    return raw;
  }

  async function provisionKeysForMember(workspaceId, memberUserId) {
    const { loadOrCreateIdentity } = await import('@/utils/crypto/identity');
    const { unwrapNoteKey, wrapNoteKeyForRecipient } = await import('@/utils/crypto/note-key');

    const identity = await loadOrCreateIdentity();
    if (!identity?.privateKeyHex || !identity?.publicKeyHex) return false;

    const raw = await apiGetWorkspaces({ baseUrl: activeBaseUrl() });
    const ws = raw?.workspaces?.find((w) => w.id === workspaceId);
    if (!ws?.wrappedKey) return false;

    const workspaceKeyHex = await unwrapNoteKey(identity.privateKeyHex, ws.wrappedKey);
    const wrappedForTarget = await wrapNoteKeyForRecipient(identity.publicKeyHex, workspaceKeyHex);
    await apiProvisionWorkspaceKey(workspaceId, memberUserId, wrappedForTarget, { baseUrl: activeBaseUrl() });
    return true;
  }

  async function autoProvisionPendingKeys() {
    const accountStore = useAccountStore();
    const userId = accountStore.profile?.id;
    if (!userId) return;

    for (const ws of workspaces.value) {
      if (ws.role !== 'owner' && ws.role !== 'admin') continue;
      if (!ws.wrappedKey) continue;

      try {
        const { members } = await apiGetWorkspaceMembers(ws.id, { baseUrl: activeBaseUrl() });
        const pending = (members || []).filter(
          (m) => m.userId !== userId && m.hasKeyPair && !m.hasWrappedKey
        );
        for (const member of pending) {
          try {
            await provisionKeysForMember(ws.id, member.userId);
          } catch (err) {
            console.warn(`[useCloudWorkspaces] failed to provision key for ${member.userId} in ${ws.id}:`, err?.message);
          }
        }
      } catch (err) {
        console.warn(`[useCloudWorkspaces] failed to check members for ${ws.id}:`, err?.message);
      }
    }
  }

  return {
    workspaces,
    activeId,
    activeWorkspace,
    loading,
    error,
    isPaid,
    isAuthenticated,
    fetchWorkspaces,
    createWorkspace,
    renameWorkspace,
    deleteWorkspace,
    switchWorkspace,
    addMember,
    removeMember,
    joinWorkspace,
    provisionKeysForMember,
    autoProvisionPendingKeys,
  };
}
