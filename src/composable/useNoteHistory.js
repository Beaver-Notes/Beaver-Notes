import { ref } from 'vue';
import { listCommits, getCommitSnapshot } from '@/lib/api/history';

export function useNoteHistory() {
  const commits = ref([]);
  const loading = ref(false);
  const error = ref(null);
  const selectedCommit = ref(null);

  async function loadCommits(workspaceId, noteId) {
    loading.value = true;
    error.value = null;
    try {
      commits.value = await listCommits(workspaceId, noteId);
    } catch (err) {
      error.value = err.message || 'Failed to load history';
    } finally {
      loading.value = false;
    }
  }

  async function loadSnapshot(commitHash) {
    loading.value = true;
    error.value = null;
    try {
      selectedCommit.value = await getCommitSnapshot(commitHash);
    } catch (err) {
      error.value = err.message || 'Failed to load snapshot';
    } finally {
      loading.value = false;
    }
  }

  return {
    commits,
    loading,
    error,
    selectedCommit,
    loadCommits,
    loadSnapshot,
  };
}