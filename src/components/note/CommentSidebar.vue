<template>
  <transition :name="docked ? 'slide-right-docked' : 'slide-right'">
    <div
      :class="docked
        ? 'relative shrink-0 flex w-[380px] max-w-[42%] self-start sticky top-4 h-[calc(100vh-2rem)] flex-col bg-white dark:bg-neutral-950 border border-neutral-200 dark:border-neutral-800 rounded-xl shadow-sm overflow-hidden max-lg:hidden'
        : 'fixed inset-y-0 ltr:right-0 rtl:left-0 z-50 flex w-[380px] max-w-[92vw] flex-col bg-white dark:bg-neutral-950 ltr:border-l rtl:border-r border-neutral-200 dark:border-neutral-800 shadow-2xl'"
    >
      <div
        class="shrink-0 flex items-center justify-between gap-3 px-4 h-[52px] bg-white dark:bg-neutral-900 border-b border-neutral-200 dark:border-neutral-800"
      >
        <div class="flex items-center gap-2.5 min-w-0">
          <div class="w-7 h-7 rounded-lg bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 flex items-center justify-center shrink-0">
            <v-remixicon name="riChat3Line" size="15" />
          </div>
          <h3 class="text-[13px] font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">
            {{ translationsComments.title || 'Comments' }}
          </h3>
          <span
            v-if="totalThreads"
            class="shrink-0 inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-neutral-100 dark:bg-neutral-800 text-[11px] font-medium text-neutral-600 dark:text-neutral-400 tabular-nums"
          >
            {{ totalThreads }}
          </span>
        </div>
        <button
          class="shrink-0 w-7 h-7 grid place-items-center rounded-lg text-neutral-400 hover:text-neutral-900 hover:bg-neutral-100 dark:hover:text-neutral-100 dark:hover:bg-neutral-800 transition-colors"
          aria-label="Close comments"
          @click="$emit('close')"
        >
          <v-remixicon name="riCloseLine" size="18" />
        </button>
      </div>

      <div class="flex-1 overflow-y-auto overscroll-contain">
        <div v-if="loading" class="py-16 flex flex-col items-center gap-3 text-neutral-400">
          <div class="w-5 h-5 border-2 border-neutral-300 border-t-neutral-900 dark:border-neutral-600 dark:border-t-white rounded-full animate-spin" />
          <span class="text-xs">Loading threads…</span>
        </div>

        <template v-else>
          <div v-if="pendingThreadId" class="p-3">
            <div class="rounded-xl border border-dashed border-primary/30 bg-primary/[0.04] dark:bg-primary/10 p-3">
              <p class="text-[11px] font-medium tracking-wide uppercase text-neutral-500 dark:text-neutral-400 mb-2">
                {{ translationsComments.newComment || 'New thread' }}
              </p>
              <div class="flex gap-2 items-end">
                <textarea
                  v-model="pendingComment"
                  :placeholder="translationsComments.placeholder || 'Add a comment...'"
                  rows="1"
                  class="flex-1 resize-none min-h-[36px] max-h-[96px] text-[13.5px] leading-5 px-3 py-2 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100 placeholder:text-neutral-400 outline-none focus:border-neutral-300 dark:focus:border-neutral-600 focus:ring-2 focus:ring-primary/10 transition"
                  @keydown.enter.exact.prevent="submitPendingComment"
                  @keydown.enter.shift.exact.stop
                />
                <button
                  class="shrink-0 w-8 h-8 grid place-items-center rounded-lg bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 hover:opacity-90 disabled:opacity-40 disabled:pointer-events-none transition"
                  :disabled="!pendingComment.trim()"
                  aria-label="Send"
                  @click="submitPendingComment"
                >
                  <v-remixicon name="riSendPlaneFill" size="14" />
                </button>
              </div>
              <p class="text-[11px] text-neutral-400 mt-1.5">↩︎ send · ⇧↩︎ new line</p>
            </div>
          </div>

          <div v-if="unresolvedThreads.length" class="p-3 space-y-3">
            <div
              v-for="thread in unresolvedThreads"
              :key="thread.id"
              class="group rounded-xl border bg-white dark:bg-neutral-900 overflow-hidden transition-shadow"
              :class="thread.id === activeThreadId
                ? 'border-primary/20 ring-1 ring-primary/15 shadow-sm'
                : 'border-neutral-200 dark:border-neutral-800 hover:border-neutral-300 dark:hover:border-neutral-700 hover:shadow-sm'"
            >
              <div class="divide-y divide-neutral-100 dark:divide-neutral-800">
                <div
                  v-for="(comment, ci) in thread.comments"
                  :key="comment.id"
                  class="px-3.5 py-3"
                  :class="{ 'bg-neutral-50/60 dark:bg-neutral-800/40': ci > 0 }"
                >
                  <div class="flex gap-2.5">
                    <div
                      class="shrink-0 w-6 h-6 rounded-full grid place-items-center text-[10px] font-semibold text-white leading-none select-none"
                      :style="{ backgroundColor: getAuthorColor(comment.authorId) }"
                    >
                      {{ getInitials(comment.authorName) }}
                    </div>
                    <div class="flex-1 min-w-0">
                      <div class="flex items-baseline gap-1.5 flex-wrap">
                        <span class="text-[13px] font-medium text-neutral-900 dark:text-neutral-100 truncate">
                          {{ comment.authorName || 'Unknown' }}
                        </span>
                        <span class="text-[11px] text-neutral-400">·</span>
                        <span class="text-[11px] text-neutral-500 dark:text-neutral-400 tabular-nums">
                          {{ formatRelative(comment.createdAt) }}
                        </span>
                        <button
                          v-if="ci === 0"
                          class="ltr:ml-auto rtl:mr-auto ltr:-mr-1 rtl:-ml-1 opacity-0 group-hover:opacity-100 focus:opacity-100 w-6 h-6 grid place-items-center rounded-md text-neutral-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 transition"
                          :aria-label="translationsComments.delete || 'Delete'"
                          @click="deleteComment(comment.id)"
                        >
                          <v-remixicon name="riDeleteBinLine" size="13" />
                        </button>
                      </div>
                      <p class="mt-1 text-[13.5px] leading-[1.55] text-neutral-700 dark:text-neutral-300 whitespace-pre-wrap break-words">
                        {{ comment.content }}
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              <div class="flex items-center gap-1 px-3 py-2 bg-neutral-50/80 dark:bg-neutral-900 border-t border-neutral-100 dark:border-neutral-800">
                <button
                  class="inline-flex items-center gap-1.5 text-[12px] font-medium px-2.5 py-1 rounded-full bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-700 transition"
                  @click="toggleResolve(thread.id)"
                >
                  <v-remixicon name="riCheckLine" size="13" class="text-emerald-600" />
                  {{ translationsComments.resolve || 'Resolve' }}
                </button>
                <span class="ltr:ml-auto rtl:mr-auto text-[11px] text-neutral-400 hidden group-hover:inline">{{ thread.comments.length }} {{ thread.comments.length === 1 ? 'comment' : 'comments' }}</span>
              </div>

              <div class="px-3 py-2.5 bg-white dark:bg-neutral-900 border-t border-neutral-100 dark:border-neutral-800">
                <div class="flex gap-2 items-end">
                  <div
                    class="shrink-0 w-6 h-6 rounded-full grid place-items-center text-[10px] font-semibold text-white"
                    :style="{ backgroundColor: getAuthorColor(accountStore.profile?.id || 'me') }"
                  >
                    {{ getInitials(accountStore.profile?.username || 'Me') }}
                  </div>
                  <div class="flex-1 relative">
                    <input
                      v-model="replyInputs[thread.id]"
                      :placeholder="translationsComments.replyPlaceholder || 'Reply...'"
                      class="w-full text-[13px] leading-5 pr-8 pl-3 py-[7px] rounded-full border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 placeholder:text-neutral-400 outline-none focus:bg-white dark:focus:bg-neutral-900 focus:border-neutral-300 dark:focus:border-neutral-600 focus:ring-2 focus:ring-primary/10 transition"
                      @keydown.enter="submitReply(thread.id)"
                    />
                    <button
                      class="absolute ltr:right-1 rtl:left-1 top-1/2 -translate-y-1/2 w-6 h-6 grid place-items-center rounded-full bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 hover:opacity-90 disabled:opacity-30 disabled:pointer-events-none transition"
                      :disabled="!replyInputs[thread.id]?.trim()"
                      aria-label="Reply"
                      @click="submitReply(thread.id)"
                    >
                      <v-remixicon name="riArrowUpLine" size="13" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div v-if="resolvedThreads.length" class="px-3 pb-3">
            <button
              class="w-full flex items-center gap-1.5 py-2 text-[12px] font-medium text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300 transition"
              @click="showResolved = !showResolved"
            >
              <v-remixicon :name="showResolved ? 'riArrowDownSLine' : 'riArrowRightSLine'" size="14" />
              {{ resolvedThreads.length }} resolved
              <span class="h-px flex-1 bg-neutral-200 dark:bg-neutral-800 ltr:ml-2 rtl:mr-2" />
            </button>
            <div v-if="showResolved" class="space-y-2.5 mt-1">
              <div
                v-for="thread in resolvedThreads"
                :key="thread.id"
                class="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 opacity-[0.72] hover:opacity-100 transition"
              >
                <div class="px-3.5 py-3 space-y-3">
                  <div
                    v-for="comment in thread.comments"
                    :key="comment.id"
                    class="flex gap-2.5"
                  >
                    <div
                      class="shrink-0 w-6 h-6 rounded-full grid place-items-center text-[10px] font-semibold text-white"
                      :style="{ backgroundColor: getAuthorColor(comment.authorId) }"
                    >
                      {{ getInitials(comment.authorName) }}
                    </div>
                    <div class="flex-1 min-w-0">
                      <div class="flex items-baseline gap-1.5">
                        <span class="text-[13px] font-medium text-neutral-900 dark:text-neutral-100">{{ comment.authorName || 'Unknown' }}</span>
                        <span class="text-[11px] text-neutral-500">{{ formatRelative(comment.createdAt) }}</span>
                      </div>
                      <p class="mt-0.5 text-[13px] leading-[1.5] text-neutral-600 dark:text-neutral-400 whitespace-pre-wrap break-words">{{ comment.content }}</p>
                    </div>
                  </div>
                </div>
                <div class="px-3 py-2 border-t border-neutral-100 dark:border-neutral-800">
                  <button
                    class="text-[12px] font-medium text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100"
                    @click="toggleResolve(thread.id)"
                  >
                    {{ translationsComments.reopen || 'Re-open' }}
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div
            v-if="!unresolvedThreads.length && !resolvedThreads.length && !pendingThreadId"
            class="px-6 py-14 flex flex-col items-center text-center"
          >
            <div class="w-10 h-10 rounded-xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 grid place-items-center text-neutral-400 mb-3">
              <v-remixicon name="riChatSmile3Line" size="20" />
            </div>
            <p class="text-[13px] font-medium text-neutral-900 dark:text-neutral-100">{{ translationsComments.empty || 'No comments yet' }}</p>
            <p class="text-xs text-neutral-500 dark:text-neutral-400 mt-1 max-w-[22ch] leading-relaxed">
              Select text in the note and add a comment. Threads appear here.
            </p>
          </div>
        </template>
      </div>

      <div class="shrink-0 p-3 bg-white dark:bg-neutral-900 border-t border-neutral-200 dark:border-neutral-800">
        <div class="flex gap-2.5 items-end">
          <div
            class="hidden sm:grid shrink-0 w-7 h-7 rounded-full place-items-center text-[11px] font-semibold text-white"
            :style="{ backgroundColor: getAuthorColor(accountStore.profile?.id || 'me') }"
          >
            {{ getInitials(accountStore.profile?.username || 'Me') }}
          </div>
          <div class="flex-1 relative">
            <textarea
              v-model="newComment"
              :placeholder="translationsComments.placeholder || 'Add a comment...'"
              rows="1"
              class="w-full resize-none min-h-[40px] max-h-[96px] text-[13.5px] leading-5 pr-10 pl-3.5 py-2.5 rounded-xl border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 placeholder:text-neutral-400 outline-none focus:bg-white dark:focus:bg-neutral-900 focus:border-neutral-300 dark:focus:border-neutral-600 focus:ring-2 focus:ring-primary/10 transition"
              @keydown.enter.exact.prevent="submitComment"
            />
            <button
              class="absolute ltr:right-1.5 rtl:left-1.5 top-1/2 -translate-y-1/2 w-7 h-7 grid place-items-center rounded-full bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 hover:opacity-90 disabled:opacity-30 disabled:pointer-events-none transition"
              :disabled="!newComment.trim()"
              aria-label="Send comment"
              @click="submitComment"
            >
              <v-remixicon name="riSendPlaneFill" size="14" />
            </button>
          </div>
        </div>
        <p class="hidden sm:block text-[11px] text-neutral-400 mt-1.5 ltr:ml-9 rtl:mr-9">↵ to send · ⇧↵ for new line</p>
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
    docked: { type: Boolean, default: false },
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
      reopen: translations.value['comments.reopen'] || 'Re-open',
      empty: translations.value['comments.empty'] || 'No comments yet',
      newComment: translations.value['comments.newComment'] || 'New thread',
      delete: translations.value['comments.delete'] || 'Delete',
    }));

    const loading = computed(() => commentStore.loading);
    const activeThreadId = computed(() => commentStore.activeThreadId);
    const pendingThreadId = computed(() => commentStore.pendingThreadId);
    const unresolvedThreads = computed(() => commentStore.unresolvedThreads);
    const resolvedThreads = computed(() => commentStore.resolvedThreads);
    const totalThreads = computed(() => unresolvedThreads.value.length + resolvedThreads.value.length);

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
      const parts = name.trim().split(/\s+/);
      if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
      return parts[0].slice(0, 2).toUpperCase();
    }

    function formatRelative(dateStr) {
      if (!dateStr) return '';
      const d = new Date(dateStr);
      const diff = Date.now() - d.getTime();
      const mins = Math.floor(diff / 60000);
      if (mins < 1) return 'now';
      if (mins < 60) return `${mins}m`;
      const hrs = Math.floor(mins / 60);
      if (hrs < 24) return `${hrs}h`;
      const days = Math.floor(hrs / 24);
      if (days < 7) return `${days}d`;
      return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
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

    async function deleteComment(commentId) {
      if (!commentId) return;
      try {
        await commentStore.removeComment(commentId, {
          baseUrl: accountStore.serverUrl,
        });
      } catch (err) {
        console.error('[comment] Failed to delete comment:', err);
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
      totalThreads,
      newComment,
      pendingComment,
      replyInputs,
      showResolved,
      accountStore,
      getAuthorColor,
      getInitials,
      formatRelative,
      submitComment,
      submitPendingComment,
      submitReply,
      toggleResolve,
      deleteComment,
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
.slide-right-docked-enter-active,
.slide-right-docked-leave-active {
  transition: transform 220ms var(--ease-standard), opacity 220ms var(--ease-standard);
}
.slide-right-docked-enter-from,
.slide-right-docked-leave-to {
  transform: translateX(8px);
  opacity: 0;
}
@media (prefers-reduced-motion: reduce) {
  .slide-right-enter-active,
  .slide-right-leave-active,
  .slide-right-docked-enter-active,
  .slide-right-docked-leave-active {
    transition-duration: 0.01ms;
  }
}
</style>
