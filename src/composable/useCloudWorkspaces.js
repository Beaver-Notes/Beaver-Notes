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
  getWorkspaceKeyRecord as apiGetWorkspaceKeyRecord,
  provisionWorkspaceKey as apiProvisionWorkspaceKey,
  getCachedWorkspaceKey,
} from '@/lib/api/workspaces';
import { normalizeWorkspaceList } from '@/lib/api/types';
import { getActiveAccountId, listAccounts } from '@/lib/accounts-index';

const workspaces = ref([]);
const activeId = ref(null);
const loading = ref(false);
const error = ref('');
// The caller's own outstanding require-approval join requests, so the switcher
// can show "Awaiting owner approval" rows.
const pendingRequests = ref([]);
// ponytail: Set tracks terminal unwrap/provision failures to prevent infinite retry; cleared on success, retry, or new workspace list. Reactive so the settings notice can surface it.
const provisionFailures = reactive(new Set());
// Same-account retryable misses: this device has no usable envelope yet but a
// later fetch may (vault unlock, late envelope). Surfaces not-synced without
// arming the terminal skip, so the next pass re-fetches instead of no-op'ing.
const provisionPending = reactive(new Set());
// Devices whose public key changed since we first saw it (TOFU). We refuse to
// share the workspace key with them; persisted so the settings notice can say
// so instead of only logging.
const refusedDeviceKeys = reactive(new Set());

let fetchController = null;
let fetchInFlight = null;

/**
 * Drop every list this module holds in memory. An account switch must not let
 * the leaving account's workspace rows paint for the arriving one; the arriving
 * account fetches its own list afterwards.
 */
export function resetWorkspaceModuleState() {
  workspaces.value = [];
  activeId.value = null;
  pendingRequests.value = [];
  provisionFailures.clear();
  provisionPending.clear();
  refusedDeviceKeys.clear();
  fetchController = null;
  fetchInFlight = null;
}

/**
 * The account a workspace belongs to, for the switcher's grouping. A note
 * shared to us by single-note invite lives under whichever account is active,
 * so an unlisted workspace falls back to the active account rather than none.
 */
export function findWorkspaceAccount(workspaceId) {
  const owner = listAccounts().find((account) =>
    (account.workspaces || []).some((ws) => ws.id === workspaceId),
  );
  return owner?.id ?? getActiveAccountId();
}

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

// Stop realtime, flush buffered meta writes, and destroy the singleton
// workspace doc. Runs before a native workspace switch so the flush lands in
// the still-active pool and nothing keeps writing after the pools swap —
// otherwise stale content leaks into the target workspace (note_content rows
// written at switch time). Mirrors the sign-out teardown in useAccountAuth;
// callers reload right after, and startup rebuilds everything for the new
// workspace.
async function teardownLiveWorkspaceState() {
  try {
    const { getWsSync } = await import('@/lib/sync/ws-sync.js');
    getWsSync().stop();
  } catch (err) {
    console.warn('[useCloudWorkspaces] ws teardown failed:', err?.message || err);
  }
  try {
    const [{ flushPendingMetaUpdates }, { destroyWorkspaceDoc }] = await Promise.all([
      import('@/lib/yjs/workspace-doc.js'),
      import('@/lib/yjs/meta-doc.js'),
    ]);
    await flushPendingMetaUpdates();
    destroyWorkspaceDoc();
  } catch (err) {
    console.warn('[useCloudWorkspaces] workspace doc teardown failed:', err?.message || err);
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
          // The native active id is the persisted one; honor it so a reload
          // doesn't silently move the user back to the first workspace.
          const { getActiveLocalWorkspace } = await import('@/lib/native/workspaces');
          const local = await getActiveLocalWorkspace().catch(() => null);
          const localInList = local?.id && workspaces.value.some((w) => w.id === local.id);
          activeId.value = localInList ? local.id : workspaces.value[0].id;
        }
        await registerCloudWorkspaces(workspaces.value, accountStore);
        await ensureDeviceKeyRegistered();
        await recoverDeviceWorkspaceKeys();
        // New fetch epoch: recovery already re-checked last epoch's retryable
        // misses against fresh records, so drop the rest and let the pass
        // below retry instead of skipping on a stale marker.
        provisionPending.clear();
        void autoProvisionPendingKeys();
        // Notes invited to this account directly (not members of the owning
        // workspace) are listed and synced under their owning workspace.
        import('@/composable/useSharedNotes')
          .then(({ useSharedNotes }) => useSharedNotes().fetchSharedNotes())
          .catch(() => {});
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
      void registerCloudWorkspaces([ws], accountStore);
      // The create payload wraps the key for this account only; give this device
      // its own envelope now so sync works before the next provisioning pass.
      void ensureOwnDeviceEnvelope(ws.id);
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
    // Teardown first: pending writes must reach the OLD pool and the live doc
    // must die before workspace_switch swaps pools (see teardownLiveWorkspaceState).
    await teardownLiveWorkspaceState();
    // Persist natively too: workspace_switch saves the active id and swaps the
    // data/settings pools, which is what actually switches content. Callers
    // reload right after, satisfying the native "reload stores" contract.
    try {
      const { switchLocalWorkspace } = await import('@/lib/native/workspaces');
      await switchLocalWorkspace(id);
    } catch (err) {
      console.warn('[useCloudWorkspaces] native workspace switch failed:', err?.message || err);
    }
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
    provisionPending.clear();
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
    if (provisionPending.size > 0) return 'not-synced';
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
      // No envelope this device can unwrap yet (fresh device, locked vault):
      // retryable, not terminal. Surfaces not-synced via provisionPending and
      // re-arms on the next fetch; a terminal marker here would skip forever.
      provisionPending.add(`ws:${workspaceId}`);
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
    provisionPending.delete(`ws:${workspaceId}`);
    return recipients.length;
  }

  // A workspace created here starts with an account-level envelope, and a
  // workspace whose key we recovered locally holds no device envelope at all.
  // Either way this device is reported as `hasEnvelope: false`, so nothing in the
  // key-holder loop can hand it back a key it already holds. Wrap the key we
  // already have for our own device and upload it; the other devices then fall
  // to the normal `autoProvisionPendingKeys` path. Failure is transient (a
  // network blip, a server without the route yet) so it only warns: no
  // provisionFailures marker, so the next load retries.
  async function ensureOwnDeviceEnvelope(workspaceId, workspaceKeyHex) {
    const key = workspaceKeyHex ?? getCachedWorkspaceKey(workspaceId);
    if (!key) return false;
    try {
      const { loadOrCreateIdentity } = await import('@/utils/crypto/identity');
      const { wrapNoteKeyForRecipient } = await import('@/utils/crypto/note-key');
      const identity = await loadOrCreateIdentity();
      if (!identity?.publicKeyHex) return false;

      const collaborators = await apiGetWorkspacePublicKeys(workspaceId, { baseUrl: activeBaseUrl() });
      // Match on the published public key rather than a device id: it is the
      // one identifier this device is certain of, and the server record supplies
      // the deviceId to register the envelope under.
      const self = (collaborators || []).find(
        (c) => c?.kemPublicKey && c.kemPublicKey === identity.publicKeyHex
      );
      if (!self || self.hasEnvelope !== false) return false;

      const deviceId = self.deviceId || 'default';
      const pinKey = `kem-pin:${self.userId}:${deviceId}`;
      try {
        const pinned = localStorage.getItem(pinKey);
        if (pinned && pinned !== self.kemPublicKey) {
          console.warn(
            `[useCloudWorkspaces] own device key changed for ${self.userId}/${deviceId}; not re-uploading envelope for ${workspaceId}`
          );
          return false;
        }
        if (!pinned) localStorage.setItem(pinKey, self.kemPublicKey);
      } catch {
        // Pin storage unavailable: upload anyway, server remains authoritative.
      }

      const wrappedKey = await wrapNoteKeyForRecipient(self.kemPublicKey, key);
      await apiProvisionWorkspaceKey(
        workspaceId,
        [{ userId: self.userId, deviceId, wrappedKey }],
        { baseUrl: activeBaseUrl() }
      );
      provisionFailures.delete(`ws:${workspaceId}`);
      provisionPending.delete(`ws:${workspaceId}`);
      return true;
    } catch (err) {
      console.warn(
        `[useCloudWorkspaces] could not upload own device key for ${workspaceId}:`,
        err?.message || err
      );
      return false;
    }
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
  // On a clean-reset device the identity is fresh, so registration runs first:
  // without the new public key on the server no envelope can ever target it.
  async function ensureDeviceKeyRegistered() {
    try {
      const { loadOrCreateIdentity, publishIdentity } = await import('@/utils/crypto/identity');
      const { loadAccountDeviceId, saveAccountDeviceId } = await import('@/lib/account-storage');
      const { getSyncDeviceId } = await import('@/utils/sync/sync-repository.js');
      const identity = await loadOrCreateIdentity().catch(() => null);
      if (!identity?.publicKeyHex) return;
      const profileKey = accountStore.profile?.kemPublicKey;
      if (profileKey && profileKey === identity.publicKeyHex) return;
      let deviceId = (await getSyncDeviceId().catch(() => null)) || (await loadAccountDeviceId().catch(() => null));
      if (!deviceId) {
        deviceId =
          typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
            ? crypto.randomUUID()
            : `dev-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
        try {
          await saveAccountDeviceId(deviceId);
        } catch {
          // Persist is best-effort; the keypair post below still registers it.
        }
      }
      await publishIdentity(identity, deviceId, activeBaseUrl());
      try {
        const { getAccount } = await import('@/lib/api/account');
        const refreshed = await getAccount({ baseUrl: activeBaseUrl() });
        if (refreshed?.profile) accountStore.setProfile(refreshed.profile);
      } catch {
        // Profile refresh is best-effort; the keypair post already landed.
      }
    } catch (err) {
      console.warn('[useCloudWorkspaces] device key registration failed:', err?.message || err);
    }
  }

  async function recoverDeviceWorkspaceKeys() {
    // Never let silent recovery break workspace loading: a key that cannot be
    // read here is surfaced by the provisioning notice, not an error screen.
    try {
      const cached = (ws) => {
        try {
          return getCachedWorkspaceKey(ws.id);
        } catch {
          return null;
        }
      };
      // Recovery runs from the fetch list first (the record the server just
      // handed back), then re-checks any key record that landed late: an
      // envelope provisioned by the other device after this fetch's first
      // pass only becomes readable on a fresh read.
      const seen = new Set();
      const fromFetch = workspaces.value.filter(
        (ws) =>
          !cached(ws) &&
          (ws.wrappedKeys?.length || ws.wrappedKey || ws.vaultWrappedKeys)
      );
      if (fromFetch.length === 0 && provisionPending.size === 0) return;
      const { loadOrCreateIdentity } = await import('@/utils/crypto/identity');
      const identity = await loadOrCreateIdentity().catch(() => null);
      if (!identity?.privateKeyHex) return;
      const recoverOne = async (ws) => {
        if (!ws?.id || seen.has(ws.id) || cached(ws)) return;
        seen.add(ws.id);
        try {
          const recovered = await apiRecoverWorkspaceKeyFromRecord(ws, identity);
          if (recovered) {
            provisionPending.delete(`ws:${ws.id}`);
            await repairMetaRoomJoin(ws.id, recovered);
          }
        } catch (err) {
          console.warn(
            `[useCloudWorkspaces] silent workspace-key recovery failed for ${ws.id}:`,
            err?.message || err
          );
        }
      };
      for (const ws of fromFetch) {
        await recoverOne(ws);
      }
      // Late envelopes: a workspace whose no-usable-envelope pass parked a
      // retryable marker gets one fresh server read per recovery run, so the
      // first device to provision unblocks the parked meta join in this fetch.
      // One read per pending workspace per run, no loop — no infinite retry.
      for (const key of provisionPending) {
        if (!key.startsWith('ws:')) continue;
        const workspaceId = key.slice(3);
        if (seen.has(workspaceId) || !workspaces.value.some((ws) => ws.id === workspaceId)) continue;
        try {
          const record = await apiGetWorkspaceKeyRecord(workspaceId, { baseUrl: activeBaseUrl() });
          if (record) await recoverOne(record);
        } catch (err) {
          console.warn(
            `[useCloudWorkspaces] late envelope check failed for ${workspaceId}:`,
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

  // A key that lands after the first meta-room attempt (clean-reset sign-in:
  // the envelope only became readable once this fetch's recovery ran) must
  // revive the parked join instead of waiting for a reload. setRoomKey on the
  // meta room re-runs joinMetaRoom via pendingKeyJoins; no-op when already keyed.
  async function repairMetaRoomJoin(workspaceId, workspaceKeyHex) {
    if (!workspaceId || !workspaceKeyHex) return;
    try {
      const { setRoomKey, buildMetaRoomName, getWsSync } = await import('@/lib/sync/ws-sync');
      await setRoomKey(buildMetaRoomName(workspaceId), workspaceKeyHex);
      getWsSync().joinMetaRoom(workspaceId);
    } catch (err) {
      console.warn(`[useCloudWorkspaces] meta room repair failed for ${workspaceId}:`, err?.message || err);
    }
  }

  async function autoProvisionPendingKeys() {
    const accountStore = useAccountStore();
    const userId = accountStore.profile?.id;
    if (!userId) return;

    // Workspaces already parked as retryable this epoch are not re-fetched in
    // this same pass — a no-usable-envelope result does no fetch on its own,
    // so re-entering would only re-park. The next fetch epoch re-arms them.
    // Direct repeats without a fetch (the contract tests) still re-run: they
    // assert observable retry, not fetch counts.
    const parkedThisPass = new Set();
    for (const ws of workspaces.value) {
      // Any member who holds the workspace key can re-wrap it for a member or
      // device still missing one (server accepts owner/admin/editor).
      if (provisionFailures.has(`ws:${ws.id}`)) continue;
      if (parkedThisPass.has(ws.id) || provisionPending.has(`ws:${ws.id}`)) continue;
      // Before wrapping for anyone else: make sure this device itself is
      // covered, otherwise every recipient below needs a key we cannot read.
      // Needs no role — it only re-uploads a key this device already holds.
      await ensureOwnDeviceEnvelope(ws.id);
      if (!['owner', 'admin', 'editor'].includes(ws.role)) continue;

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
        const hadPendingMarker = provisionPending.has(`ws:${ws.id}`);
        try {
          await provisionMissingDevices(ws.id, pending);
          // A no-usable-envelope pass just parked a retryable marker: skip any
          // later duplicate entry for this workspace in the same pass.
          if (!hadPendingMarker && provisionPending.has(`ws:${ws.id}`)) {
            parkedThisPass.add(ws.id);
          }
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
    resetWorkspaceModuleState,
    // The account switch tears the live workspace down itself (it swaps pools
    // directly), so it needs this one by name.
    teardownLiveWorkspaceState,
    findWorkspaceAccount,
  };
}
