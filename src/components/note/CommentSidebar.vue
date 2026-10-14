<template>
  <transition :name="docked ? 'slide-right-docked' : 'slide-right'">
    <div
      data-testid="comments-panel"
      :class="panelClass"
    >
      <!-- Collapsed rail: AppSidebar-style icon column with tooltips -->
      <div v-if="docked && collapsed" class="flex h-full flex-col items-center gap-1 py-3">
        <button
          v-tooltip:right="'Expand comments'"
          aria-label="Expand comments"
          class="w-9 h-9 grid place-items-center rounded-xl text-neutral-400 hover:text-neutral-900 hover:bg-neutral-100 dark:hover:text-neutral-100 dark:hover:bg-neutral-800 transition-colors focus-visible:ring-2 focus-visible:ring-secondary focus-visible:outline-none"
          @click="collapsed = false"
        >
          <v-remixicon name="riSideBarLine" size="20" />
        </button>
        <button
          v-tooltip:right="totalThreads ? `${totalThreads} comment threads` : 'No comment threads'"
          aria-label="Show comment threads"
          class="relative w-9 h-9 grid place-items-center rounded-xl text-neutral-500 hover:text-neutral-900 hover:bg-neutral-100 dark:hover:text-neutral-100 dark:hover:bg-neutral-800 transition-colors focus-visible:ring-2 focus-visible:ring-secondary focus-visible:outline-none"
          @click="collapsed = false"
        >
          <v-remixicon name="riChat3Line" size="20" />
          <span
            v-if="totalThreads"
            class="absolute top-0.5 ltr:right-0.5 rtl:left-0.5 min-w-[16px] h-4 px-1 rounded-full bg-primary text-white text-[10px] font-semibold grid place-items-center tabular-nums"
          >
            {{ totalThreads }}
          </span>
        </button>
        <div class="my-1 h-px w-8 bg-neutral-200 dark:bg-neutral-800" />
        <button
          v-for="t in railThreads"
          :key="t.id"
          v-tooltip:right="railLabel(t)"
          :aria-label="railLabel(t)"
          class="rounded-full transition hover:ring-2 hover:ring-primary/30"
          :class="t.id === activeThreadId ? 'ring-2 ring-primary/40' : ''"
          @click="openFromRail(t.id)"
        >
          <ui-user-avatar :name="t.comments[0]?.authorName || '?'" :size="26" />
        </button>
        <div class="flex-1" />
        <button
          aria-label="Close comments"
          class="w-9 h-9 grid place-items-center rounded-xl text-neutral-400 hover:text-neutral-900 hover:bg-neutral-100 dark:hover:text-neutral-100 dark:hover:bg-neutral-800 transition-colors focus-visible:ring-2 focus-visible:ring-secondary focus-visible:outline-none"
          @click="$emit('close')"
        >
          <v-remixicon name="riCloseLine" size="18" />
        </button>
      </div>

      <template v-else>
        <div
          v-if="isSheet"
          class="shrink-0 pt-2 pb-1 flex justify-center cursor-grab active:cursor-grabbing touch-none"
          aria-hidden="true"
          @click="$emit('close')"
        >
          <span class="h-1 w-9 rounded-full bg-neutral-300 dark:bg-neutral-700" />
        </div>
        <div
          class="shrink-0 flex items-center gap-2 px-3 h-[52px] bg-white dark:bg-neutral-900 border-b border-neutral-200 dark:border-neutral-800"
        >
          <button
            v-if="docked"
            v-tooltip:bottom="collapsed ? 'Expand comments' : 'Collapse comments'"
            :aria-label="collapsed ? 'Expand comments' : 'Collapse comments'"
            class="shrink-0 w-7 h-7 grid place-items-center rounded-lg text-neutral-400 hover:text-neutral-900 hover:bg-neutral-100 dark:hover:text-neutral-100 dark:hover:bg-neutral-800 transition-colors focus-visible:ring-2 focus-visible:ring-secondary focus-visible:outline-none"
            @click="collapsed = !collapsed"
          >
            <v-remixicon name="riSideBarLine" size="17" :class="collapsed ? '' : 'rotate-180'" />
          </button>
          <div class="w-7 h-7 rounded-lg bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 flex items-center justify-center shrink-0">
            <v-remixicon name="riChat3Line" size="15" />
          </div>
          <h3 class="text-[13px] font-semibold tracking-tight text-neutral-900 dark:text-neutral-100 truncate">
            {{ translationsComments.title || 'Comments' }}
          </h3>
          <span
            v-if="totalThreads"
            class="shrink-0 inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-neutral-100 dark:bg-neutral-800 text-xs font-medium text-neutral-600 dark:text-neutral-400 tabular-nums"
          >
            {{ totalThreads }}
          </span>
          <button
            class="ltr:ml-auto rtl:mr-auto shrink-0 w-7 h-7 grid place-items-center rounded-lg text-neutral-400 hover:text-neutral-900 hover:bg-neutral-100 dark:hover:text-neutral-100 dark:hover:bg-neutral-800 transition-colors focus-visible:ring-2 focus-visible:ring-secondary focus-visible:outline-none"
            aria-label="Close comments"
            @click="$emit('close')"
          >
            <v-remixicon name="riCloseLine" size="18" />
          </button>
        </div>

        <div
          class="shrink-0 px-3 pt-2"
          role="tablist"
          aria-label="Filter comment threads"
        >
          <div class="flex items-center gap-0.5 p-0.5 rounded-xl bg-neutral-100 dark:bg-neutral-800">
            <button
              v-for="f in filters"
              :key="f.id"
              role="tab"
              :aria-selected="activeFilter === f.id ? 'true' : 'false'"
              class="flex-1 px-2.5 h-8 rounded-lg text-[12px] font-medium transition focus-visible:ring-2 focus-visible:ring-secondary focus-visible:outline-none mobile:h-10"
              :class="activeFilter === f.id
                ? 'bg-white dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100 shadow-sm'
                : 'text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100'"
              @click="activeFilter = f.id"
            >
              {{ f.label }} <span class="tabular-nums opacity-70">{{ f.count }}</span>
            </button>
          </div>
        </div>

        <div class="flex-1 overflow-y-auto overscroll-contain">
          <p
            v-if="actionError"
            data-testid="comment-action-error"
            role="alert"
            class="m-3 rounded-lg bg-red-50 dark:bg-red-900/20 px-3 py-2 text-xs text-red-600 dark:text-red-400"
          >
            {{ actionError }}
          </p>

          <div v-if="loading" data-testid="comment-loading" class="py-16 flex flex-col items-center gap-3 text-neutral-400">
            <ui-spinner size="20" color="text-neutral-400" />
            <span class="text-xs">Loading threads…</span>
          </div>

          <div
            v-else-if="unavailable"
            data-testid="comments-unavailable"
            class="px-6 py-14 flex flex-col items-center text-center"
          >
            <div class="w-10 h-10 rounded-xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 grid place-items-center text-neutral-400 mb-3">
              <v-remixicon name="riChat3Line" size="20" />
            </div>
            <p class="text-[13px] font-medium text-neutral-900 dark:text-neutral-100">
              {{ translationsComments.unavailable || 'Comments work on shared notes' }}
            </p>
            <p class="text-xs text-neutral-500 dark:text-neutral-400 mt-1 max-w-[26ch] leading-relaxed">
              {{ translationsComments.unavailableHint || 'Invite someone to this note to turn comments on.' }}
            </p>
          </div>

          <template v-else>
            <div v-if="visibleUnresolved.length" class="p-3 space-y-3">
              <ui-card
                v-for="thread in visibleUnresolved"
                :key="thread.id"
                data-testid="comment-thread"
                :data-thread-id="thread.id"
                hover
                padding="p-0"
                radius="rounded-xl"
                bg="bg-white dark:bg-neutral-900"
                class="group border-neutral-200 dark:border-neutral-800"
                :class="thread.id === activeThreadId
                  ? '!border-primary/30 ring-1 ring-primary/15 shadow-sm'
                  : ''"
                @mouseenter="setThreadMark(thread.id, true)"
                @mouseleave="setThreadMark(thread.id, false)"
              >
                <div v-if="thread.anchorFrom !== null && thread.anchorFrom !== undefined" class="px-3 pt-2.5">
                  <ui-pill :fixed="false" class="!shadow-none">
                    <button
                      class="flex items-center gap-1 text-xs text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100 transition-colors focus-visible:ring-2 focus-visible:ring-secondary focus-visible:outline-none rounded"
                      :title="`Attached to text at offset ${thread.anchorFrom}–${thread.anchorTo}`"
                      @click="setActive(thread.id)"
                    >
                      <v-remixicon name="riLink" size="12" />
                      {{ threadSnippet(thread) }}
                    </button>
                  </ui-pill>
                </div>

                <div class="divide-y divide-neutral-100 dark:divide-neutral-800">
                  <div
                    v-for="(comment, ci) in thread.comments"
                    :key="comment.id"
                    class="px-3.5 py-3"
                    :class="{ 'bg-neutral-50/60 dark:bg-neutral-800/40': ci > 0 }"
                  >
                    <div class="flex gap-2.5">
                      <ui-user-avatar :name="comment.authorName || '?'" :size="24" />
                      <div class="flex-1 min-w-0">
                        <div class="flex items-baseline gap-1.5 flex-wrap">
                          <span data-testid="comment-author" class="text-[13px] font-medium text-neutral-900 dark:text-neutral-100 truncate">
                            {{ comment.authorName }}
                          </span>
                          <span class="text-xs text-neutral-400">·</span>
                          <span
                            class="text-xs text-neutral-500 dark:text-neutral-400 tabular-nums"
                            :title="fullDate(comment.createdAt)"
                          >
                            {{ formatRelative(comment.createdAt) }}
                          </span>
                          <span class="ltr:ml-auto rtl:mr-auto ltr:-mr-1 rtl:-ml-1 flex items-center opacity-0 group-hover:opacity-100 focus-within:opacity-100">
                            <button
                              v-if="canEdit(comment)"
                              data-testid="comment-edit"
                              class="w-6 h-6 grid place-items-center rounded-md text-neutral-400 hover:text-neutral-900 hover:bg-neutral-100 dark:hover:text-neutral-100 dark:hover:bg-neutral-800 transition focus-visible:ring-2 focus-visible:ring-secondary focus-visible:outline-none"
                              :aria-label="translationsComments.edit || 'Edit'"
                              @click="startEdit(comment)"
                            >
                              <v-remixicon name="riEditLine" size="13" />
                            </button>
                            <button
                              data-testid="comment-delete"
                              class="w-6 h-6 grid place-items-center rounded-md text-neutral-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 transition focus-visible:ring-2 focus-visible:ring-secondary focus-visible:outline-none"
                              :aria-label="translationsComments.delete || 'Delete'"
                              @click="deleteComment(comment.id)"
                            >
                              <v-remixicon name="riDeleteBinLine" size="13" />
                            </button>
                          </span>
                        </div>
                        <div v-if="editingId === comment.id" class="mt-1.5">
                          <textarea
                            v-model="editDraft"
                            data-testid="comment-edit-input"
                            rows="2"
                            class="w-full resize-none text-[13px] leading-5 px-2.5 py-1.5 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 outline-none focus:bg-white dark:focus:bg-neutral-900 focus:border-neutral-300 dark:focus:border-neutral-600 transition"
                            @keydown.enter.exact.prevent="saveEdit"
                            @keydown.escape="cancelEdit"
                          />
                          <div class="flex gap-1.5 mt-1.5">
                            <ui-button variant="primary" data-testid="comment-edit-save" @click="saveEdit">
                              {{ translationsComments.save || 'Save' }}
                            </ui-button>
                            <ui-button @click="cancelEdit">
                              {{ translationsComments.cancel || 'Cancel' }}
                            </ui-button>
                          </div>
                        </div>
                        <p
                          v-else
                          data-testid="comment-body"
                          class="mt-1 text-[13.5px] leading-[1.55] text-neutral-700 dark:text-neutral-300 whitespace-pre-wrap break-words"
                          v-html="formatBody(comment.content)"
                        />
                        <reaction-bar
                          class="mt-1.5"
                          :reactions="comment.reactions"
                          :my-id="myId"
                          :aria-label="translationsComments.addReaction || 'Add reaction'"
                          @toggle="(emoji) => onToggleReaction(comment.id, emoji)"
                        />
                      </div>
                    </div>
                  </div>
                </div>

                <div class="flex items-center gap-1 px-3 py-2 bg-neutral-50/80 dark:bg-neutral-900 border-t border-neutral-100 dark:border-neutral-800">
                  <button
                    class="inline-flex items-center gap-1.5 text-[12px] font-medium px-2.5 py-1 rounded-full bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-700 transition focus-visible:ring-2 focus-visible:ring-secondary focus-visible:outline-none mobile:min-h-11 mobile:px-3.5"
                    @click="toggleResolve(thread.id)"
                  >
                    <v-remixicon name="riCheckLine" size="13" class="text-primary" />
                    {{ translationsComments.resolve || 'Resolve' }}
                  </button>
                  <button
                    class="inline-flex items-center gap-1.5 text-[12px] font-medium px-2.5 py-1 rounded-full text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition focus-visible:ring-2 focus-visible:ring-secondary focus-visible:outline-none mobile:min-h-11 mobile:px-3.5"
                    @click="focusReply(thread.id)"
                  >
                    <v-remixicon name="riArrowGoBackLine" size="13" />
                    {{ translationsComments.reply || 'Reply' }}
                  </button>
                  <span class="ltr:ml-auto rtl:mr-auto text-xs text-neutral-400 hidden group-hover:inline">{{ thread.comments.length }} {{ thread.comments.length === 1 ? (translationsComments.comment || 'comment') : (translationsComments.comments || 'comments') }}</span>
                </div>

                <div class="px-3 py-2.5 bg-white dark:bg-neutral-900 border-t border-neutral-100 dark:border-neutral-800">
                  <div class="flex gap-2 items-center">
                    <ui-user-avatar :name="meName" :size="24" />
                    <ui-input
                      v-model="replyInputs[thread.id]"
                      :ref="replyRef(thread.id)"
                      :placeholder="translationsComments.replyPlaceholder || 'Reply...'"
                      class="flex-1"
                      @keydown="onReplyKey($event, thread.id)"
                    >
                      <template #append>
                        <button
                          class="w-6 h-6 grid place-items-center rounded-full bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 hover:opacity-90 disabled:opacity-30 disabled:pointer-events-none transition focus-visible:ring-2 focus-visible:ring-secondary focus-visible:outline-none"
                          :disabled="!replyInputs[thread.id]?.trim()"
                          data-testid="comment-reply"
                          aria-label="Reply"
                          @click="submitReply(thread.id)"
                        >
                          <v-remixicon name="riArrowUpLine" size="13" />
                        </button>
                      </template>
                    </ui-input>
                  </div>
                </div>
              </ui-card>
            </div>

            <div v-if="showResolvedSection" class="px-3 pb-3">
              <button
                class="w-full flex items-center gap-1.5 py-2 text-[12px] font-medium text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300 transition focus-visible:ring-2 focus-visible:ring-secondary focus-visible:outline-none rounded"
                @click="showResolved = !showResolved"
              >
                <v-remixicon :name="resolvedOpen ? 'riArrowDownSLine' : 'riArrowRightSLine'" size="14" />
                {{ resolvedLabel }}
                <span class="h-px flex-1 bg-neutral-200 dark:bg-neutral-800 ltr:ml-2 rtl:mr-2" />
              </button>
              <ui-expand-collapse :open="resolvedOpen" max-open="max-h-[1200px]">
                <div class="space-y-2.5 mt-1">
                  <ui-card
                    v-for="thread in visibleResolved"
                    :key="thread.id"
                    data-testid="comment-thread"
                    :data-thread-id="thread.id"
                    padding="p-0"
                    radius="rounded-xl"
                    bg="bg-white dark:bg-neutral-900"
                    class="border-neutral-200 dark:border-neutral-800 opacity-[0.72] hover:opacity-100 transition"
                  >
                    <div class="px-3.5 py-3 space-y-3">
                      <div
                        v-for="comment in thread.comments"
                        :key="comment.id"
                        class="flex gap-2.5"
                      >
                        <ui-user-avatar :name="comment.authorName || '?'" :size="24" />
                        <div class="flex-1 min-w-0">
                          <div class="flex items-baseline gap-1.5">
                            <span class="text-[13px] font-medium text-neutral-900 dark:text-neutral-100">{{ comment.authorName }}</span>
                            <span class="text-xs text-neutral-500" :title="fullDate(comment.createdAt)">{{ formatRelative(comment.createdAt) }}</span>
                          </div>
                          <p
                            class="mt-0.5 text-[13px] leading-[1.5] text-neutral-600 dark:text-neutral-400 whitespace-pre-wrap break-words"
                            v-html="formatBody(comment.content)"
                          />
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
                  </ui-card>
                </div>
              </ui-expand-collapse>
            </div>

            <div
              v-if="!hasVisible"
              class="px-6 py-14 flex flex-col items-center text-center"
            >
              <div class="w-10 h-10 rounded-xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 grid place-items-center text-neutral-400 mb-3">
                <v-remixicon name="riChatSmile3Line" size="20" />
              </div>
              <p class="text-[13px] font-medium text-neutral-900 dark:text-neutral-100">{{ translationsComments.empty || 'No comments yet' }}</p>
              <p class="text-xs text-neutral-500 dark:text-neutral-400 mt-1 max-w-[22ch] leading-relaxed">
                {{ translationsComments.emptyHint || 'Select text in the note and add a comment. Threads appear here.' }}
              </p>
            </div>
          </template>
        </div>

        <div
          v-if="!unavailable"
          class="shrink-0 p-3 bg-white dark:bg-neutral-900 border-t border-neutral-200 dark:border-neutral-800"
        >
          <div v-if="mentionSuggestions.length" class="mb-2 flex flex-wrap gap-1" role="listbox" aria-label="Mention suggestions">
            <button
              v-for="u in mentionSuggestions"
              :key="u.id"
              role="option"
              class="inline-flex items-center gap-1.5 pl-1 pr-2 py-1 rounded-full bg-neutral-100 dark:bg-neutral-800 text-xs text-neutral-700 dark:text-neutral-300 hover:bg-neutral-200 dark:hover:bg-neutral-700 transition"
              @click="insertMention(u)"
            >
              <ui-user-avatar :name="u.username || u.label || '?'" :size="16" />
              @{{ u.username || u.label }}
            </button>
          </div>
          <div class="flex gap-2.5 items-end">
            <ui-user-avatar :name="meName" :size="28" class="hidden sm:inline-flex" />
            <div class="flex-1 relative">
              <textarea
                ref="composerEl"
                v-model="newComment"
                data-testid="comment-input"
                :placeholder="translationsComments.placeholder || 'Add a comment...'"
                rows="1"
                class="w-full resize-none min-h-[40px] max-h-[96px] text-[13.5px] leading-5 pr-10 pl-3.5 py-2.5 rounded-xl border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 placeholder:text-neutral-400 outline-none focus:bg-white dark:focus:bg-neutral-900 focus:border-neutral-300 dark:focus:border-neutral-600 focus:ring-2 focus:ring-primary/10 transition"
                @keydown.enter.exact.prevent="submitComment"
              />
              <ui-button
                circle
                icon
                variant="primary"
                class="!h-7 !w-7 !min-h-0 !p-0 absolute ltr:right-1.5 rtl:left-1.5 top-1/2 -translate-y-1/2"
                :disabled="!newComment.trim()"
                data-testid="comment-submit"
                aria-label="Send comment"
                @click="submitComment"
              >
                <v-remixicon name="riSendPlaneFill" size="14" />
              </ui-button>
            </div>
          </div>
          <p class="hidden sm:block text-xs text-neutral-400 mt-1.5 ltr:ml-9 rtl:mr-9">{{ translationsComments.keyboardHint || '↵ to send · ⇧↵ for new line · @ to mention' }}</p>
        </div>
      </template>
    </div>
  </transition>
</template>

<script>
import { ref, reactive, computed, watch, nextTick, onMounted, onUnmounted } from 'vue';
import { useCommentStore } from '@/store/comment';
import { useTranslations } from '@/composable/useTranslations';
import { useAccountStore } from '@/store/account';
import { useCollaboratorStore } from '@/store/collaborator';
import ReactionBar from '@/components/note/ReactionBar.vue';

// Literals kept in source so Tailwind emits the utilities used on external
// note marks (highlighting a thread card's anchor in the editor DOM).
const MARK_ACTIVE_CLASSES = ['outline-primary', 'outline-2', 'outline-offset-2'];

export default {
  components: { ReactionBar },
  props: {
    noteId: { type: String, required: true },
    docked: { type: Boolean, default: false },
    // Optional tiptap editor — used only to derive quote snippets from anchors.
    editor: { type: Object, default: null },
  },
  emits: ['close'],
  setup(props) {
    const commentStore = useCommentStore();
    const accountStore = useAccountStore();
    const { translations } = useTranslations();

    const newComment = ref('');
    const replyInputs = reactive({});
    const showResolved = ref(false);
    const actionError = ref('');
    // AppSidebar-style collapse (docked only) + Open/Resolved/All filter.
    const collapsed = ref(false);
    const activeFilter = ref('open');
    // Inline edit for own comments (wires the store's editComment, unused until now).
    const editingId = ref(null);
    const editDraft = ref('');
    const composerEl = ref(null);
    const replyInputEls = {};
    // Under 768px the non-docked panel is a bottom sheet (mirrors ui-modal).
    const narrowQuery = typeof window !== 'undefined'
      ? window.matchMedia('(max-width: 767px)')
      : null;
    const isNarrow = ref(narrowQuery?.matches || false);
    function onNarrowChange(e) {
      isNarrow.value = e.matches;
    }
    onMounted(() => narrowQuery?.addEventListener?.('change', onNarrowChange));
    onUnmounted(() => narrowQuery?.removeEventListener?.('change', onNarrowChange));
    const isSheet = computed(() => !props.docked && isNarrow.value);
    const panelClass = computed(() => {
      if (props.docked) {
        return collapsed.value
          ? 'relative shrink-0 flex w-16 self-start sticky top-4 h-[calc(100vh-2rem)] flex-col bg-white dark:bg-neutral-950 border border-neutral-200 dark:border-neutral-800 rounded-xl shadow-sm overflow-hidden max-lg:hidden transition-[width] duration-200 ease-[var(--ease-standard)]'
          : 'relative shrink-0 flex w-[380px] max-w-[42%] self-start sticky top-4 h-[calc(100vh-2rem)] flex-col bg-white dark:bg-neutral-950 border border-neutral-200 dark:border-neutral-800 rounded-xl shadow-sm overflow-hidden max-lg:hidden transition-[width] duration-200 ease-[var(--ease-standard)]';
      }
      if (isSheet.value) {
        return 'fixed inset-x-0 bottom-0 z-50 flex w-full h-[76dvh] max-h-[85dvh] flex-col bg-white dark:bg-neutral-950 border-t border-neutral-200 dark:border-neutral-800 rounded-t-2xl shadow-2xl pb-[max(env(safe-area-inset-bottom),0.75rem)]';
      }
      return 'fixed inset-y-0 ltr:right-0 rtl:left-0 z-50 flex w-[380px] max-w-[92vw] flex-col bg-white dark:bg-neutral-950 ltr:border-l rtl:border-r border-neutral-200 dark:border-neutral-800 shadow-2xl';
    });

    const translationsComments = computed(() => ({
      title: translations.value.comments?.title || 'Comments',
      placeholder: translations.value.comments?.placeholder || 'Add a comment...',
      replyPlaceholder: translations.value.comments?.replyPlaceholder || 'Reply...',
      send: translations.value.comments?.send || 'Send',
      reply: translations.value.comments?.reply || 'Reply',
      resolve: translations.value.comments?.resolve || 'Resolve',
      reopen: translations.value.comments?.reopen || 'Re-open',
      edit: translations.value.comments?.edit || 'Edit',
      save: translations.value.comments?.save || 'Save',
      cancel: translations.value.comments?.cancel || 'Cancel',
      empty: translations.value.comments?.empty || 'No comments yet',
      emptyHint:
        translations.value.comments?.emptyHint ||
        'Select text in the note and add a comment. Threads appear here.',
      newComment: translations.value.comments?.newComment || 'New thread',
      delete: translations.value.comments?.delete || 'Delete',
      unavailable: translations.value.comments?.unavailable || 'Comments work on shared notes',
      unavailableHint:
        translations.value.comments?.unavailableHint ||
        'Invite someone to this note to turn comments on.',
      attachedToText: translations.value.comments?.attachedToText || 'Attached to text',
      addReaction: translations.value.comments?.addReaction || 'Add reaction',
      comment: translations.value.comments?.comment || 'comment',
      comments: translations.value.comments?.comments || 'comments',
      nResolved: translations.value.comments?.nResolved || '{n} resolved',
      keyboardHint:
        translations.value.comments?.keyboardHint ||
        '↵ to send · ⇧↵ for new line · @ to mention',
    }));

    const loading = computed(() => commentStore.loading);
    const unavailable = computed(() => commentStore.unavailable);
    const activeThreadId = computed(() => commentStore.activeThreadId);
    const unresolvedThreads = computed(() => commentStore.unresolvedThreads);
    const resolvedThreads = computed(() => commentStore.resolvedThreads);
    const totalThreads = computed(() => unresolvedThreads.value.length + resolvedThreads.value.length);
    const meName = computed(() => accountStore.profile?.username || 'Me');
    const myId = computed(() => accountStore.profile?.id || null);

    const filters = computed(() => [
      { id: 'open', label: 'Open', count: unresolvedThreads.value.length },
      { id: 'resolved', label: 'Resolved', count: resolvedThreads.value.length },
      { id: 'all', label: 'All', count: totalThreads.value },
    ]);
    const visibleUnresolved = computed(() =>
      activeFilter.value === 'resolved' ? [] : unresolvedThreads.value
    );
    const showResolvedSection = computed(
      () => activeFilter.value !== 'open' && resolvedThreads.value.length > 0
    );
    const resolvedOpen = computed(
      () => activeFilter.value === 'resolved' || showResolved.value
    );
    const visibleResolved = computed(() =>
      showResolvedSection.value ? resolvedThreads.value : []
    );
    const hasVisible = computed(
      () => visibleUnresolved.value.length + visibleResolved.value.length > 0
    );
    const railThreads = computed(() =>
      [...unresolvedThreads.value, ...resolvedThreads.value].slice(0, 6)
    );
    const resolvedLabel = computed(() =>
      (translationsComments.value.nResolved || '{n} resolved').replace(
        '{n}',
        String(resolvedThreads.value.length)
      )
    );

    // Derive a short quote from the editor doc when anchors are available;
    // fall back to the generic label (anchors live in the encrypted payload,
    // so older threads may not carry offsets into this client's editor).
    function threadSnippet(thread) {
      const from = thread.anchorFrom;
      const to = thread.anchorTo;
      const doc = props.editor?.state?.doc;
      if (from == null || to == null || !doc || typeof doc.textBetween !== 'function') {
        return translationsComments.value.attachedToText || 'Attached to text';
      }
      try {
        const text = doc.textBetween(from, to, ' ', ' ').trim();
        if (!text) return translationsComments.value.attachedToText || 'Attached to text';
        const max = 60;
        return text.length > max ? `${text.slice(0, max)}…` : text;
      } catch {
        return translationsComments.value.attachedToText || 'Attached to text';
      }
    }

    // Hovering a thread card highlights its anchor mark in the note.
    function setThreadMark(threadId, on) {
      document
        .querySelectorAll('[data-comment-id].thread-mark-active')
        .forEach((el) => el.classList.remove('thread-mark-active', ...MARK_ACTIVE_CLASSES));
      if (!on || !threadId) return;
      let selector = `[data-comment-id="${threadId}"]`;
      try {
        selector = `[data-comment-id="${CSS.escape(threadId)}"]`;
      } catch {}
      document.querySelectorAll(selector).forEach((el) => {
        el.classList.add('thread-mark-active', ...MARK_ACTIVE_CLASSES);
      });
    }

    function onToggleReaction(commentId, emoji) {
      commentStore
        .toggleReaction(commentId, emoji, { baseUrl: accountStore.serverUrl })
        .catch((err) => reportActionError(err, 'Could not update the reaction.'));
    }

    function railLabel(thread) {
      const n = thread.comments.length;
      const who = thread.comments[0]?.authorName || 'Unknown';
      return `${who} · ${n} comment${n === 1 ? '' : 's'}`;
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

    function collaboratorNames() {
      try {
        return useCollaboratorStore().usernames || [];
      } catch {
        // No pinia in unit tests: suggestions simply stay empty.
        return [];
      }
    }

    // Trailing @token only (ponytail: full caret-aware autocomplete later).
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
      nextTick(() => composerEl.value?.focus());
    }

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

    async function saveEdit() {
      const id = editingId.value;
      const content = editDraft.value.trim();
      if (!id || !content) return;
      actionError.value = '';
      try {
        await commentStore.editComment(id, content, {
          baseUrl: accountStore.serverUrl,
        });
        editingId.value = null;
        editDraft.value = '';
      } catch (err) {
        reportActionError(err, 'Could not save your edit.');
      }
    }

    function replyRef(threadId) {
      return (el) => {
        if (el) replyInputEls[threadId] = el;
        else delete replyInputEls[threadId];
      };
    }

    function focusReply(threadId) {
      const el = replyInputEls[threadId];
      if (el && el.focus) el.focus();
    }

    function onReplyKey(e, threadId) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        submitReply(threadId);
      }
    }

    function setActive(threadId) {
      commentStore.setActiveThread?.(threadId);
    }

    function openFromRail(threadId) {
      collapsed.value = false;
      setActive(threadId);
      nextTick(() => {
        document
          .querySelector(`[data-thread-id="${threadId}"]`)
          ?.scrollIntoView({ block: 'nearest' });
      });
    }

    // A failed action must be visible: the old console-only catches made a
    // rejected comment/reply/resolve look like nothing happened.
    function reportActionError(err, fallback) {
      actionError.value = err?.message || fallback;
    }

    async function submitComment() {
      const content = newComment.value.trim();
      // The button's :disabled binding lags a render tick behind the textarea,
      // and the Enter shortcut skips it entirely, so an empty submit can reach
      // here: say why instead of returning silently.
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
      } catch (err) {
        reportActionError(err, 'Could not send your reply.');
        console.error('[comment] Failed to reply:', err);
      }
    }

    async function toggleResolve(threadId) {
      actionError.value = '';
      try {
        await commentStore.toggleResolve(threadId, {
          baseUrl: accountStore.serverUrl,
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
        await commentStore.removeComment(commentId, {
          baseUrl: accountStore.serverUrl,
        });
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
      translationsComments,
      loading,
      unavailable,
      activeThreadId,
      unresolvedThreads,
      resolvedThreads,
      totalThreads,
      filters,
      activeFilter,
      visibleUnresolved,
      visibleResolved,
      showResolvedSection,
      resolvedOpen,
      resolvedLabel,
      hasVisible,
      railThreads,
      railLabel,
      collapsed,
      isSheet,
      panelClass,
      threadSnippet,
      setThreadMark,
      onToggleReaction,
      newComment,
      replyInputs,
      showResolved,
      actionError,
      accountStore,
      meName,
      myId,
      editingId,
      editDraft,
      composerEl,
      mentionSuggestions,
      insertMention,
      canEdit,
      startEdit,
      cancelEdit,
      saveEdit,
      replyRef,
      focusReply,
      onReplyKey,
      setActive,
      openFromRail,
      formatRelative,
      fullDate,
      formatBody,
      submitComment,
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
