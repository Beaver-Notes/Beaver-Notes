<template>
  <!--
    One shell, two presentations:
    - below md: ui-modal (bottom sheet)
    - md and up: a floating card, sized like the note action dock
    The content below is shared, so there is a single copy of the markup.
  -->
  <component ref="shellRef" :is="isModal ? 'ui-modal' : 'aside'" v-bind="shellAttrs" v-on="shellListeners">
    <!-- ui-modal renders this above its content. A native <aside> ignores named slots. -->
    <template v-if="isModal" #header>
      <div class="flex items-center gap-2 px-4">
        <h3 class="text-base font-semibold tracking-tight text-neutral-900 dark:text-neutral-100 truncate">
          {{ translationsComments.title }}
        </h3>
        <span
          v-if="totalThreads"
          class="shrink-0 inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-neutral-100 dark:bg-neutral-800 text-xs font-medium text-neutral-600 dark:text-neutral-400 tabular-nums"
        >
          {{ totalThreads }}
        </span>
        <button
          type="button"
          class="ltr:ml-auto rtl:mr-auto ltr:-mr-2 rtl:-ml-2 shrink-0 grid place-items-center rounded-lg text-neutral-500 hover:text-neutral-900 hover:bg-neutral-100 dark:hover:text-neutral-100 dark:hover:bg-neutral-800 transition-colors focus-visible:ring-2 focus-visible:ring-secondary focus-visible:outline-none"
          :class="iconBtn"
          :aria-label="translationsComments.close"
          @click="requestClose"
        >
          <v-remixicon name="riCloseLine" size="20" />
        </button>
      </div>
    </template>

    <div data-testid="comments-panel" :class="bodyClass">
      <!-- Header (desktop panel / drawer) -->
      <header
        v-if="!isModal"
        class="shrink-0 flex items-center gap-2 px-4 h-[52px] border-b border-neutral-200 dark:border-neutral-800"
      >
        <h3 class="text-sm font-semibold tracking-tight text-neutral-900 dark:text-neutral-100 truncate">
          {{ translationsComments.title }}
        </h3>
        <span
          v-if="totalThreads"
          class="shrink-0 inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-neutral-100 dark:bg-neutral-800 text-xs font-medium text-neutral-600 dark:text-neutral-400 tabular-nums"
        >
          {{ totalThreads }}
        </span>
        <button
          type="button"
          class="ltr:ml-auto rtl:mr-auto ltr:-mr-2 rtl:-ml-2 shrink-0 grid place-items-center rounded-lg text-neutral-500 hover:text-neutral-900 hover:bg-neutral-100 dark:hover:text-neutral-100 dark:hover:bg-neutral-800 transition-colors focus-visible:ring-2 focus-visible:ring-secondary focus-visible:outline-none"
          :class="iconBtn"
          :aria-label="translationsComments.close"
          @click="requestClose"
        >
          <v-remixicon name="riCloseLine" size="20" />
        </button>
      </header>

      <!-- Filters -->
      <div
        class="shrink-0 px-4 pt-3 pb-2"
        role="tablist"
        :aria-label="translationsComments.filterLabel"
      >
        <div class="flex items-center gap-0.5 p-0.5 rounded-xl bg-neutral-100 dark:bg-neutral-800">
          <button
            v-for="f in filters"
            :key="f.id"
            type="button"
            role="tab"
            :aria-selected="activeFilter === f.id ? 'true' : 'false'"
            class="flex-1 rounded-lg text-[13px] font-medium transition focus-visible:ring-2 focus-visible:ring-secondary focus-visible:outline-none"
            :class="[
              isModal ? 'h-10' : 'h-8',
              activeFilter === f.id
                ? 'bg-white dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100 shadow-sm'
                : 'text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100',
            ]"
            @click="activeFilter = f.id"
          >
            {{ f.label }} <span class="tabular-nums opacity-70">{{ f.count }}</span>
          </button>
        </div>
      </div>

      <!-- Thread list -->
      <div ref="listEl" class="flex-1 min-h-0 overflow-y-auto overscroll-contain">
        <div
          v-if="loading"
          data-testid="comment-loading"
          class="py-16 flex flex-col items-center gap-3 text-neutral-400"
        >
          <ui-spinner size="20" color="text-neutral-400" />
          <span class="text-xs">{{ translationsComments.loading }}</span>
        </div>

        <div
          v-else-if="unavailable"
          data-testid="comments-unavailable"
          class="px-6 py-14 flex flex-col items-center text-center"
        >
          <div class="w-10 h-10 rounded-xl border border-neutral-200 dark:border-neutral-800 grid place-items-center text-neutral-400 mb-3">
            <v-remixicon name="riChat3Line" size="20" />
          </div>
          <p class="text-[13px] font-medium text-neutral-900 dark:text-neutral-100">
            {{ translationsComments.unavailable }}
          </p>
          <p class="text-xs text-neutral-500 dark:text-neutral-400 mt-1 max-w-[28ch] leading-relaxed">
            {{ translationsComments.unavailableHint }}
          </p>
        </div>

        <div v-else-if="!visibleThreads.length" class="px-6 py-14 flex flex-col items-center text-center">
          <div class="w-10 h-10 rounded-xl border border-neutral-200 dark:border-neutral-800 grid place-items-center text-neutral-400 mb-3">
            <v-remixicon :name="emptyState.icon" size="20" />
          </div>
          <p class="text-[13px] font-medium text-neutral-900 dark:text-neutral-100">{{ emptyState.title }}</p>
          <p class="text-xs text-neutral-500 dark:text-neutral-400 mt-1 max-w-[26ch] leading-relaxed">
            {{ emptyState.hint }}
          </p>
        </div>

        <ul v-else class="p-3 space-y-3">
          <li
            v-for="thread in visibleThreads"
            :key="thread.id"
            data-testid="comment-thread"
            :data-thread-id="thread.id"
            class="rounded-xl border bg-white dark:bg-neutral-900 overflow-hidden transition"
            :class="[
              thread.id === activeThreadId
                ? 'border-primary/40 ring-2 ring-primary/15'
                : 'border-neutral-200 dark:border-neutral-800',
              isResolved(thread) ? 'opacity-75' : '',
            ]"
            @mouseenter="setThreadMark(thread.id, true)"
            @mouseleave="setThreadMark(thread.id, false)"
          >
            <!-- Quote of the text this thread is attached to -->
            <button
              v-if="thread.anchorFrom !== null && thread.anchorFrom !== undefined"
              type="button"
              data-testid="comment-anchor"
              class="flex w-full items-center gap-2 border-b border-neutral-100 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-800/70 px-3.5 text-left text-xs text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100 transition-colors focus-visible:ring-2 focus-visible:ring-secondary focus-visible:outline-none"
              :class="isModal ? 'min-h-11 py-2.5' : 'py-2'"
              @click="goToAnchor(thread)"
            >
              <v-remixicon name="riLink" size="12" class="shrink-0" />
              <span class="truncate">{{ threadSnippet(thread) }}</span>
            </button>

            <!-- Comments -->
            <div class="divide-y divide-neutral-100 dark:divide-neutral-800">
              <div
                v-for="(comment, ci) in thread.comments"
                :key="comment.id"
                class="px-3.5 py-3"
                :class="{ 'bg-neutral-50/60 dark:bg-neutral-800/40': ci > 0 }"
              >
                <div class="flex gap-2.5">
                  <ui-user-avatar :name="comment.authorName || '?'" :size="28" class="shrink-0" />
                  <div class="flex-1 min-w-0">
                    <div class="flex items-center gap-1.5 min-h-[28px]">
                      <span
                        data-testid="comment-author"
                        class="text-[13px] font-medium text-neutral-900 dark:text-neutral-100 truncate"
                      >
                        {{ comment.authorName }}
                      </span>
                      <span
                        class="shrink-0 text-xs text-neutral-500 dark:text-neutral-400 tabular-nums"
                        :title="fullDate(comment.createdAt)"
                      >
                        {{ formatRelative(comment.createdAt) }}
                      </span>
                      <!-- Always visible: hover-only actions are unreachable on touch -->
                      <span
                        v-if="!isResolved(thread)"
                        class="ltr:ml-auto rtl:mr-auto ltr:-mr-2 rtl:-ml-2 flex items-center shrink-0"
                      >
                        <button
                          v-if="canEdit(comment)"
                          type="button"
                          data-testid="comment-edit"
                          class="grid place-items-center rounded-lg text-neutral-400 hover:text-neutral-900 hover:bg-neutral-100 dark:hover:text-neutral-100 dark:hover:bg-neutral-800 transition focus-visible:ring-2 focus-visible:ring-secondary focus-visible:outline-none"
                          :class="smallIconBtn"
                          :aria-label="translationsComments.edit"
                          @click="startEdit(comment)"
                        >
                          <v-remixicon name="riEditLine" size="15" />
                        </button>
                        <button
                          type="button"
                          data-testid="comment-delete"
                          class="grid place-items-center rounded-lg text-neutral-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 transition focus-visible:ring-2 focus-visible:ring-secondary focus-visible:outline-none"
                          :class="smallIconBtn"
                          :aria-label="translationsComments.delete"
                          @click="deleteComment(comment.id)"
                        >
                          <v-remixicon name="riDeleteBinLine" size="15" />
                        </button>
                      </span>
                    </div>

                    <div v-if="editingId === comment.id" class="mt-1.5">
                      <textarea
                        v-model="editDraft"
                        data-testid="comment-edit-input"
                        rows="3"
                        class="w-full resize-none text-base md:text-[13.5px] leading-5 px-3 py-2 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 outline-none focus:bg-white dark:focus:bg-neutral-900 focus:border-neutral-300 dark:focus:border-neutral-600 transition"
                        @keydown="onEditKey"
                      />
                      <div class="flex gap-2 mt-2">
                        <ui-button variant="primary" data-testid="comment-edit-save" @click="saveEdit">
                          {{ translationsComments.save }}
                        </ui-button>
                        <ui-button @click="cancelEdit">
                          {{ translationsComments.cancel }}
                        </ui-button>
                      </div>
                    </div>
                    <p
                      v-else
                      data-testid="comment-body"
                      class="mt-0.5 text-[14px] leading-[1.55] text-neutral-700 dark:text-neutral-300 whitespace-pre-wrap break-words"
                      v-html="formatBody(comment.content)"
                    />

                    <reaction-bar
                      v-if="!isResolved(thread)"
                      class="mt-1.5"
                      :reactions="comment.reactions"
                      :my-id="myId"
                      :aria-label="translationsComments.addReaction"
                      @toggle="(emoji) => onToggleReaction(comment.id, emoji)"
                    />
                  </div>
                </div>
              </div>
            </div>

            <!-- Thread actions -->
            <div class="flex items-center gap-1 px-2.5 py-2 border-t border-neutral-100 dark:border-neutral-800 bg-neutral-50/80 dark:bg-neutral-900">
              <button
                v-if="!isResolved(thread)"
                type="button"
                class="inline-flex items-center gap-1.5 text-[13px] font-medium px-3 rounded-full bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-700 transition focus-visible:ring-2 focus-visible:ring-secondary focus-visible:outline-none"
                :class="isModal ? 'min-h-11' : 'min-h-8'"
                @click="toggleResolve(thread.id)"
              >
                <v-remixicon name="riCheckLine" size="14" class="text-primary" />
                {{ translationsComments.resolve }}
              </button>
              <button
                v-else
                type="button"
                class="inline-flex items-center gap-1.5 text-[13px] font-medium px-3 rounded-full bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-700 transition focus-visible:ring-2 focus-visible:ring-secondary focus-visible:outline-none"
                :class="isModal ? 'min-h-11' : 'min-h-8'"
                @click="toggleResolve(thread.id)"
              >
                {{ translationsComments.reopen }}
              </button>
              <button
                v-if="!isResolved(thread)"
                type="button"
                class="inline-flex items-center gap-1.5 text-[13px] font-medium px-3 rounded-full text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition focus-visible:ring-2 focus-visible:ring-secondary focus-visible:outline-none"
                :class="isModal ? 'min-h-11' : 'min-h-8'"
                :aria-expanded="replyOpenId === thread.id ? 'true' : 'false'"
                @click="toggleReply(thread.id)"
              >
                <v-remixicon name="riArrowGoBackLine" size="14" />
                {{ translationsComments.reply }}
              </button>
              <span class="ltr:ml-auto rtl:mr-auto ltr:pr-1.5 rtl:pl-1.5 text-xs text-neutral-400 tabular-nums">
                {{ thread.comments.length }}
                {{ thread.comments.length === 1 ? translationsComments.comment : translationsComments.comments }}
              </span>
            </div>

            <!-- Reply field: only when asked for, keeps the list short on phones -->
            <div
              v-if="replyOpenId === thread.id && !isResolved(thread)"
              class="flex items-center gap-2 px-3 py-2.5 border-t border-neutral-100 dark:border-neutral-800"
            >
              <input
                :ref="replyRef(thread.id)"
                v-model="replyInputs[thread.id]"
                type="text"
                enterkeyhint="send"
                autocomplete="off"
                :placeholder="translationsComments.replyPlaceholder"
                class="flex-1 min-w-0 text-base md:text-[13.5px] px-3 rounded-full border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 placeholder:text-neutral-400 outline-none focus:bg-white dark:focus:bg-neutral-900 focus:border-neutral-300 dark:focus:border-neutral-600 transition"
                :class="isModal ? 'h-11' : 'h-9'"
                @keydown="onReplyKey($event, thread.id)"
              />
              <button
                type="button"
                data-testid="comment-reply"
                class="shrink-0 grid place-items-center rounded-full bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 hover:opacity-90 disabled:opacity-30 disabled:pointer-events-none transition focus-visible:ring-2 focus-visible:ring-secondary focus-visible:outline-none"
                :class="isModal ? 'w-11 h-11' : 'w-9 h-9'"
                :disabled="!replyInputs[thread.id]?.trim()"
                :aria-label="translationsComments.send"
                @click="submitReply(thread.id)"
              >
                <v-remixicon name="riArrowUpLine" size="16" />
              </button>
            </div>
          </li>
        </ul>
      </div>

      <!-- Errors sit next to the composer so they are visible without scrolling -->
      <p
        v-if="actionError"
        data-testid="comment-action-error"
        role="alert"
        class="shrink-0 mx-3 mb-2 rounded-lg bg-red-50 dark:bg-red-900/20 px-3 py-2 text-xs text-red-600 dark:text-red-400"
      >
        {{ actionError }}
      </p>

      <!-- Composer -->
      <div
        v-if="!unavailable"
        class="shrink-0 px-3 pt-3 bg-white dark:bg-neutral-950 border-t border-neutral-200 dark:border-neutral-800"
        :class="isModal ? 'pb-1' : 'pb-3'"
      >
        <div
          v-if="mentionSuggestions.length"
          class="mb-2 flex flex-wrap gap-1.5"
          role="listbox"
          :aria-label="translationsComments.mentionSuggestions"
        >
          <button
            v-for="u in mentionSuggestions"
            :key="u.id"
            type="button"
            role="option"
            class="inline-flex items-center gap-1.5 pl-1 pr-3 rounded-full bg-neutral-100 dark:bg-neutral-800 text-xs text-neutral-700 dark:text-neutral-300 hover:bg-neutral-200 dark:hover:bg-neutral-700 transition"
            :class="isModal ? 'min-h-10' : 'min-h-7'"
            @click="insertMention(u)"
          >
            <ui-user-avatar :name="u.username || u.label || '?'" :size="20" />
            @{{ u.username || u.label }}
          </button>
        </div>

        <div class="flex items-end gap-2">
          <textarea
            ref="composerEl"
            v-model="newComment"
            data-testid="comment-input"
            rows="1"
            enterkeyhint="enter"
            :placeholder="translationsComments.placeholder"
            class="flex-1 min-w-0 resize-none min-h-[44px] max-h-[120px] text-base md:text-[13.5px] leading-5 px-3.5 py-3 md:py-2.5 rounded-xl border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 placeholder:text-neutral-400 outline-none focus:bg-white dark:focus:bg-neutral-900 focus:border-neutral-300 dark:focus:border-neutral-600 focus:ring-2 focus:ring-primary/10 transition"
            @input="autosize($event.target)"
            @keydown="onComposerKey"
          />
          <ui-button
            circle
            icon
            variant="primary"
            class="shrink-0 !min-h-0 !p-0"
            :class="isModal ? '!h-11 !w-11' : '!h-9 !w-9'"
            :disabled="!newComment.trim()"
            data-testid="comment-submit"
            :aria-label="translationsComments.sendComment"
            @click="submitComment"
          >
            <v-remixicon name="riSendPlaneFill" size="16" />
          </ui-button>
        </div>
        <p v-if="!isModal" class="text-xs text-neutral-400 mt-1.5">
          {{ translationsComments.keyboardHint }}
        </p>
      </div>
    </div>
  </component>
</template>

<script>
import { ref, computed, reactive, watch, nextTick, onMounted, onUnmounted } from 'vue';
import { useCommentStore } from '@/store/comment';
import { useTranslations } from '@/composable/useTranslations';
import { useAccountStore } from '@/store/account';
import { useCollaboratorStore } from '@/store/collaborator';
import { useToastStore } from '@/store/ui-toast';
import { triggerSelectionHaptic } from '@/lib/native/haptics';
import ReactionBar from '@/components/note/ReactionBar.vue';

// Literals kept in source so Tailwind emits the utilities used on external
// note marks (highlighting a thread card's anchor in the editor DOM).
const MARK_ACTIVE_CLASSES = ['outline-primary', 'outline-2', 'outline-offset-2'];

function useMediaQuery(query) {
  const mq =
    typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(query) : null;
  const matches = ref(mq?.matches || false);
  const onChange = (e) => {
    matches.value = e.matches;
  };
  onMounted(() => mq?.addEventListener?.('change', onChange));
  onUnmounted(() => mq?.removeEventListener?.('change', onChange));
  return matches;
}

export default {
  components: { ReactionBar },
  props: {
    noteId: { type: String, required: true },
    // Optional tiptap editor, used only to derive quote snippets from anchors.
    editor: { type: Object, default: null },
  },
  emits: ['close'],
  setup(props, { emit }) {
    const commentStore = useCommentStore();
    const accountStore = useAccountStore();
    const { translations } = useTranslations();

    const newComment = ref('');
    const replyInputs = reactive({});
    const replyOpenId = ref(null);
    const actionError = ref('');
    const activeFilter = ref('open');
    const editingId = ref(null);
    const editDraft = ref('');
    const composerEl = ref(null);
    const listEl = ref(null);
    const replyInputEls = {};

    // ---- Presentation -----------------------------------------------------
    // Below md the card has nowhere to go, so the panel becomes the house sheet.
    const belowMd = useMediaQuery('(max-width: 767px)');
    const isModal = computed(() => belowMd.value);

    // Floating card under the note action dock: same width as that dock, capped
    // in height so a long thread list scrolls inside instead of covering the note.
    const panelClass = computed(() => {
      // shortcut: fixed spot (sticky toolbar at top-4 + its 40px row), not
      // measured — move to floating-ui if the toolbar ever moves or grows.
      const base =
        'flex flex-col bg-white dark:bg-neutral-950 border-neutral-200 dark:border-neutral-800';
      return `${base} comments-enter-card fixed ltr:right-4 rtl:left-4 top-[4.5rem] z-40 w-[380px] max-w-[92vw] max-h-[min(70vh,560px)] rounded-xl border shadow-xl overflow-hidden`;
    });

    const shellRef = ref(null);

    // ui-modal skips its enter transition when modelValue starts true, so mount
    // it closed and open it on the next tick.
    const modalOpen = ref(false);
    onMounted(() => {
      nextTick(() => (modalOpen.value = true));
    });

    // Not customContent: that would drop the modal's card, grab handle, swipe to
    // close, dialog role and safe-area padding. `title` only feeds the dialog's
    // aria-label here, because the #header slot replaces the visible title.
    // `!px-0` lets the list and composer run edge to edge inside the card.
    const shellAttrs = computed(() =>
      isModal.value
        ? {
            modelValue: modalOpen.value,
            title: translationsComments.value.title,
            contentClass: 'max-w-lg !px-0',
          }
        : { class: panelClass.value, 'aria-label': translationsComments.value.title }
    );
    // Backdrop tap, Esc and swipe all end in update:modelValue(false).
    const shellListeners = computed(() =>
      isModal.value
        ? {
            'update:modelValue': (open) => {
              modalOpen.value = open;
              if (!open) emit('close');
            },
          }
        : {}
    );

    // Close through the modal's own closeModal() so it releases the scroll lock,
    // focus trap and focus restore before the parent unmounts us.
    function requestClose() {
      const modal = shellRef.value;
      if (isModal.value && typeof modal?.closeModal === 'function') modal.closeModal();
      else emit('close');
    }

    const bodyClass = computed(() =>
      isModal.value
        ? 'flex h-[min(68dvh,640px)] min-h-0 w-full flex-col'
        : 'flex min-h-0 w-full flex-1 flex-col'
    );
    const iconBtn = computed(() => (isModal.value ? 'w-11 h-11' : 'w-8 h-8'));
    const smallIconBtn = computed(() => (isModal.value ? 'w-10 h-10' : 'w-7 h-7'));

    // ---- Copy -------------------------------------------------------------
    const translationsComments = computed(() => {
      const c = translations.value.comments || {};
      return {
        title: c.title || 'Comments',
        close: c.close || 'Close comments',
        filterLabel: c.filterLabel || 'Filter comment threads',
        filterOpen: c.filterOpen || 'Open',
        filterResolved: c.filterResolved || 'Resolved',
        filterAll: c.filterAll || 'All',
        loading: c.loading || 'Loading threads…',
        placeholder: c.placeholder || 'Add a comment...',
        replyPlaceholder: c.replyPlaceholder || 'Reply...',
        send: c.send || 'Send',
        sendComment: c.sendComment || 'Send comment',
        reply: c.reply || 'Reply',
        resolve: c.resolve || 'Resolve',
        reopen: c.reopen || 'Re-open',
        edit: c.edit || 'Edit',
        save: c.save || 'Save',
        cancel: c.cancel || 'Cancel',
        delete: c.delete || 'Delete',
        empty: c.empty || 'No comments yet',
        emptyHint: c.emptyHint || 'Select text in the note and add a comment. Threads appear here.',
        caughtUp: c.caughtUp || 'All caught up',
        caughtUpHint: c.caughtUpHint || 'No open comments on this note.',
        unavailable: c.unavailable || 'Comments work on shared notes',
        unavailableHint: c.unavailableHint || 'Invite someone to this note to turn comments on.',
        attachedToText: c.attachedToText || 'Attached to text',
        addReaction: c.addReaction || 'Add reaction',
        mentionSuggestions: c.mentionSuggestions || 'Mention suggestions',
        threadResolved: c.threadResolved || 'Thread resolved',
        threadReopened: c.threadReopened || 'Thread re-opened',
        comment: c.comment || 'comment',
        comments: c.comments || 'comments',
        keyboardHint: c.keyboardHint || '↵ to send · ⇧↵ for new line · @ to mention',
      };
    });

    // ---- Threads ----------------------------------------------------------
    const loading = computed(() => commentStore.loading);
    const unavailable = computed(() => commentStore.unavailable);
    const activeThreadId = computed(() => commentStore.activeThreadId);
    const unresolvedThreads = computed(() => commentStore.unresolvedThreads);
    const resolvedThreads = computed(() => commentStore.resolvedThreads);
    const totalThreads = computed(
      () => unresolvedThreads.value.length + resolvedThreads.value.length
    );
    const resolvedIds = computed(() => new Set(resolvedThreads.value.map((t) => t.id)));
    const isResolved = (thread) => resolvedIds.value.has(thread.id);

    const meName = computed(() => accountStore.profile?.username || 'Me');
    const myId = computed(() => accountStore.profile?.id || null);

    const filters = computed(() => [
      { id: 'open', label: translationsComments.value.filterOpen, count: unresolvedThreads.value.length },
      { id: 'resolved', label: translationsComments.value.filterResolved, count: resolvedThreads.value.length },
      { id: 'all', label: translationsComments.value.filterAll, count: totalThreads.value },
    ]);

    // One flat list: open threads first, then resolved ones (dimmed in the card).
    const visibleThreads = computed(() => {
      if (activeFilter.value === 'open') return unresolvedThreads.value;
      if (activeFilter.value === 'resolved') return resolvedThreads.value;
      return [...unresolvedThreads.value, ...resolvedThreads.value];
    });

    const emptyState = computed(() => {
      const t = translationsComments.value;
      if (totalThreads.value === 0) {
        return { icon: 'riChatSmile3Line', title: t.empty, hint: t.emptyHint };
      }
      return { icon: 'riCheckboxCircleLine', title: t.caughtUp, hint: t.caughtUpHint };
    });

    // Short quote from the editor doc when anchors resolve; generic label otherwise
    // (anchors live in the encrypted payload, so older threads may lack offsets).
    function threadSnippet(thread) {
      const fallback = translationsComments.value.attachedToText;
      const from = thread.anchorFrom;
      const to = thread.anchorTo;
      const doc = props.editor?.state?.doc;
      if (from == null || to == null || !doc || typeof doc.textBetween !== 'function') {
        return fallback;
      }
      try {
        const text = doc.textBetween(from, to, ' ', ' ').trim();
        if (!text) return fallback;
        const max = 60;
        return text.length > max ? `${text.slice(0, max)}…` : text;
      } catch {
        return fallback;
      }
    }

    function markSelector(threadId) {
      try {
        return `[data-comment-id="${CSS.escape(threadId)}"]`;
      } catch {
        return `[data-comment-id="${threadId}"]`;
      }
    }

    // Highlights a thread's anchor mark in the note (desktop hover, anchor tap).
    function setThreadMark(threadId, on) {
      document
        .querySelectorAll('[data-comment-id].thread-mark-active')
        .forEach((el) => el.classList.remove('thread-mark-active', ...MARK_ACTIVE_CLASSES));
      if (!on || !threadId) return;
      document.querySelectorAll(markSelector(threadId)).forEach((el) => {
        el.classList.add('thread-mark-active', ...MARK_ACTIVE_CLASSES);
      });
    }

    function setActive(threadId) {
      commentStore.setActiveThread?.(threadId);
    }

    // Tapping the quote jumps to the text. On small screens the sheet covers the
    // note, so close it to reveal the highlighted passage.
    function goToAnchor(thread) {
      setActive(thread.id);
      setThreadMark(thread.id, true);
      document
        .querySelector(markSelector(thread.id))
        ?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      if (isModal.value) requestClose();
    }

    // Selecting a mark in the editor makes its card visible in the panel.
    watch(activeThreadId, (id) => {
      if (!id) return;
      nextTick(() => {
        listEl.value
          ?.querySelector(`[data-thread-id="${id}"]`)
          ?.scrollIntoView({ block: 'nearest' });
      });
    });

    // ---- Formatting -------------------------------------------------------
    function formatRelative(dateStr) {
      if (!dateStr) return '';
      const d = new Date(dateStr);
      const mins = Math.floor((Date.now() - d.getTime()) / 60000);
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

    function escapeHtml(s) {
      return String(s ?? '').replace(/[&<>"']/g, (c) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      }[c]));
    }

    function formatBody(content) {
      return escapeHtml(content).replace(
        /@([\w.-]+)/g,
        '<span class="bg-primary/10 text-primary font-semibold rounded-full px-1">@$1</span>'
      );
    }

    // ---- Mentions ---------------------------------------------------------
    function collaboratorNames() {
      try {
        return useCollaboratorStore().usernames || [];
      } catch {
        // No pinia in unit tests: suggestions simply stay empty.
        return [];
      }
    }

    // Trailing @token only.
    const mentionSuggestions = computed(() => {
      const m = newComment.value.match(/@([\w.-]*)$/);
      if (!m) return [];
      const q = m[1].toLowerCase();
      return collaboratorNames()
        .filter(
          (u) =>
            (u.username || '').toLowerCase().startsWith(q) ||
            (u.label || '').toLowerCase().startsWith(q)
        )
        .slice(0, 5);
    });

    function insertMention(u) {
      const name = u.username || u.label;
      if (!name) return;
      newComment.value = newComment.value.replace(/@[\w.-]*$/, `@${name} `);
      nextTick(() => {
        composerEl.value?.focus();
        autosize(composerEl.value);
      });
    }

    // ---- Composer ---------------------------------------------------------
    function autosize(el) {
      if (!el) return;
      el.style.height = 'auto';
      el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
    }

    // Shrink back after a send / clear.
    watch(newComment, (v) => {
      if (!v) nextTick(() => autosize(composerEl.value));
    });

    // Enter sends on desktop. On touch keyboards Enter is a newline and the
    // send button submits, which is what people expect from a phone.
    function isSendKey(e) {
      return (
        e.key === 'Enter' &&
        !e.shiftKey &&
        !e.isComposing &&
        !isModal.value
      );
    }

    function onComposerKey(e) {
      if (!isSendKey(e)) return;
      e.preventDefault();
      submitComment();
    }

    function onEditKey(e) {
      if (e.key === 'Escape') {
        cancelEdit();
        return;
      }
      if (!isSendKey(e)) return;
      e.preventDefault();
      saveEdit();
    }

    function onReplyKey(e, threadId) {
      // Reply is a single-line field, so Enter always sends (unless composing).
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        submitReply(threadId);
      } else if (e.key === 'Escape') {
        replyOpenId.value = null;
      }
    }

    function replyRef(threadId) {
      return (el) => {
        if (el) replyInputEls[threadId] = el;
        else delete replyInputEls[threadId];
      };
    }

    function toggleReply(threadId) {
      if (replyOpenId.value === threadId) {
        replyOpenId.value = null;
        return;
      }
      replyOpenId.value = threadId;
      setActive(threadId);
      nextTick(() => {
        replyInputEls[threadId]?.focus();
        listEl.value
          ?.querySelector(`[data-thread-id="${threadId}"]`)
          ?.scrollIntoView({ block: 'nearest' });
      });
    }

    // ---- Editing ----------------------------------------------------------
    function canEdit(comment) {
      return !!myId.value && !!comment.authorId && comment.authorId === myId.value;
    }

    function startEdit(comment) {
      editingId.value = comment.id;
      editDraft.value = comment.content || '';
      actionError.value = '';
    }

    function cancelEdit() {
      editingId.value = null;
      editDraft.value = '';
    }

    // A failed action must be visible, never console-only.
    function reportActionError(err, fallback) {
      actionError.value = err?.message || fallback;
    }

    async function saveEdit() {
      const id = editingId.value;
      const content = editDraft.value.trim();
      if (!id || !content) return;
      actionError.value = '';
      try {
        await commentStore.editComment(id, content, { baseUrl: accountStore.serverUrl });
        editingId.value = null;
        editDraft.value = '';
      } catch (err) {
        reportActionError(err, 'Could not save your edit.');
      }
    }

    // ---- Actions ----------------------------------------------------------
    function onToggleReaction(commentId, emoji) {
      commentStore
        .toggleReaction(commentId, emoji, { baseUrl: accountStore.serverUrl })
        .then(() => triggerSelectionHaptic())
        .catch((err) => reportActionError(err, 'Could not update the reaction.'));
    }

    async function submitComment() {
      const content = newComment.value.trim();
      // Enter bypasses the button's :disabled binding, so say why nothing sent.
      if (!content) {
        actionError.value = 'Enter a comment before sending.';
        return;
      }
      actionError.value = '';
      try {
        await commentStore.addComment(props.noteId, {
          content,
          baseUrl: accountStore.serverUrl,
        });
        newComment.value = '';
        triggerSelectionHaptic();
        // New thread lands at the top of the open list.
        nextTick(() => listEl.value?.scrollTo?.({ top: 0, behavior: 'smooth' }));
      } catch (err) {
        reportActionError(err, 'Could not send your comment.');
        console.error('[comment] Failed to add comment:', err);
      }
    }

    async function submitReply(threadId) {
      const content = replyInputs[threadId]?.trim();
      if (!content) return;
      actionError.value = '';
      try {
        await commentStore.addComment(props.noteId, {
          content,
          threadId,
          parentId: threadId,
          baseUrl: accountStore.serverUrl,
        });
        replyInputs[threadId] = '';
        replyOpenId.value = null;
        triggerSelectionHaptic();
      } catch (err) {
        reportActionError(err, 'Could not send your reply.');
        console.error('[comment] Failed to reply:', err);
      }
    }

    // Decorative: mounts without pinia (specs) fall back to no toast.
    function pushResolveToast({ title, undo }) {
      try {
        useToastStore().push({ title, undo });
        return true;
      } catch {
        return false;
      }
    }

    async function toggleResolve(threadId) {
      actionError.value = '';
      const wasResolved = resolvedThreads.value.some((t) => t.id === threadId);
      try {
        await commentStore.toggleResolve(threadId, { baseUrl: accountStore.serverUrl });
        triggerSelectionHaptic();
        if (replyOpenId.value === threadId) replyOpenId.value = null;
        pushResolveToast({
          title: wasResolved
            ? translationsComments.value.threadReopened
            : translationsComments.value.threadResolved,
          undo: () => toggleResolve(threadId),
        });
      } catch (err) {
        reportActionError(err, 'Could not update the thread.');
        console.error('[comment] Failed to toggle resolve:', err);
      }
    }

    async function deleteComment(commentId) {
      if (!commentId) return;
      actionError.value = '';
      try {
        await commentStore.removeComment(commentId, { baseUrl: accountStore.serverUrl });
      } catch (err) {
        reportActionError(err, 'Could not delete the comment.');
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
      // shell
      isModal,
      shellRef,
      requestClose,
      shellAttrs,
      shellListeners,
      bodyClass,
      iconBtn,
      smallIconBtn,
      translationsComments,
      // data
      loading,
      unavailable,
      activeThreadId,
      totalThreads,
      filters,
      activeFilter,
      visibleThreads,
      emptyState,
      isResolved,
      meName,
      myId,
      // refs
      listEl,
      composerEl,
      // state
      newComment,
      replyInputs,
      replyOpenId,
      actionError,
      editingId,
      editDraft,
      mentionSuggestions,
      // helpers
      threadSnippet,
      setThreadMark,
      goToAnchor,
      formatRelative,
      fullDate,
      formatBody,
      autosize,
      insertMention,
      replyRef,
      toggleReply,
      canEdit,
      startEdit,
      cancelEdit,
      saveEdit,
      onToggleReaction,
      onComposerKey,
      onEditKey,
      onReplyKey,
      submitComment,
      submitReply,
      toggleResolve,
      deleteComment,
    };
  },
};
</script>

<style>
@keyframes comments-in-card {
  from {
    opacity: 0;
    transform: translateX(8px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}
.comments-enter-card {
  animation: comments-in-card 220ms var(--ease-standard);
}
@media (prefers-reduced-motion: reduce) {
  .comments-enter-card {
    animation-duration: 0.01ms;
  }
}
</style>
