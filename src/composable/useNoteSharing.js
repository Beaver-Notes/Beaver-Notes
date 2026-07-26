import { ref } from 'vue';
import { useAccountStore } from '@/store/account';
import {
  createCollaborationKey as apiCreateKey,
  getCollaborationKey as apiGetKey,
  inviteCollaborator as apiInvite,
  listCollaborators as apiList,
  removeCollaborator as apiRemove,
} from '@/lib/api/collaboration';

export function useNoteSharing() {
  const accountStore = useAccountStore();
  const collaborators = ref([]);
  const loading = ref(false);
  const error = ref('');
  const key = ref(null);

  async function fetchCollaborators(noteId) {
    if (!accountStore.isAuthenticated) return;
    loading.value = true;
    error.value = '';
    try {
      const raw = await apiList(noteId);
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
      error.value = err?.message || 'Failed to load collaborators';
      console.error('[useNoteSharing] fetchCollaborators failed:', err);
    } finally {
      loading.value = false;
    }
  }

  async function ensureKey(noteId) {
    if (!accountStore.isAuthenticated) return null;
    try {
      const raw = await apiCreateKey(noteId);
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
      const raw = await apiGetKey(noteId);
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
      const result = await apiInvite(noteId, identifier, role);
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
      await apiRemove(noteId, userId);
    } catch (err) {
      collaborators.value = previous;
      error.value = err?.message || 'Failed to remove collaborator';
      throw err;
    }
  }

  return {
    collaborators,
    loading,
    error,
    key,
    fetchCollaborators,
    ensureKey,
    getKey,
    invite,
    remove,
  };
}
