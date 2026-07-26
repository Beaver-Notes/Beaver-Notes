<template>
  <div
    class="fixed top-0 right-0 w-80 h-full bg-white dark:bg-neutral-800 border-l border-neutral-200 dark:border-neutral-700 z-50 flex flex-col"
  >
    <div
      class="flex items-center justify-between p-4 border-b border-neutral-200 dark:border-neutral-700"
    >
      <h3 class="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
        Comments
      </h3>
      <button
        class="text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300"
        @click="$emit('close')"
      >
        &#x2715;
      </button>
    </div>
    <div class="flex-1 overflow-auto">
      <div
        v-for="thread in threads"
        :key="thread.id"
        class="p-4 border-b border-neutral-200 dark:border-neutral-700"
      >
        <div class="flex items-center gap-2 mb-1">
          <div
            class="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white"
            :style="{ backgroundColor: getAuthorColor(thread.authorId) }"
          >
            {{ getInitials(thread.authorName) }}
          </div>
          <span class="text-sm font-medium text-neutral-900 dark:text-neutral-100">
            {{ thread.authorName }}
          </span>
          <span class="text-xs text-neutral-500 ml-auto">
            {{ formatDate(thread.createdAt) }}
          </span>
        </div>
        <p class="text-sm text-neutral-700 dark:text-neutral-300 ml-8">
          {{ thread.content }}
        </p>
      </div>
      <div
        v-if="threads.length === 0"
        class="p-4 text-center text-neutral-500"
      >
        No comments yet
      </div>
    </div>
  </div>
</template>

<script>
const PEER_COLORS = [
  '#3B82F6',
  '#EF4444',
  '#10B981',
  '#F59E0B',
  '#8B5CF6',
  '#EC4899',
  '#06B6D4',
  '#F97316',
  '#6366F1',
  '#14B8A6',
];

export default {
  props: {
    threads: { type: Array, default: () => [] },
  },
  emits: ['close'],
  setup() {
    function getAuthorColor(authorId) {
      if (!authorId) return PEER_COLORS[0];
      let hash = 0;
      for (let i = 0; i < authorId.length; i++) {
        hash = authorId.charCodeAt(i) + ((hash << 5) - hash);
      }
      return PEER_COLORS[Math.abs(hash) % PEER_COLORS.length];
    }

    function getInitials(name) {
      if (!name) return '?';
      return name.slice(0, 2).toUpperCase();
    }

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

    return { getAuthorColor, getInitials, formatDate };
  },
};
</script>
