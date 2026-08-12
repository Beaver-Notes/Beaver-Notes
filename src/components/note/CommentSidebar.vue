<template>
  <transition name="slide-right">
    <div
      class="fixed top-0 right-0 w-80 h-full bg-white dark:bg-neutral-800 border-l border-neutral-200 dark:border-neutral-700 z-50 flex flex-col"
    >
      <div
        class="flex items-center justify-between p-4 border-b border-neutral-200 dark:border-neutral-700"
      >
        <h3 class="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
          {{ translationsComments.title || 'Comments' }}
        </h3>
        <button
          class="text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300"
          @click="$emit('close')"
        >
          &#x2715;
        </button>
      </div>

      <div class="flex-1 overflow-auto">
        <div v-if="loading" class="p-4 text-center text-neutral-500 text-sm">
          Loading...
        </div>

        <template v-else>
          <div
            v-if="pendingThreadId"
            class="p-4 border-b border-neutral-200 dark:border-neutral-700 bg-blue-50 dark:bg-blue-900/20"
          >
            <p class="text-xs font-medium text-neutral-500 mb-2">
              {{ translationsComments.newComment || 'New comment' }}
            </p>
            <div class="flex gap-2">
              <input
                v-model="pendingComment"
                :placeholder="translationsComments.placeholder || 'Add a comment...'"
                class="flex-1 text-sm px-3 py-1.5 rounded-lg border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-700 text-neutral-900 dark:text-neutral-100 outline-none focus:ring-1 focus:ring-blue-500"
                @keydown.enter="submitPendingComment"
              />
              <button
                class="text-xs px-2 py-1.5 rounded-lg bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-50"
                :disabled="!pendingComment.trim()"
                @click="submitPendingComment"
              >
                &#x2713;
              </button>
            </div>
          </div>

          <div v-if="unresolvedThreads.length" class="pb-2">
            <div
              v-for="thread in unresolvedThreads"
              :key="thread.id"
              class="p-4 border-b border-neutral-200 dark:border-neutral-700"
              :class="{ 'bg-blue-50 dark:bg-blue-900/20': thread.id === activeThreadId }"
            >
              <div
                v-for="(comment, ci) in thread.comments"
                :key="comment.id"
                class="mb-2 last:mb-0"
              >
                <div class="flex items-center gap-2 mb-1">
                  <div
                    class="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white flex-shrink-0"
                    :style="{ backgroundColor: getAuthorColor(comment.authorId) }"
                  >
                    {{ getInitials(comment.authorName) }}
                  </div>
                  <span class="text-sm font-medium text-neutral-900 dark:text-neutral-100">
                    {{ comment.authorName || 'Unknown' }}
                  </span>
                  <span class="text-xs text-neutral-500 ml-auto">
                    {{ formatDate(comment.createdAt) }}
                  </span>
                </div>
                <p class="text-sm text-neutral-700 dark:text-neutral-300 ml-8">
                  {{ comment.content }}
                </p>
              </div>

              <div class="flex items-center gap-2 mt-3 ml-8">
                <button
                  class="text-xs text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300"
                  @click="toggleResolve(thread.id)"
                >
                  {{ translationsComments.resolve || 'Resolve' }}
                </button>
              </div>

              <div class="mt-3 ml-8">
                <div class="flex gap-2">
                  <input
                    v-model="replyInputs[thread.id]"
                    :placeholder="translationsComments.replyPlaceholder || 'Reply...'"
                    class="flex-1 text-sm px-3 py-1.5 rounded-lg border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-700 text-neutral-900 dark:text-neutral-100 outline-none focus:ring-1 focus:ring-blue-500"
                    @keydown.enter="submitReply(thread.id)"
                  />
                  <button
                    class="text-xs px-2 py-1.5 rounded-lg bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-50"
                    :disabled="!replyInputs[thread.id]?.trim()"
                    @click="submitReply(thread.id)"
                  >
                    &#x2191;
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div v-if="resolvedThreads.length" class="pb-2">
            <button
              class="w-full px-4 py-2 text-left text-xs font-medium text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300 border-b border-neutral-200 dark:border-neutral-700"
              @click="showResolved = !showResolved"
            >
              {{ showResolved ? '&#9660;' : '&#9654;' }}
              {{ resolvedThreads.length }} resolved
            </button>
            <template v-if="showResolved">
              <div
                v-for="thread in resolvedThreads"
                :key="thread.id"
                class="p-4 border-b border-neutral-200 dark:border-neutral-700 opacity-60"
              >
                <div
                  v-for="(comment, ci) in thread.comments"
                  :key="comment.id"
                  class="mb-2 last:mb-0"
                >
                  <div class="flex items-center gap-2 mb-1">
                    <div
                      class="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white flex-shrink-0"
                      :style="{ backgroundColor: getAuthorColor(comment.authorId) }"
                    >
                      {{ getInitials(comment.authorName) }}
                    </div>
                    <span class="text-sm font-medium text-neutral-900 dark:text-neutral-100">
                      {{ comment.authorName || 'Unknown' }}
                    </span>
                    <span class="text-xs text-neutral-500 ml-auto">
                      {{ formatDate(comment.createdAt) }}
                    </span>
                  </div>
                  <p class="text-sm text-neutral-700 dark:text-neutral-300 ml-8">
                    {{ comment.content }}
                  </p>
                </div>
                <button
                  class="text-xs text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300 mt-2 ml-8"
                  @click="toggleResolve(thread.id)"
                >
                  {{ translationsComments.reopen || 'Reopen' }}
                </button>
              </div>
            </template>
          </div>

          <div
            v-if="!unresolvedThreads.length && !resolvedThreads.length"
            class="p-4 text-center text-neutral-500"
          >
            {{ translationsComments.empty || 'No comments yet' }}
          </div>
        </template>
      </div>

      <div class="p-4 border-t border-neutral-200 dark:border-neutral-700">
        <div class="flex gap-2">
          <input
            v-model="newComment"
            :placeholder="translationsComments.placeholder || 'Add a comment...'"
            class="flex-1 text-sm px-3 py-2 rounded-lg border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-700 text-neutral-900 dark:text-neutral-100 outline-none focus:ring-1 focus:ring-blue-500"
            @keydown.enter="submitComment"
          />
          <button
            class="text-sm px-3 py-2 rounded-lg bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-50"
            :disabled="!newComment.trim()"
            @click="submitComment"
          >
            {{ translationsComments.send || 'Send' }}
          </button>
        </div>
      </div>
    </div>
  </transition>
</template>

<script>
import { ref, reactive, computed, watch } from 'vue';
import { useCommentStore } from '@/store/comment';
import { useTranslations } from '@/composable/useTranslations';
import { useAccountStore } from '@/store/account';

const PEER_COLORS = [
  '#3B82F6', '#EF4444', '#10B981', '#F59E0B', '#8B5CF6',
  '#EC4899', '#06B6D4', '#F97316', '#6366F1', '#14B8A6',
];

export default {
  props: {
    noteId: { type: String, required: true },
  },
  emits: ['close'],
  setup(props) {
    const commentStore = useCommentStore();
    const accountStore = useAccountStore();
    const { translations } = useTranslations();

    const newComment = ref('');
    const pendingComment = ref('');
    const replyInputs = reactive({});
    const showResolved = ref(false);

    const translationsComments = computed(() => ({
      title: translations.value['comments.title'] || 'Comments',
      placeholder: translations.value['comments.placeholder'] || 'Add a comment...',
      replyPlaceholder: translations.value['comments.replyPlaceholder'] || 'Reply...',
      send: translations.value['comments.send'] || 'Send',
      resolve: translations.value['comments.resolve'] || 'Resolve',
      reopen: translations.value['comments.reopen'] || 'Reopen',
      empty: translations.value['comments.empty'] || 'No comments yet',
      newComment: translations.value['comments.newComment'] || 'New comment',
    }));

    const loading = computed(() => commentStore.loading);
    const activeThreadId = computed(() => commentStore.activeThreadId);
    const pendingThreadId = computed(() => commentStore.pendingThreadId);
    const unresolvedThreads = computed(() => commentStore.unresolvedThreads);
    const resolvedThreads = computed(() => commentStore.resolvedThreads);

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
        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
      });
    }

    async function submitComment() {
      const content = newComment.value.trim();
      if (!content) return;
      try {
        await commentStore.addComment(props.noteId, {
          content,
          baseUrl: accountStore.serverUrl,
        });
        newComment.value = '';
      } catch (err) {
        console.error('[comment] Failed to add comment:', err);
      }
    }

    async function submitPendingComment() {
      const content = pendingComment.value.trim();
      if (!content) return;
      try {
        await commentStore.addComment(props.noteId, {
          content,
          threadId: pendingThreadId.value,
          anchorFrom: commentStore.pendingAnchorFrom,
          anchorTo: commentStore.pendingAnchorTo,
          baseUrl: accountStore.serverUrl,
        });
        pendingComment.value = '';
      } catch (err) {
        console.error('[comment] Failed to add pending comment:', err);
      }
    }

    async function submitReply(threadId) {
      const content = replyInputs[threadId]?.trim();
      if (!content) return;
      try {
        await commentStore.addComment(props.noteId, {
          content,
          threadId,
          parentId: threadId,
          baseUrl: accountStore.serverUrl,
        });
        replyInputs[threadId] = '';
      } catch (err) {
        console.error('[comment] Failed to reply:', err);
      }
    }

    async function toggleResolve(threadId) {
      try {
        await commentStore.toggleResolve(threadId, {
          baseUrl: accountStore.serverUrl,
        });
      } catch (err) {
        console.error('[comment] Failed to toggle resolve:', err);
      }
    }

    watch(
      () => props.noteId,
      (id) => {
        if (id) commentStore.fetchThreads(id, { baseUrl: accountStore.serverUrl });
      },
      { immediate: true }
    );

    return {
      translationsComments,
      loading,
      activeThreadId,
      pendingThreadId,
      unresolvedThreads,
      resolvedThreads,
      newComment,
      pendingComment,
      replyInputs,
      showResolved,
      getAuthorColor,
      getInitials,
      formatDate,
      submitComment,
      submitPendingComment,
      submitReply,
      toggleResolve,
    };
  },
};
</script>

<style>
.slide-right-enter-active,
.slide-right-leave-active {
  transition: transform var(--motion-base) var(--ease-standard);
}
.slide-right-enter-from,
.slide-right-leave-to {
  transform: translateX(100%);
}
@media (prefers-reduced-motion: reduce) {
  .slide-right-enter-active,
  .slide-right-leave-active {
    transition-duration: 0.01ms;
  }
}
</style>
