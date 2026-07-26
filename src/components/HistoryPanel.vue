<template>
  <div class="fixed top-0 right-0 w-80 h-full bg-white dark:bg-neutral-800 border-l border-neutral-200 dark:border-neutral-700 z-50 flex flex-col">
    <div class="flex items-center justify-between p-4 border-b border-neutral-200 dark:border-neutral-700">
      <h3 class="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
        History
      </h3>
      <button
        @click="$emit('close')"
        class="text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300"
      >
        ✕
      </button>
    </div>

    <div v-if="history.loading.value" class="p-4 text-center text-neutral-500">
      Loading...
    </div>

    <div v-else-if="history.error.value" class="p-4 text-center text-red-500">
      {{ history.error.value }}
    </div>

    <div v-else-if="history.selectedCommit.value" class="flex-1 overflow-auto">
      <button
        @click="history.selectedCommit.value = null"
        class="m-3 text-xs text-blue-600 dark:text-blue-400 hover:underline"
      >
        ← Back to history
      </button>
      <div class="px-4">
        <h4 class="text-sm font-medium text-neutral-900 dark:text-neutral-100 mb-2">
          {{ history.selectedCommit.value.title || 'Untitled' }}
        </h4>
        <div
          class="prose prose-sm dark:prose-invert max-h-[60vh] overflow-auto"
          v-html="renderedContent"
        />
      </div>
    </div>

    <div v-else class="flex-1 overflow-auto">
      <div
        v-for="commit in history.commits.value"
        :key="commit.hash"
        @click="history.loadSnapshot(commit.hash)"
        class="flex items-start gap-3 p-4 border-b border-neutral-200 dark:border-neutral-700 cursor-pointer hover:bg-neutral-50 dark:hover:bg-neutral-750 transition-colors duration-150"
      >
        <div class="w-2 h-2 rounded-full bg-blue-500 mt-1.5 flex-shrink-0" />
        <div class="flex-1 min-w-0">
          <p class="text-sm text-neutral-900 dark:text-neutral-100 truncate">
            {{ commit.message || 'No message' }}
          </p>
          <p class="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">
            {{ formatDate(commit.createdAt) }}
          </p>
        </div>
      </div>
      <div v-if="history.commits.value.length === 0" class="p-4 text-center text-neutral-500">
        No history available
      </div>
    </div>
  </div>
</template>

<script>
import { computed } from 'vue';
import { useNoteHistory } from '@/composable/useNoteHistory';

export default {
  emits: ['close', 'restore'],
  setup(props, { emit }) {
    const history = useNoteHistory();

    const renderedContent = computed(() => {
      if (!history.selectedCommit.value?.content) return '';
      return history.selectedCommit.value.content
        .split('\n')
        .map((line) => `<p>${escapeHtml(line) || '<br>'}</p>`)
        .join('');
    });

    function formatDate(dateStr) {
      if (!dateStr) return '';
      const d = new Date(dateStr);
      return d.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    }

    function escapeHtml(str) {
      return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    }

    return { history, renderedContent, formatDate };
  },
};
</script>