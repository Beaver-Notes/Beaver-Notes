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
} from '@/lib/api/collaboration';
import { loadOrCreateIdentity } from '@/utils/crypto/identity';
import {
  wrapNoteKeyForRecipient,
  unwrapNoteKey,
} from '@/utils/crypto/note-key';
import { isValidCollabKey } from '@/utils/crypto/collab';

function bytesToHex(buf) {
  return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
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

  async function fetchCollaboratorPublicKeys(noteId) {
    try {
      return await apiListPublicKeys(noteId, { baseUrl: activeBaseUrl() });
    } catch (err) {
      // First touch of a note: the caller may not be a collaborator yet.
      // Listing invitations auto-grants the self-invitation, after which the
      // public-keys endpoint (gated to collaborators) accepts the request.
      if (err?.status !== 403) throw err;
      await apiList(noteId, { baseUrl: activeBaseUrl() });
      return apiListPublicKeys(noteId, { baseUrl: activeBaseUrl() });
    }
  }

  async function ensureNoteKey(noteId) {
    if (!accountStore.isAuthenticated) return null;

    const identity = await loadOrCreateIdentity();

    // First touch of a note: the caller may not be a collaborator yet.
    // Listing invitations auto-grants the self-invitation, after which the
    // key endpoint (gated to collaborators) accepts the request.
    let raw;
    try {
      raw = await apiGetKey(noteId, { baseUrl: activeBaseUrl() });
    } catch (err) {
      if (err?.status === 403) {
        try {
          await apiList(noteId, { baseUrl: activeBaseUrl() });
          raw = await apiGetKey(noteId, { baseUrl: activeBaseUrl() });
        } catch (err2) {
          console.warn('[useNoteSharing] getKey failed:', err2);
          return null;
        }
      } else {
        console.warn('[useNoteSharing] getKey failed:', err);
        return null;
      }
    }

    // Contract drift: if the endpoint ever returns the legacy `key` shape
    // instead of `wrappedKey` + `noteHasKey`, the note may already have a key.
    // Never rotate it — surface a graceful null so the note stays unencrypted
    // for this client until an owner re-wraps them.
    if (raw?.key !== undefined && raw?.wrappedKey === undefined) {
      console.warn('[useNoteSharing] legacy key shape; refusing to rotate an existing note key');
      return null;
    }

    // 1. The note already has a key. Recover this user's envelope, if any.
    if (raw?.noteHasKey === true) {
      if (raw?.wrappedKey) {
        try {
          const noteKeyHex = await unwrapNoteKey(identity.privateKeyHex, raw.wrappedKey);
          if (noteKeyHex && isValidCollabKey(noteKeyHex)) {
            key.value = noteKeyHex;
            return noteKeyHex;
          }
        } catch (err) {
          console.warn('[useNoteSharing] failed to unwrap note key envelope:', err);
        }
      }
      // Late joiner (or unwrap failure): no usable envelope for this caller.
      // Do NOT provision/rotate — an owner must re-wrap the existing key for us.
      return null;
    }

    // 2. Fresh note — provision a new note key for every keypair'd
    //    collaborator (the owner is part of the collaborator set).
    try {
      const publicKeys = await fetchCollaboratorPublicKeys(noteId);
      const keypairCollabs = Array.isArray(publicKeys?.collaborators)
        ? publicKeys.collaborators.filter((c) => c?.kemPublicKey)
        : [];
      if (keypairCollabs.length === 0) return null;

      const noteKeyHex = bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
      const recipients = [];
      for (const c of keypairCollabs) {
        const wrappedKey = await wrapNoteKeyForRecipient(c.kemPublicKey, noteKeyHex);
        recipients.push({ userId: c.userId, wrappedKey });
      }
      const stored = await apiStoreRecipients(noteId, recipients, { baseUrl: activeBaseUrl() });

      // Concurrent provisioning: another client won the race and the server
      // refused our envelopes. Recover the winner's key instead of diverging.
      if (stored?.existing) {
        try {
          const winner = await apiGetKey(noteId, { baseUrl: activeBaseUrl() });
          if (winner?.wrappedKey) {
            const winnerKey = await unwrapNoteKey(identity.privateKeyHex, winner.wrappedKey);
            if (winnerKey && isValidCollabKey(winnerKey)) {
              key.value = winnerKey;
              return winnerKey;
            }
          }
        } catch (err) {
          console.warn('[useNoteSharing] failed to recover concurrently-provisioned note key:', err);
        }
        return null;
      }

      key.value = noteKeyHex;
      return noteKeyHex;
    } catch (err) {
      console.warn('[useNoteSharing] note-key provisioning failed:', err);
      return null;
    }
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
    } catch (err) {
      collaborators.value = previous;
      error.value = err?.message || 'Failed to remove collaborator';
      throw err;
    }
  }

  async function fetchLinks(noteId) {
    linkLoading.value = true;
    try {
      inviteLinks.value = await apiListLinks(noteId, { baseUrl: activeBaseUrl() });
    } finally {
      linkLoading.value = false;
    }
  }

  async function generateLink(noteId, options = {}) {
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
