import { defineStore } from 'pinia';
import { ref, computed } from 'vue';

export const useCollaboratorStore = defineStore('collaborator', () => {
  const collaborators = ref([]);
  const noteId = ref('');

  const usernames = computed(() => {
    const seen = new Set();
    const result = [];
    for (const c of collaborators.value) {
      const username = c.username || (c.email ? c.email.split('@')[0] : null);
      if (username && !seen.has(username)) {
        seen.add(username);
        result.push({
          id: c.userId,
          label: username,
          username,
          email: c.email,
        });
      }
    }
    return result;
  });

  function setCollaborators(noteIdValue, list) {
    noteId.value = noteIdValue;
    collaborators.value = Array.isArray(list) ? list : [];
  }

  function reset() {
    collaborators.value = [];
    noteId.value = '';
  }

  return {
    collaborators,
    noteId,
    usernames,
    setCollaborators,
    reset,
  };
});
