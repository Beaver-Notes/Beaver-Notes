import { ref, computed } from 'vue';
import { listCommits, getCommitSnapshot } from '@/lib/api/history';

export function useNoteHistory() {
  const commits = ref([]);
  const loading = ref(false);
  const error = ref(null);
  const selectedCommit = ref(null);
  const selectedCommitIndex = ref(-1);
  const timeFilter = ref('all');

  const filteredCommits = computed(() => {
    if (timeFilter.value === 'all') return commits.value;
    const now = new Date();
    const cutoff = new Date();
    if (timeFilter.value === 'today') {
      cutoff.setHours(0, 0, 0, 0);
    } else if (timeFilter.value === 'week') {
      cutoff.setDate(now.getDate() - 7);
    }
    return commits.value.filter(
      (c) => new Date(c.createdAt).getTime() >= cutoff.getTime()
    );
  });

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

  function selectCommit(index) {
    selectedCommitIndex.value = index;
  }

  function setFilter(value) {
    timeFilter.value = value;
  }

  function clearSelection() {
    selectedCommit.value = null;
    selectedCommitIndex.value = -1;
  }

  return {
    commits,
    loading,
    error,
    selectedCommit,
    selectedCommitIndex,
    timeFilter,
    filteredCommits,
    loadCommits,
    loadSnapshot,
    selectCommit,
    setFilter,
    clearSelection,
  };
}
