import { ref } from 'vue';
import { useAccountStore } from '@/store/account';
import { useCollaboratorStore } from '@/store/collaborator';
import {
  createCollaborationKey as apiCreateKey,
  getCollaborationKey as apiGetKey,
  listCollaboratorPublicKeys as apiListPublicKeys,
  storeRecipients as apiStoreRecipients,
  inviteCollaborator as apiInvite,
  listCollaborators as apiList,
  removeCollaborator as apiRemove,
  generateInviteLink as apiGenerateLink,
  listInviteLinks as apiListLinks,
  revokeInviteLink as apiRevokeLink,
  requestKeyDistribution,
} from '@/lib/api/collaboration';
import { loadOrCreateIdentity } from '@/utils/crypto/identity';
import {
  provisionNoteKey,
  recoverNoteKeyFromEnvelopes,
  clearUnwrappedKeyCache,
} from '@/utils/crypto/note-key';
import { loadAccountDeviceId, saveAccountDeviceId } from '@/lib/account-storage';

// Module-level so the key-distributor background task can resolve a note's
// collaborator device public keys without spinning up the full composable.
export async function fetchCollaboratorPublicKeys(noteId) {
  const accountStore = useAccountStore();
  const baseUrl = accountStore.serverUrl;
  try {
    return await apiListPublicKeys(noteId, { baseUrl });
  } catch (err) {
    // First touch of a note: the caller may not be a collaborator yet.
    // Listing invitations auto-grants the self-invitation, after which the
    // public-keys endpoint (gated to collaborators) accepts the request.
    if (err?.status !== 403) throw err;
    await apiList(noteId, { baseUrl });
    return apiListPublicKeys(noteId, { baseUrl });
  }
}

export function useNoteSharing() {
  const accountStore = useAccountStore();
  const collaboratorStore = useCollaboratorStore();
  const collaborators = ref([]);
  const loading = ref(false);
  const error = ref('');
  const key = ref(null);
  const inviteLinks = ref([]);
  const linkLoading = ref(false);
  let fetchAbortController = null;

  function activeBaseUrl() {
    return accountStore.serverUrl;
  }

  async function ensureDeviceId() {
    let id = await loadAccountDeviceId();
    if (!id) {
      id =
        typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : `dev-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
      try {
        await saveAccountDeviceId(id);
      } catch (err) {
        console.error('[useNoteSharing] saveAccountDeviceId failed:', err);
      }
    }
    return id;
  }

  async function fetchCollaborators(noteId) {
    if (!accountStore.isAuthenticated) return;

    // Cancel any in-flight request
    if (fetchAbortController) {
      fetchAbortController.abort();
    }
    fetchAbortController = new AbortController();
    const { signal } = fetchAbortController;

    loading.value = true;
    error.value = '';
    try {
      const raw = await apiList(noteId, { baseUrl: activeBaseUrl(), signal });
      // Check if request was cancelled
      if (signal.aborted) return;

      collaborators.value = Array.isArray(raw)
        ? raw.map((inv) => ({
            userId: inv.userId || inv.user_id,
            username: inv.username || null,
            email: inv.email || null,
            role: inv.role || 'editor',
            invitedAt: inv.invitedAt || inv.invited_at || null,
          }))
        : [];
      collaboratorStore.setCollaborators(noteId, collaborators.value);
    } catch (err) {
      // Ignore abort errors (expected during navigation)
      if (err?.name === 'AbortError' || signal.aborted) return;

      // 403 means user is not invited — treat as "no collaborators" rather than error
      if (err?.status === 403) {
        collaborators.value = [];
        return;
      }

      error.value = err?.message || 'Failed to load collaborators';
      console.error('[useNoteSharing] fetchCollaborators failed:', err);
    } finally {
      // Only reset loading if this request wasn't cancelled
      if (!signal.aborted) {
        loading.value = false;
      }
    }
  }

  async function ensureKey(noteId) {
    if (!accountStore.isAuthenticated) return null;
    try {
      const raw = await apiCreateKey(noteId, { baseUrl: activeBaseUrl() });
      if (raw?.key) {
        key.value = raw.key;
      }
      return key.value;
    } catch (err) {
      console.error('[useNoteSharing] ensureKey failed:', err);
      return null;
    }
  }

  async function getKey(noteId) {
    if (!accountStore.isAuthenticated) return null;
    try {
      const raw = await apiGetKey(noteId, { baseUrl: activeBaseUrl() });
      if (raw?.key) {
        key.value = raw.key;
      }
      return key.value;
    } catch (err) {
      console.error('[useNoteSharing] getKey failed:', err);
      return null;
    }
  }

  async function ensureNoteKey(noteId) {
    if (!accountStore.isAuthenticated) return null;

    // Register the caller as the note's owner collaborator (idempotent: only
    // bootstraps when the note has zero collaborators) and ensure the key
    // envelope context exists. Non-fatal so note creation/opening never breaks.
    await ensureKey(noteId).catch(() => {});

    const identity = await loadOrCreateIdentity();

    // First touch of a note: the caller may not be a collaborator yet.
    // Listing invitations auto-grants the self-invitation, after which the
    // key endpoint (gated to collaborators) accepts the request.
    const getKey = async () => {
      try {
        return await apiGetKey(noteId, { baseUrl: activeBaseUrl() });
      } catch (err) {
        if (err?.status !== 403) throw err;
        await apiList(noteId, { baseUrl: activeBaseUrl() });
        return apiGetKey(noteId, { baseUrl: activeBaseUrl() });
      }
    };

    const deviceId = await ensureDeviceId();

    const raw = await getKey();
    const noteKeyHex = await recoverNoteKeyFromEnvelopes(raw?.wrappedKeys, identity, noteId);
    if (noteKeyHex) {
      key.value = noteKeyHex;
      return noteKeyHex;
    }

    // Fresh note — provision a new key fanning out to every device of every
    // collaborator. If the note already has a key but this device has no
    // envelope yet (late joiner), provisionNoteKey refuses to rotate and we
    // request an online device of this account to re-distribute to us.
    const fresh = await provisionNoteKey({
      getKey,
      listPublicKeys: () => fetchCollaboratorPublicKeys(noteId),
      storeRecipients: (recipients) =>
        apiStoreRecipients(noteId, recipients, { baseUrl: activeBaseUrl() }),
      identity,
      noteId,
    });
    if (fresh) {
      key.value = fresh;
      return fresh;
    }

    // Late joiner with no envelope: ask another device to re-wrap the existing
    // key for this device. Caller shows "setting up on this device…".
    await requestKeyDistribution(noteId, deviceId).catch(() => {});
    return null;
  }

  async function invite(noteId, identifier, role = 'editor') {
    if (!accountStore.isAuthenticated) throw new Error('Not authenticated');
    try {
      const result = await apiInvite(noteId, identifier, role, { baseUrl: activeBaseUrl() });
      await fetchCollaborators(noteId);
      return result;
    } catch (err) {
      error.value = err?.message || 'Failed to invite collaborator';
      throw err;
    }
  }

  async function remove(noteId, userId) {
    if (!accountStore.isAuthenticated) throw new Error('Not authenticated');
    const previous = collaborators.value.slice();
    collaborators.value = collaborators.value.filter((c) => c.userId !== userId);
    try {
      await apiRemove(noteId, userId, { baseUrl: activeBaseUrl() });
      clearUnwrappedKeyCache(noteId);
    } catch (err) {
      collaborators.value = previous;
      error.value = err?.message || 'Failed to remove collaborator';
      throw err;
    }
  }

  async function fetchLinks(noteId) {
    // No account → no links to fetch; never hit the network signed out.
    if (!accountStore.isAuthenticated) {
      inviteLinks.value = [];
      return;
    }
    linkLoading.value = true;
    try {
      inviteLinks.value = await apiListLinks(noteId, { baseUrl: activeBaseUrl() });
    } finally {
      linkLoading.value = false;
    }
  }

  async function generateLink(noteId, options = {}) {
    if (!accountStore.isAuthenticated) throw new Error('Not authenticated');
    const result = await apiGenerateLink(noteId, {
      role: options.role || 'editor',
      requireApproval: options.requireApproval || false,
      expiresIn: options.expiresIn || null,
      baseUrl: activeBaseUrl(),
    });
    inviteLinks.value.unshift(result);
    return result;
  }

  async function revokeLink(noteId, linkId) {
    if (!accountStore.isAuthenticated) throw new Error('Not authenticated');
    await apiRevokeLink(noteId, linkId, { baseUrl: activeBaseUrl() });
    inviteLinks.value = inviteLinks.value.filter((l) => l.id !== linkId);
  }

  return {
    collaborators,
    loading,
    error,
    key,
    inviteLinks,
    linkLoading,
    fetchCollaborators,
    ensureKey,
    getKey,
    ensureNoteKey,
    invite,
    remove,
    fetchLinks,
    generateLink,
    revokeLink,
  };
}
