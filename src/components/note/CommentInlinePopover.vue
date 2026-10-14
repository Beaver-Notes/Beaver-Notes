<template>
  <!-- Anchored to the editor mark via [data-comment-id]; falls back to hidden
    (sidebar still shows the thread) when the mark is not in the DOM. -->
  <ui-popover
    :to="anchorEl || undefined"
    :model-value="open"
    placement="bottom-start"
    @update:model-value="onOpenChange"
  >
    <div data-testid="inline-popover" class="w-[320px] max-w-[86vw]">
      <div class="flex items-center gap-2 px-3 pt-2.5">
        <div class="flex -space-x-1.5">
          <ui-user-avatar
            v-for="c in threadAvatars"
            :key="c.id"
            :name="c.authorName || '?'"
            :size="20"
            class="ring-2 ring-white dark:ring-neutral-900"
          />
        </div>
        <span class="text-[13px] font-semibold text-neutral-900 dark:text-neutral-100 truncate">
          {{ threadTitle }}
        </span>
        <span
          class="shrink-0 inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-neutral-100 dark:bg-neutral-800 text-xs font-medium text-neutral-600 dark:text-neutral-400 tabular-nums"
        >
          {{ thread ? thread.comments.length : 0 }}
        </span>
        <button
          class="ltr:ml-auto rtl:mr-auto shrink-0 w-6 h-6 grid place-items-center rounded-md text-neutral-400 hover:text-neutral-900 hover:bg-neutral-100 dark:hover:text-neutral-100 dark:hover:bg-neutral-800 transition-colors focus-visible:ring-2 focus-visible:ring-secondary focus-visible:outline-none"
          aria-label="Close thread preview"
          @click="dismiss"
        >
          <v-remixicon name="riCloseLine" size="15" />
        </button>
      </div>

      <div class="max-h-64 overflow-y-auto overscroll-contain px-3 py-2 space-y-3">
        <div v-for="c in thread?.comments || []" :key="c.id" class="flex gap-2">
          <ui-user-avatar :name="c.authorName || '?'" :size="22" />
          <div class="flex-1 min-w-0">
            <div class="flex items-baseline gap-1.5">
              <span class="text-[13px] font-medium text-neutral-900 dark:text-neutral-100 truncate">
                {{ c.authorName }}
              </span>
              <span class="text-xs text-neutral-500 dark:text-neutral-400 tabular-nums" :title="fullDate(c.createdAt)">
                {{ formatRelative(c.createdAt) }}
              </span>
            </div>
            <p
              data-testid="inline-popover-body"
              class="mt-0.5 text-[13px] leading-[1.5] text-neutral-700 dark:text-neutral-300 whitespace-pre-wrap break-words"
              v-html="formatBody(c.content)"
            />
            <reaction-bar
              class="mt-1"
              :reactions="c.reactions"
              :my-id="myId"
              @toggle="(emoji) => onToggleReaction(c.id, emoji)"
            />
          </div>
        </div>
      </div>

      <div class="px-3 pb-1">
        <ui-input
          v-model="replyText"
          placeholder="Reply..."
          @keydown="onReplyKey"
        >
          <template #append>
            <button
              class="w-6 h-6 grid place-items-center rounded-full bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 hover:opacity-90 disabled:opacity-30 disabled:pointer-events-none transition focus-visible:ring-2 focus-visible:ring-secondary focus-visible:outline-none"
              :disabled="!replyText.trim()"
              data-testid="inline-popover-reply"
              aria-label="Reply"
              @click="submitReply"
            >
              <v-remixicon name="riArrowUpLine" size="13" />
            </button>
          </template>
        </ui-input>
      </div>

      <div class="flex items-center gap-1.5 px-3 py-2">
        <ui-button variant="secondary" @click="toggleResolve">
          {{ thread?.resolved ? 'Re-open' : 'Resolve' }}
        </ui-button>
        <ui-button @click="openInSidebar">
          Open in sidebar
        </ui-button>
      </div>
    </div>
  </ui-popover>
</template>

<script>
import { ref, computed, watch, nextTick, onMounted } from 'vue';
import { useCommentStore } from '@/store/comment';
import { useAccountStore } from '@/store/account';
import ReactionBar from '@/components/note/ReactionBar.vue';

function escapeAttr(s) {
  if (typeof CSS !== 'undefined' && CSS.escape) return CSS.escape(String(s));
  return String(s).replace(/["\\]/g, '\\$&');
}

export default {
  components: { ReactionBar },
  props: {
    noteId: { type: String, required: true },
  },
  setup(props) {
    const commentStore = useCommentStore();
    const accountStore = useAccountStore();
    const replyText = ref('');
    const anchorEl = ref(null);

    // Hover preview (desktop fine-pointer) and the click/selection path share
    // this popover; hover wins when both are set so moving onto a different
    // mark shows that mark's thread.
    const visibleThreadId = computed(
      () => commentStore.hoverThreadId || commentStore.activeThreadId || null
    );
    const thread = computed(() => {
      const threads = commentStore.threads || [];
      return threads.find((t) => t.id === visibleThreadId.value) || null;
    });
    const open = computed(() => !!thread.value && !!anchorEl.value);
    const myId = computed(() => accountStore.profile?.id || null);
    const threadAvatars = computed(() => (thread.value?.comments || []).slice(0, 3));
    const threadTitle = computed(() => {
      if (!thread.value) return '';
      const first = thread.value.comments[0]?.authorName;
      return thread.value.resolved ? `Resolved · ${first || 'Thread'}` : first || 'Thread';
    });

    async function resolveAnchor() {
      await nextTick();
      try {
        const id = visibleThreadId.value;
        anchorEl.value = id
          ? document.querySelector(`[data-comment-id="${escapeAttr(id)}"]`)
          : null;
      } catch {
        anchorEl.value = null;
      }
    }

    watch(visibleThreadId, () => {
      replyText.value = '';
      resolveAnchor();
    });
    onMounted(resolveAnchor);

    function dismiss() {
      commentStore.activeThreadId = null;
      commentStore.setHoverThread?.(null);
    }

    function onOpenChange(val) {
      // Outside-click / Escape from ui-popover: dismiss the peek, keep the sidebar as-is.
      if (!val) dismiss();
    }

    function onToggleReaction(commentId, emoji) {
      commentStore
        .toggleReaction(commentId, emoji, { baseUrl: accountStore.serverUrl })
        .catch((err) => console.error('[comment] Failed to toggle reaction from popover:', err));
    }

    async function submitReply() {
      const content = replyText.value.trim();
      if (!content || !thread.value) return;
      try {
        await commentStore.addComment(props.noteId, {
          content,
          threadId: thread.value.id,
          parentId: thread.value.id,
          baseUrl: accountStore.serverUrl,
        });
        replyText.value = '';
      } catch (err) {
        console.error('[comment] Failed to reply from popover:', err);
      }
    }

    function onReplyKey(e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        submitReply();
      }
    }

    async function toggleResolve() {
      if (!thread.value) return;
      try {
        await commentStore.toggleResolve(thread.value.id, {
          baseUrl: accountStore.serverUrl,
        });
      } catch (err) {
        console.error('[comment] Failed to toggle resolve from popover:', err);
      }
    }

    function openInSidebar() {
      if (commentStore.openSidebar) commentStore.openSidebar();
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

    function fullDate(dateStr) {
      if (!dateStr) return '';
      return new Date(dateStr).toLocaleString();
    }

    function formatBody(content) {
      const esc = String(content ?? '').replace(/[&<>"']/g, (c) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      }[c]));
      return esc.replace(
        /@([\w.-]+)/g,
        '<span class="bg-primary/10 text-primary font-semibold rounded-full px-1">@$1</span>'
      );
    }

    return {
      thread,
      open,
      anchorEl,
      myId,
      threadAvatars,
      threadTitle,
      replyText,
      dismiss,
      onOpenChange,
      onToggleReaction,
      submitReply,
      onReplyKey,
      toggleResolve,
      openInSidebar,
      formatRelative,
      fullDate,
      formatBody,
    };
  },
};
</script>
