import { ref, computed, reactive } from 'vue';
import { useAccountStore } from '@/store/account';
import {
  getWorkspaces as apiGetWorkspaces,
  createWorkspace as apiCreateWorkspace,
  renameWorkspace as apiRenameWorkspace,
  updateWorkspaceDecoration as apiUpdateWorkspaceDecoration,
  deleteWorkspace as apiDeleteWorkspace,
  addMember as apiAddMember,
  removeMember as apiRemoveMember,
  joinWorkspace as apiJoinWorkspace,
  listMyPendingWorkspaceRequests as apiListMyPendingWorkspaceRequests,
  getWorkspacePublicKeys as apiGetWorkspacePublicKeys,
  recoverWorkspaceKeyHex as apiRecoverWorkspaceKeyHex,
  recoverWorkspaceKeyFromRecord as apiRecoverWorkspaceKeyFromRecord,
  provisionWorkspaceKey as apiProvisionWorkspaceKey,
  getCachedWorkspaceKey,
} from '@/lib/api/workspaces';
import { normalizeWorkspaceList } from '@/lib/api/types';

const workspaces = ref([]);
const activeId = ref(null);
const loading = ref(false);
const error = ref('');
// The caller's own outstanding require-approval join requests, so the switcher
// can show "Awaiting owner approval" rows.
const pendingRequests = ref([]);
// ponytail: Set tracks terminal unwrap/provision failures to prevent infinite retry; cleared on success, retry, or new workspace list. Reactive so the settings notice can surface it.
const provisionFailures = reactive(new Set());
// Devices whose public key changed since we first saw it (TOFU). We refuse to
// share the workspace key with them; persisted so the settings notice can say
// so instead of only logging.
const refusedDeviceKeys = reactive(new Set());

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
    const { listLocalWorkspaces, detachLocalWorkspace } = await import('@/lib/native/workspaces');
    const localWorkspaces = (await listLocalWorkspaces().catch(() => [])) || [];
    const removed = computeRemovedSharedWorkspaces(localWorkspaces, backendWorkspaces);
    if (removed.length === 0) return;

    // A list miss is not proof of deletion: a partial or transient `/workspaces`
    // response (org change, plan blip, pagination) must never destroy local
    // notes. Detach instead of delete — the workspace keeps its directory and
    // notes, just stops being treated as a cloud mirror, and re-attaches
    // automatically if the backend lists it again. Intentional user deletion
    // goes through `deleteWorkspace`, which removes the local mirror only after
    // the server confirms the delete.
    for (const id of removed) {
      try {
        await detachLocalWorkspace(id);
      } catch (err) {
        console.warn(
          `[useCloudWorkspaces] could not detach removed shared workspace ${id}:`,
          err?.message || err
        );
      }
    }
  } catch (err) {
    console.warn('[useCloudWorkspaces] local workspace reconciliation skipped:', err);
  }
}

// Remove the local mirror of a workspace only after the server has confirmed
// its deletion. Switches away first if it is the active workspace, since the
// native delete refuses to remove the active one.
async function removeLocalWorkspace(id) {
  try {
    const {
      listLocalWorkspaces,
      getActiveLocalWorkspace,
      switchLocalWorkspace,
      deleteLocalWorkspace,
    } = await import('@/lib/native/workspaces');
    const localWorkspaces = (await listLocalWorkspaces().catch(() => [])) || [];
    if (!localWorkspaces.some((w) => w.id === id)) return;

    const active = await getActiveLocalWorkspace().catch(() => null);
    if (active?.id === id) {
      const fallback =
        localWorkspaces.find((w) => w.id !== id && w.workspaceType === 'personal')?.id ??
        'default';
      await switchLocalWorkspace(fallback);
    }
    await deleteLocalWorkspace(id);
  } catch (err) {
    console.warn(
      `[useCloudWorkspaces] could not remove local workspace ${id}:`,
      err?.message || err
    );
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
        await recoverDeviceWorkspaceKeys();
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

  async function createWorkspace(name, { emoji, color } = {}) {
    if (!isPaid.value) throw new Error('Cloud workspaces require a paid plan');
    try {
      const raw = await apiCreateWorkspace(name, { baseUrl: activeBaseUrl(), emoji, color });
      const ws = {
        id: raw.id,
        name: raw.name || name,
        role: 'owner',
        ownerId: null,
        storageUsedBytes: 0,
        createdAt: raw.createdAt || null,
        emoji: raw.emoji,
        color: raw.color,
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
    // Server confirmed the deletion, so it is now safe to drop the local mirror.
    // This is the only destructive path; a list miss only detaches.
    await removeLocalWorkspace(id);
  }

  async function renameWorkspace(id, newName) {
    if (!isPaid.value) throw new Error('Cloud workspaces require a paid plan');

    const ws = workspaces.value.find((w) => w.id === id);
    if (!ws) throw new Error('Workspace not found');

    const { importCollabKey } = await import('@/utils/crypto/collab');
    const { encryptName } = await import('@/utils/crypto/comment-crypto');

    // Prefer the locally cached raw key (seeded at creation or after
    // vault-passphrase recovery) to skip the fetch + ML-KEM unwrap path.
    let workspaceKeyHex = getCachedWorkspaceKey(id);
    if (!workspaceKeyHex) {
      const { loadOrCreateIdentity } = await import('@/utils/crypto/identity');
      const identity = await loadOrCreateIdentity();
      if (!identity?.privateKeyHex) throw new Error('Missing encryption identity');
      workspaceKeyHex = await apiRecoverWorkspaceKeyHex(id, identity, { baseUrl: activeBaseUrl() });
      if (!workspaceKeyHex) throw new Error('Cannot decrypt workspace key');
    }
    const key = await importCollabKey(workspaceKeyHex);
    const nameEncrypted = await encryptName(key, newName);

    await apiRenameWorkspace(id, nameEncrypted, { baseUrl: activeBaseUrl() });

    ws.name = newName;
    return ws;
  }

  async function updateWorkspaceDecoration(id, { emoji, color }) {
    if (!isPaid.value) throw new Error('Cloud workspaces require a paid plan');

    const ws = workspaces.value.find((w) => w.id === id);
    if (!ws) throw new Error('Workspace not found');

    await apiUpdateWorkspaceDecoration(id, { emoji, color, baseUrl: activeBaseUrl() });

    if (emoji !== undefined) ws.emoji = emoji;
    if (color !== undefined) ws.color = color;
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
    const result = await apiAddMember(workspaceId, identifier, role, { baseUrl: activeBaseUrl() });
    void retryProvisioning();
    return result;
  }

  async function removeMember(workspaceId, userId) {
    if (!isPaid.value) throw new Error('Cloud workspaces require a paid plan');
    return apiRemoveMember(workspaceId, userId, { baseUrl: activeBaseUrl() });
  }

  async function fetchMyPendingRequests() {
    if (!isAuthenticated.value) {
      pendingRequests.value = [];
      return pendingRequests.value;
    }
    try {
      pendingRequests.value = await apiListMyPendingWorkspaceRequests({ baseUrl: activeBaseUrl() });
    } catch (err) {
      console.warn('[useCloudWorkspaces] failed to load pending join requests:', err?.message || err);
      pendingRequests.value = [];
    }
    return pendingRequests.value;
  }

  async function joinWorkspace(token) {
    if (!isPaid.value) throw new Error('Cloud workspaces require a paid plan');
    const raw = await apiJoinWorkspace(token, { baseUrl: activeBaseUrl() });
    // A require-approval invite returns `{ pending: true }` and grants nothing.
    // Do not reload the workspace list or provision keys as if the join landed;
    // surface the pending state to the caller instead.
    if (raw?.pending) {
      await fetchMyPendingRequests();
      return raw;
    }
    await fetchWorkspaces();
    // Retry provisioning on demand: clear terminal markers so a joiner whose
    // device still lacks an envelope can be re-wrapped by any online key holder.
    void retryProvisioning();
    return raw;
  }

  // On-demand retry: clear the terminal failure markers and re-run provisioning
  // for every workspace this client holds a key for (a key-holding member can
  // re-wrap for members/devices still missing one).
  async function retryProvisioning() {
    provisionFailures.clear();
    refusedDeviceKeys.clear();
    await autoProvisionPendingKeys();
  }

  // UI-facing summary of provisioning problems (console-only before):
  //   'key-changed' -> a device's key changed; we refused to share (TOFU)
  //   'not-synced'  -> this device has no usable envelope / provisioning failed
  //   null          -> nothing actionable
  const provisioningIssue = computed(() => {
    if (refusedDeviceKeys.size > 0) return 'key-changed';
    if (provisionFailures.size > 0) return 'not-synced';
    return null;
  });

  // Wrap the workspace key for every (user, device) the server reports as
  // missing one. Only a device that already holds the plaintext key can wrap
  // it, so this runs on a key-holding member (owner/admin/editor).
  async function provisionMissingDevices(workspaceId, missing) {
    const targets = (missing || []).filter((c) => c?.kemPublicKey);
    if (targets.length === 0) return 0;

    const { loadOrCreateIdentity } = await import('@/utils/crypto/identity');
    const { wrapNoteKeyForRecipient } = await import('@/utils/crypto/note-key');

    const identity = await loadOrCreateIdentity();
    if (!identity?.privateKeyHex) return 0;

    const workspaceKeyHex = await apiRecoverWorkspaceKeyHex(workspaceId, identity, {
      baseUrl: activeBaseUrl(),
    });
    if (!workspaceKeyHex) {
      // No envelope this device can unwrap: unrecoverable until a key-holder
      // re-wraps or the vault key recovers the key. Mark terminal.
      provisionFailures.add(`ws:${workspaceId}`);
      console.warn(`[useCloudWorkspaces] no usable workspace-key envelope for ${workspaceId}`);
      return 0;
    }

    const recipients = [];
    for (const c of targets) {
      // TOFU pin per (user, device): warn if a device key changes. Full
      // transparency needs a server-signed key directory (follow-up).
      try {
        const pinKey = `kem-pin:${c.userId}:${c.deviceId || 'default'}`;
        const pinned = localStorage.getItem(pinKey);
        if (pinned && pinned !== c.kemPublicKey) {
          refusedDeviceKeys.add(`${c.userId}:${c.deviceId || 'default'}`);
          console.warn(`[useCloudWorkspaces] device key changed for ${c.userId}/${c.deviceId}; refusing to provision until re-verified`);
          continue;
        }
        if (!pinned) localStorage.setItem(pinKey, c.kemPublicKey);
      } catch {
        // Pin storage unavailable: provision anyway, server remains authoritative.
      }
      const wrappedKey = await wrapNoteKeyForRecipient(c.kemPublicKey, workspaceKeyHex);
      recipients.push({ userId: c.userId, deviceId: c.deviceId || 'default', wrappedKey });
    }

    if (recipients.length === 0) return 0;
    await apiProvisionWorkspaceKey(workspaceId, recipients, { baseUrl: activeBaseUrl() });
    for (const r of recipients) {
      provisionFailures.delete(`${workspaceId}:${r.userId}:${r.deviceId}`);
    }
    provisionFailures.delete(`ws:${workspaceId}`);
    return recipients.length;
  }

  async function provisionKeysForMember(workspaceId, memberUserId) {
    const collaborators = await apiGetWorkspacePublicKeys(workspaceId, { baseUrl: activeBaseUrl() });
    const missing = collaborators.filter(
      (c) => c?.userId === memberUserId && c?.kemPublicKey && c?.hasEnvelope === false
    );
    return provisionMissingDevices(workspaceId, missing);
  }

  // Silently cache the workspace key for every workspace this device can read
  // from one of its own envelopes: device KEM first, then the legacy items-key
  // (session AEK) envelope. No password is ever requested. A workspace with no
  // usable envelope stays uncached; the key-holder provisioning loop re-wraps
  // it later and SyncProvisioningNotice surfaces it instead of blocking.
  async function recoverDeviceWorkspaceKeys() {
    // Never let silent recovery break workspace loading: a key that cannot be
    // read here is surfaced by the provisioning notice, not an error screen.
    try {
      const candidates = workspaces.value.filter(
        (ws) =>
          !getCachedWorkspaceKey(ws.id) &&
          (ws.wrappedKeys?.length || ws.wrappedKey || ws.vaultWrappedKeys)
      );
      if (candidates.length === 0) return;
      const { loadOrCreateIdentity } = await import('@/utils/crypto/identity');
      const identity = await loadOrCreateIdentity().catch(() => null);
      if (!identity?.privateKeyHex) return;
      for (const ws of candidates) {
        try {
          await apiRecoverWorkspaceKeyFromRecord(ws, identity);
        } catch (err) {
          console.warn(
            `[useCloudWorkspaces] silent workspace-key recovery failed for ${ws.id}:`,
            err?.message || err
          );
        }
      }
    } catch (err) {
      console.warn(
        '[useCloudWorkspaces] silent workspace-key recovery skipped:',
        err?.message || err
      );
    }
  }

  async function autoProvisionPendingKeys() {
    const accountStore = useAccountStore();
    const userId = accountStore.profile?.id;
    if (!userId) return;

    for (const ws of workspaces.value) {
      // Any member who holds the workspace key can re-wrap it for a member or
      // device still missing one (server accepts owner/admin/editor).
      if (!['owner', 'admin', 'editor'].includes(ws.role)) continue;
      if (provisionFailures.has(`ws:${ws.id}`)) continue;

      try {
        const collaborators = await apiGetWorkspacePublicKeys(ws.id, { baseUrl: activeBaseUrl() });
        // `hasEnvelope === false` only: an older server omits the field and we
        // no-op rather than wrap every device on every open.
        const pending = (collaborators || []).filter(
          (c) => c?.kemPublicKey
            && c?.hasEnvelope === false
            && !provisionFailures.has(`${ws.id}:${c.userId}:${c.deviceId || 'default'}`)
        );
        if (pending.length === 0) continue;
        try {
          await provisionMissingDevices(ws.id, pending);
        } catch (err) {
          const msg = err?.message || String(err);
          console.warn(`[useCloudWorkspaces] failed to provision keys for ${ws.id}:`, msg);
          for (const c of pending) {
            provisionFailures.add(`${ws.id}:${c.userId}:${c.deviceId || 'default'}`);
          }
          if (msg.toLowerCase().includes('unwrap') || msg.toLowerCase().includes('decap') || msg.toLowerCase().includes('decrypt')) {
            provisionFailures.add(`ws:${ws.id}`);
          }
        }
      } catch (err) {
        console.warn(`[useCloudWorkspaces] failed to check devices for ${ws.id}:`, err?.message);
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
    updateWorkspaceDecoration,
    deleteWorkspace,
    switchWorkspace,
    addMember,
    removeMember,
    joinWorkspace,
    pendingRequests,
    fetchMyPendingRequests,
    provisionKeysForMember,
    autoProvisionPendingKeys,
    retryProvisioning,
    provisioningIssue,
  };
}
