import { ref } from 'vue';
import { useAccountStore } from '@/store/account';
import {
  createCollaborationKey as apiCreateKey,
  getCollaborationKey as apiGetKey,
  inviteCollaborator as apiInvite,
  listCollaborators as apiList,
  removeCollaborator as apiRemove,
  generateInviteLink as apiGenerateLink,
  listInviteLinks as apiListLinks,
  revokeInviteLink as apiRevokeLink,
} from '@/lib/api/collaboration';

export function useNoteSharing() {
  const accountStore = useAccountStore();
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
    invite,
    remove,
    fetchLinks,
    generateLink,
    revokeLink,
  };
}
