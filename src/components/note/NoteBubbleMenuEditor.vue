<template>
  <div
    v-if="editor"
    class="bg-white dark:bg-neutral-900 border overflow-x-auto z-20 w-fit mx-auto p-1.5 rounded-xl shadow-md no-print no-scrollbar mobile:hidden tablet:hidden"
  >
    <div class="flex items-center justify-start w-max h-full gap-1">
      <ui-popover>
        <template #trigger>
          <button
            v-keep-focus
            v-tooltip.group="translations.toolbar?.turnInto || 'Turn into'"
            class="hover:bg-neutral-100 dark:hover:bg-neutral-800 h-8 px-2 rounded-lg transition-colors flex items-center gap-1.5 text-sm font-medium text-neutral-700 dark:text-neutral-300"
          >
            {{ nodeName }}
            <v-remixicon
              name="riArrowDownSLine"
              class="size-6 text-neutral-400"
            />
          </button>
        </template>

        <div>
          <ui-list class="overflow-y-auto no-scrollbar min-w-[160px] max-h-80">
            <ui-list-item
              v-for="item in menuOptions"
              :key="item.label"
              small
              class="flex items-center gap-2 hover:bg-neutral-100 dark:hover:bg-neutral-800 text-sm text-neutral-700 dark:text-neutral-300 cursor-pointer"
              @click="item.command"
            >
              <v-remixicon
                :name="item.icon"
                class="size-6 text-neutral-500"
                :class="item.className"
              />
              <span class="w-full text-left">{{ item.label }}</span>
            </ui-list-item>
          </ui-list>
        </div>
      </ui-popover>

      <span class="border-r mx-0.5 h-5" />

      <ui-popover>
        <template #trigger>
          <div
            class="flex items-center justify-between w-24 h-8 p-0.5 rounded-lg bg-neutral-50 dark:bg-neutral-900 overflow-hidden flex-shrink-0"
          >
            <button
              v-keep-focus
              type="button"
              class="w-6 h-6 flex items-center justify-center hover:bg-neutral-200 dark:hover:bg-neutral-700 text-neutral-500 dark:text-neutral-400 focus:outline-none rounded-lg transition-colors"
              @click.stop="
                fontSize = Math.max(1, fontSize - 1);
                updateFontSize();
              "
            >
              <v-remixicon name="riSubtractLine" class="w-3.5 h-3.5" />
            </button>

            <input
              v-model.number="fontSize"
              v-tooltip.group="translations.menu.fontSize"
              type="number"
              min="1"
              class="w-8 bg-transparent text-center text-neutral-800 dark:text-white border-0 focus:outline-none text-xs font-medium [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              @change="updateFontSize"
            />

            <button
              v-keep-focus
              type="button"
              class="w-6 h-6 flex items-center justify-center hover:bg-neutral-200 dark:hover:bg-neutral-700 text-neutral-500 dark:text-neutral-400 focus:outline-none rounded-lg transition-colors"
              @click.stop="
                fontSize += 1;
                updateFontSize();
              "
            >
              <v-remixicon name="riAddLine" class="w-3.5 h-3.5" />
            </button>
          </div>
        </template>

        <div class="flex flex-col max-h-44 overflow-y-auto no-scrollbar w-24">
          <button
            v-keep-focus
            class="w-full p-1.5 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800 text-left text-xs font-medium text-neutral-700 dark:text-neutral-300 transition-colors cursor-pointer"
            @click="
              editor.chain().focus().unsetFontSize().run();
              fontSize = null;
            "
          >
            Default
          </button>

          <button
            v-for="size in [10, 12, 14, 16, 18, 20, 24, 28, 32, 36]"
            :key="size"
            v-keep-focus
            class="w-full p-1.5 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800 text-left text-xs text-neutral-600 dark:text-neutral-400 transition-colors cursor-pointer"
            @click="
              editor
                .chain()
                .focus()
                .setFontSize(size + 'pt')
                .run();
              fontSize = size;
            "
          >
            {{ size }}
          </button>
        </div>
      </ui-popover>

      <span class="border-r mx-0.5 h-5" />

      <ui-popover>
        <template #trigger>
          <button
            v-keep-focus
            v-tooltip.group="'Align'"
            class="hover:bg-neutral-100 dark:hover:bg-neutral-800 h-8 px-2 rounded-lg transition-colors flex items-center gap-1 text-neutral-600 dark:text-neutral-400"
          >
            <v-remixicon :name="currentAlignmentIcon" class="size-6" />
            <v-remixicon
              name="riArrowDownSLine"
              class="w-3.5 h-3.5 text-neutral-400"
            />
          </button>
        </template>

        <div>
          <ui-list class="overflow-y-auto no-scrollbar min-w-[140px] max-h-80">
            <ui-list-item
              v-for="item in alignmentOptions"
              :key="item.label"
              small
              :class="
                item.isActive
                  ? 'bg-neutral-100 dark:bg-neutral-900 text-neutral-900 dark:text-white font-medium'
                  : 'hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-700 dark:text-neutral-300'
              "
              class="flex items-center gap-2 cursor-pointer text-sm"
              @click="item.command"
            >
              <v-remixicon :name="item.icon" class="size-6 text-neutral-500" />
              <span class="w-full text-left">{{ item.label }}</span>
            </ui-list-item>
          </ui-list>
        </div>
      </ui-popover>

      <span class="border-r mx-0.5 h-5" />

      <template v-for="item in visibleItems" :key="item.id">
        <button
          v-if="fmtMap[item.id]"
          v-keep-focus
          v-tooltip.group="fmtMap[item.id].title"
          :class="
            activeFmt[fmtMap[item.id].state]
              ? 'bg-neutral-100 text-neutral-900 dark:bg-neutral-900 dark:text-white'
              : 'hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-600 dark:text-neutral-400'
          "
          class="h-8 w-8 rounded-lg transition-colors flex items-center justify-center"
          @click="fmtMap[item.id].run()"
        >
          <v-remixicon :name="fmtMap[item.id].icon" class="size-6" />
        </button>
      </template>

      <button
        v-if="canComment"
        v-keep-focus
        v-tooltip.group="translations.comments?.title || 'Comment'"
        data-testid="bubble-comment-trigger"
        class="h-8 w-8 rounded-lg transition-colors flex items-center justify-center hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-600 dark:text-neutral-400"
        :class="{ 'bg-neutral-100 dark:bg-neutral-800': commentPopoverOpen }"
        @click.stop="openCommentComposer"
      >
        <v-remixicon name="riChat3Line" class="size-6" />
      </button>

      <ui-popover
        v-model:model-value="linkPopoverOpen"
        @show="onLinkPopoverShow"
      >
        <template #trigger>
          <button
            v-keep-focus
            v-tooltip.group="translations.menu.link"
            :class="
              activeFmt.link
                ? 'bg-neutral-100 text-neutral-900 dark:bg-neutral-900 dark:text-white'
                : 'hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-600 dark:text-neutral-400'
            "
            class="h-8 w-8 rounded-lg transition-colors flex items-center justify-center"
          >
            <v-remixicon name="riLink" class="size-6" />
          </button>
        </template>

        <div class="min-w-[260px]">
          <div class="flex items-center gap-2">
            <input
              ref="linkInputRef"
              v-model="linkInputValue"
              type="text"
              :placeholder="
                translations.editor?.linkPlaceholder || 'Enter URL or @note'
              "
              class="flex-1 min-w-0 px-2 py-1.5 rounded-lg bg-neutral-50 dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100 placeholder-neutral-400 dark:placeholder-neutral-500 text-sm outline-none border border-transparent focus:border-primary transition-colors"
              @keydown="onLinkInputKeydown"
              @keydown.esc="closeLinkInput"
              @keyup.enter="saveLinkInput"
            />
            <button
              v-keep-focus
              class="h-7 w-7 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors flex items-center justify-center text-neutral-500"
              :title="translations.common?.cancel || 'Cancel'"
              @click="closeLinkInput"
            >
              <v-remixicon name="riCloseLine" class="size-4" />
            </button>
            <button
              v-keep-focus
              class="h-7 w-7 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors flex items-center justify-center text-primary"
              :title="translations.common?.save || 'Save'"
              :disabled="!linkInputValue.trim()"
              @click="saveLinkInput"
            >
              <v-remixicon name="riCheckLine" class="size-4" />
            </button>
          </div>

          <expand-transition>
            <div
              v-if="
                linkInputValue.startsWith('@') && linkSuggestions.length > 0
              "
              class="overflow-hidden mt-1"
            >
              <ui-list class="space-y-1 max-h-40 overflow-y-auto">
                <ui-list-item
                  v-for="(suggestion, index) in linkSuggestions"
                  :key="suggestion.id"
                  :active="index === selectedLinkIndex"
                  class="label-item w-full truncate text-sm"
                  @click="selectLinkNote(suggestion.id)"
                >
                  {{
                    suggestion.title ||
                    translations.editor?.untitledNote ||
                    'Untitled Note'
                  }}
                </ui-list-item>
              </ui-list>
            </div>
            <div
              v-else-if="
                linkInputValue.startsWith('@') && linkSuggestions.length === 0
              "
              class="mt-1 p-1.5 text-sm text-neutral-500 dark:text-neutral-400 italic"
            >
              {{
                translations.editor?.noMatchingNotes ||
                'No matching notes found'
              }}
            </div>
          </expand-transition>
        </div>
      </ui-popover>

      <ui-popover>
        <template #trigger>
          <button
            v-keep-focus
            v-tooltip.group="translations.menu.highlight"
            class="h-8 w-8 rounded-lg transition-colors flex items-center justify-center hover:bg-neutral-100 dark:hover:bg-neutral-800"
            :style="currentHighlightHex ? { backgroundColor: currentHighlightHex + '33' } : null"
          >
            <v-remixicon
              name="riFontColor"
              class="size-6"
              :style="{ color: currentTextColor || undefined }"
            />
          </button>
        </template>

        <div class="w-40">
          <p
            class="text-xs font-semibold text-neutral-400 font-bold tracking-wider mb-2"
          >
            {{ translations.menu.textColor }}
          </p>

          <div class="grid grid-cols-4 gap-1.5 mb-4 justify-items-center">
            <button
              v-keep-focus
              class="w-7 h-7 flex items-center justify-center rounded-lg border hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-600 dark:text-neutral-400 transition-colors"
              @click="editor.chain().focus().unsetColor().run()"
            >
              <v-remixicon name="riFontColor" class="w-3.5 h-3.5" />
            </button>

            <button
              v-for="c in textColors"
              :key="c"
              v-keep-focus
              class="w-7 h-7 rounded-lg border border-neutral-100 dark:border-neutral-800 hover:scale-105 active:scale-95 transition-transform flex items-center justify-center"
              :style="{ backgroundColor: c + '22' }"
              @click="setTextColor(c)"
            >
              <v-remixicon
                name="riFontColor"
                class="w-3.5 h-3.5"
                :style="{ color: c }"
              />
            </button>
          </div>

          <p
            class="text-xs font-semibold text-neutral-400 font-bold tracking-wider mb-2"
          >
            {{ translations.menu.highlighterColor }}
          </p>

          <div class="grid grid-cols-4 gap-1.5 justify-items-center">
            <button
              v-keep-focus
              class="w-7 h-7 rounded-lg border flex items-center justify-center hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-500 text-xs font-medium transition-colors"
              @click="editor.commands.unsetHighlight()"
            >
              -
            </button>

            <button
              v-for="c in highlighterColors"
              :key="c"
              v-keep-focus
              :class="[
                'w-7 h-7 rounded-lg hover:scale-105 active:scale-95 transition-transform shadow-sm border border-black/5',
                c,
              ]"
              @click="setHighlightColor(c)"
            />
          </div>
        </div>
      </ui-popover>
    </div>
  </div>

  <!-- Comment composer card: anchored under the selected text, not the toolbar. -->
  <teleport to="body">
    <div
      v-if="commentPopoverOpen"
      ref="commentCardRef"
      :style="commentCardStyles"
      class="fixed z-[60] w-[360px] max-w-[90vw] motion-spring-enter"
      @keydown.esc.stop.prevent="closeCommentInput()"
    >
      <div
        class="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 shadow-xl overflow-hidden"
      >
        <div class="flex items-center gap-2 px-3 pt-3">
          <ui-user-avatar :name="commentAuthor" :size="24" />
          <span
            class="text-[13px] font-semibold text-neutral-900 dark:text-neutral-100 truncate"
          >
            {{ commentAuthor }}
          </span>
          <span class="shrink-0 text-xs text-neutral-400">
            {{ translations.common?.justNow || 'Just now' }}
          </span>
          <button
            type="button"
            class="ltr:ml-auto rtl:mr-auto shrink-0 w-6 h-6 grid place-items-center rounded-md text-neutral-400 hover:text-neutral-900 hover:bg-neutral-100 dark:hover:text-neutral-100 dark:hover:bg-neutral-800 transition-colors"
            :title="translations.common?.cancel || 'Cancel'"
            @click="closeCommentInput()"
          >
            <v-remixicon name="riCloseLine" size="15" />
          </button>
        </div>

        <div v-if="commentQuote" class="mt-2.5 mx-3 flex items-stretch gap-2">
          <span class="w-[3px] shrink-0 rounded-full bg-amber-400" />
          <span
            class="min-w-0 truncate text-[13px] leading-6 text-neutral-500 dark:text-neutral-400"
          >
            {{ commentQuote }}
          </span>
        </div>

        <textarea
          ref="commentInputRef"
          v-model="commentInputValue"
          :placeholder="translations.comments?.placeholder || 'Add a comment…'"
          rows="2"
          class="mt-2 w-full resize-none bg-transparent px-3 py-2 text-[14px] leading-relaxed text-neutral-900 dark:text-neutral-100 placeholder-neutral-400 dark:placeholder-neutral-500 outline-none"
          @keydown.enter.exact.prevent="saveCommentInput"
        />

        <div class="flex items-center justify-end px-3 pb-3">
          <button
            type="button"
            data-testid="comment-composer-send"
            class="shrink-0 grid place-items-center w-8 h-8 rounded-full bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 hover:opacity-90 disabled:opacity-30 disabled:pointer-events-none transition"
            :disabled="!commentInputValue.trim()"
            :aria-label="translations.common?.save || 'Save'"
            @click="saveCommentInput"
          >
            <v-remixicon name="riArrowUpLine" size="16" />
          </button>
        </div>
      </div>
    </div>
  </teleport>
</template>

<script>
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount, shallowReactive } from 'vue';
import {
  useFloating,
  offset,
  flip,
  shift,
  autoUpdate,
} from '@floating-ui/vue';
import { useNoteMenu } from '@/composable/useNoteMenu';
import { useNoteStore } from '@/store/note';
import { useCommentStore } from '@/store/comment';
import { useAccountStore } from '@/store/account';
import { useRoute } from 'vue-router';
import { useTranslations } from '@/composable/useTranslations';

export default {
  props: {
    editor: { type: Object, default: null },
    id: { type: String, default: '' },
    note: { type: Object, required: true },
  },
  setup(props) {
    const menu = useNoteMenu(props);
    const route = useRoute();
    const noteStore = useNoteStore();
    const commentStore = useCommentStore();
    const accountStore = useAccountStore();
    const { translations } = useTranslations();

    const canComment = computed(() => {
      const { editor } = props;
      if (!editor) return false;
      if (!accountStore.isAuthenticated) return false;
      const { from, to } = editor.state.selection;
      return from !== to;
    });

    const commentInputValue = ref('');
    const commentInputRef = ref(null);
    const commentPopoverOpen = ref(false);
    const commentRange = ref({ from: 0, to: 0 });
    const commentCardRef = ref(null);
    const commentAnchor = ref(null);

    const { floatingStyles: commentCardStyles } = useFloating(
      commentAnchor,
      commentCardRef,
      {
        placement: 'bottom-start',
        strategy: 'fixed',
        transform: false,
        middleware: [offset(8), flip(), shift({ padding: 12 })],
        whileElementsMounted: autoUpdate,
      },
    );

    const commentAuthor = computed(
      () => accountStore.profile?.username || 'You',
    );

    const commentQuote = computed(() => {
      const { editor } = props;
      const { from, to } = commentRange.value;
      if (!editor || from === to) return '';
      try {
        return editor.state.doc.textBetween(from, to, ' ').trim();
      } catch {
        return '';
      }
    });

    // Live rect so the card stays glued to the selection while scrolling;
    // coordsAtPos throws if a remote edit moves the doc out from under it.
    let lastSelectionRect = null;
    function selectionRect() {
      const { editor } = props;
      const { from, to } = commentRange.value;
      try {
        const start = editor.view.coordsAtPos(from);
        const end = editor.view.coordsAtPos(to);
        const left = Math.min(start.left, end.left);
        const right = Math.max(start.right, end.right);
        lastSelectionRect = {
          x: left,
          y: start.top,
          width: Math.max(right - left, 1),
          height: Math.max(start.bottom - start.top, 1),
          top: start.top,
          bottom: start.bottom,
          left,
          right,
        };
      } catch {
        // keep the last known position
      }
      return (
        lastSelectionRect || {
          x: 0,
          y: 0,
          width: 0,
          height: 0,
          top: 0,
          bottom: 0,
          left: 0,
          right: 0,
        }
      );
    }

    function openCommentComposer() {
      const { editor } = props;
      if (!editor) return;
      if (commentPopoverOpen.value) {
        closeCommentInput({ refocus: false });
        return;
      }
      const { from, to } = editor.state.selection;
      if (from === to) return;
      commentRange.value = { from, to };
      lastSelectionRect = null;
      commentAnchor.value = {
        contextElement: editor.view.dom,
        getBoundingClientRect: selectionRect,
      };
      commentInputValue.value = '';
      commentPopoverOpen.value = true;
      nextTick(() => commentInputRef.value?.focus());
    }

    async function saveCommentInput() {
      const content = commentInputValue.value.trim();
      const { editor } = props;
      const { from, to } = commentRange.value;
      if (!content || !editor || from === to) return;
      const threadId = crypto.randomUUID();
      editor
        .chain()
        .focus()
        .setTextSelection({ from, to })
        .setComment(threadId)
        .run();
      closeCommentInput({ refocus: false });
      try {
        await commentStore.addComment(props.note.id, {
          content,
          threadId,
          anchorFrom: from,
          anchorTo: to,
        });
      } catch (err) {
        console.warn('[comment] Failed to add comment:', err);
      }
    }

    function closeCommentInput({ refocus = true } = {}) {
      commentInputValue.value = '';
      commentPopoverOpen.value = false;
      commentAnchor.value = null;
      if (refocus) props.editor?.commands?.focus();
    }

    // Click anywhere outside the card dismisses it without stealing focus.
    function onDocumentMouseDown(event) {
      if (!commentPopoverOpen.value) return;
      if (commentCardRef.value?.contains(event.target)) return;
      if (event.target.closest?.('[data-testid="bubble-comment-trigger"]')) {
        return;
      }
      closeCommentInput({ refocus: false });
    }
    onMounted(() =>
      document.addEventListener('mousedown', onDocumentMouseDown, true),
    );
    onBeforeUnmount(() =>
      document.removeEventListener('mousedown', onDocumentMouseDown, true),
    );

    const linkInputValue = ref('');
    const linkInputRef = ref(null);
    const selectedLinkIndex = ref(0);
    const linkPopoverOpen = ref(false);

    function onLinkPopoverShow() {
      linkInputValue.value = '';
      selectedLinkIndex.value = 0;
      nextTick(() => linkInputRef.value?.focus());
    }

    const linkSuggestions = computed(() => {
      if (!linkInputValue.value.startsWith('@')) return [];
      const query = linkInputValue.value.substring(1).toLowerCase();
      if (!query) return [];
      const candidates =
        noteStore.notes.length > 200
          ? noteStore.notes.slice(0, 200)
          : noteStore.notes;
      return candidates
        .filter(
          (n) =>
            n.id !== route.params.id &&
            (n.title.toLowerCase().includes(query) ||
              n.id.toLowerCase().includes(query)),
        )
        .slice(0, 6);
    });

    function resolveNoteFromQuery(value) {
      const query = value.substring(1).trim();
      if (!query) return null;
      return (
        noteStore.notes.find(
          (n) => n.title.toLowerCase() === query.toLowerCase(),
        ) || noteStore.notes.find((n) => n.id === query)
      );
    }

    function saveLinkInput() {
      const value = linkInputValue.value.trim();
      if (!value || !props.editor) return;

      const chain = props.editor.chain().focus();

      if (value.startsWith('@')) {
        const note = resolveNoteFromQuery(value);
        if (note) {
          chain.insertLinkNote(note.id).run();
        }
      } else {
        chain.setLink({ href: value }).run();
      }

      linkInputValue.value = '';
      linkPopoverOpen.value = false;
    }

    function closeLinkInput() {
      linkInputValue.value = '';
      linkPopoverOpen.value = false;
      props.editor?.commands?.focus();
    }

    function selectLinkNote(id) {
      if (!props.editor) return;
      props.editor.chain().focus().insertLinkNote(id).run();
      linkInputValue.value = '';
      linkPopoverOpen.value = false;
    }

    function onLinkInputKeydown(event) {
      if (
        !linkInputValue.value.startsWith('@') ||
        linkSuggestions.value.length === 0
      )
        return;

      const len = linkSuggestions.value.length;

      if (event.key === 'ArrowUp') {
        event.preventDefault();
        selectedLinkIndex.value = (selectedLinkIndex.value + len - 1) % len;
      } else if (event.key === 'ArrowDown') {
        event.preventDefault();
        selectedLinkIndex.value = (selectedLinkIndex.value + 1) % len;
      } else if (event.key === 'Enter') {
        event.preventDefault();
        const note = linkSuggestions.value[selectedLinkIndex.value];
        if (note) selectLinkNote(note.id);
      }
    }

    watch(linkInputValue, (val) => {
      if (val.startsWith('@')) selectedLinkIndex.value = 0;
    });
    const t = (key) =>
      translations.value.toolbar?.[key] || translations.value.menu?.[key];
    const blockTypes = [
      {
        id: 'paragraph',
        icon: 'riParagraph',
        label: t('paragraph') || 'Text',
        cmd: (e) => e.chain().focus().setParagraph().run(),
      },
      ...[1, 2, 3, 4, 5, 6].map((level) => ({
        id: 'heading',
        level,
        icon: `riH${level}`,
        label: (t('heading') || `Heading`).replace('{level}', level),
        cmd: (e) => e.chain().focus().toggleHeading({ level }).run(),
      })),
      {
        id: 'bulletList',
        icon: 'riListUnordered',
        label: t('bulletList') || 'Bullet List',
        cmd: (e) => e.chain().focus().toggleBulletList().run(),
      },
      {
        id: 'orderedList',
        label: t('numberedList') || 'Numbered List',
        icon: 'riListOrdered',
        cmd: (e) => e.chain().focus().toggleOrderedList().run(),
      },
      {
        id: 'taskList',
        label: t('taskList') || 'Task List',
        icon: 'riListCheck2',
        cmd: (e) => e.chain().focus().toggleTaskList().run(),
      },
      {
        id: 'blockquote',
        label: t('quote') || 'Quote',
        icon: 'riDoubleQuotesR',
        cmd: (e) => e.chain().focus().toggleBlockquote().run(),
      },
      {
        id: 'codeBlock',
        label: t('codeBlock') || 'Code Block',
        icon: 'riCodeBoxLine',
        cmd: (e) => e.chain().focus().toggleCodeBlock().run(),
      },
    ];

    const alignmentTypes = [
      {
        id: 'left',
        icon: 'riAlignLeft',
        label: t('left') || 'Left',
        cmd: (e) => e.chain().focus().setTextAlign('left').run(),
      },
      {
        id: 'center',
        icon: 'riAlignCenter',
        label: t('center') || 'Center',
        cmd: (e) => e.chain().focus().setTextAlign('center').run(),
      },
      {
        id: 'right',
        icon: 'riAlignRight',
        label: t('right') || 'Right',
        cmd: (e) => e.chain().focus().setTextAlign('right').run(),
      },
      {
        id: 'justify',
        icon: 'riAlignJustify',
        label: t('justify') || 'Justify',
        cmd: (e) => e.chain().focus().setTextAlign('justify').run(),
      },
    ];

    // Cached menu active-states. Previously every render evaluated
    // editor.isActive() per button (each walking the selected range) plus
    // ~20 more calls in the nodeName/alignment computeds — after Cmd+A that
    // was dozens of full-document walks per bubble evaluation. Now: ONE
    // nodesBetween pass, computed once per selection settle (not while the
    // mouse is down), with the cursor case served O(1) from $from.marks().
    const activeFmt = shallowReactive({
      bold: false,
      italic: false,
      underline: false,
      strike: false,
      code: false,
      link: false,
    });
    const activeAlign = ref('left');
    const activeNodeLabel = ref(t('text') || 'Text');

    function recomputeMenuState() {
      const editor = props.editor;
      if (!editor || editor.isDestroyed) return;
      const state = editor.state;
      const { selection } = state;
      const { empty, from, to, $from } = selection;

      const markNames = new Set();
      const nodeNames = new Set();
      const aligns = new Set();
      const headingLevels = new Set();

      if (empty) {
        const marks = state.storedMarks || $from.marks();
        for (const m of marks) markNames.add(m.type.name);
        const parent = $from.parent;
        nodeNames.add(parent.type.name);
        const ta = parent.attrs?.textAlign;
        if (ta) aligns.add(ta);
        if (parent.type.name === 'heading') {
          headingLevels.add(parent.attrs.level);
        }
      } else {
        state.doc.nodesBetween(from, to, (node) => {
          if (node.marks) for (const m of node.marks) markNames.add(m.type.name);
          const ta = node.attrs?.textAlign;
          if (ta) aligns.add(ta);
          nodeNames.add(node.type.name);
          if (node.type.name === 'heading') headingLevels.add(node.attrs.level);
          return true;
        });
      }

      activeFmt.bold = markNames.has('bold');
      activeFmt.italic = markNames.has('italic');
      activeFmt.underline = markNames.has('underline');
      activeFmt.strike = markNames.has('strike');
      activeFmt.code = markNames.has('code');
      activeFmt.link = markNames.has('link');

      const alignMatch = alignmentTypes.find((type) => aligns.has(type.id));
      activeAlign.value = alignMatch ? alignMatch.id : 'left';

      // Same first-match ordering as the previous blockTypes.isActive loop.
      const blockMatch = blockTypes.find((type) =>
        type.level
          ? headingLevels.has(type.level)
          : nodeNames.has(type.id),
      );
      activeNodeLabel.value = blockMatch
        ? blockMatch.label
        : t('text') || 'Text';
    }

    // Recompute on settle: trailing 100ms debounce for keyboard selection and
    // typing; during pointer drag-select we skip entirely and recompute once
    // on pointerup so growing selections never pay repeated range walks.
    let menuStateTimer = 0;
    let pointerDown = false;
    let pendingWhilePointerDown = false;

    function scheduleMenuState() {
      if (pointerDown) {
        pendingWhilePointerDown = true;
        return;
      }
      if (menuStateTimer) clearTimeout(menuStateTimer);
      menuStateTimer = setTimeout(() => {
        menuStateTimer = 0;
        recomputeMenuState();
      }, 100);
    }

    function onEditorTransaction({ transaction }) {
      if (transaction.selectionSet || transaction.docChanged) {
        scheduleMenuState();
      }
    }

    function onPointerDown() {
      pointerDown = true;
    }

    function onPointerUp() {
      pointerDown = false;
      if (menuStateTimer) {
        clearTimeout(menuStateTimer);
        menuStateTimer = 0;
      }
      if (pendingWhilePointerDown) {
        pendingWhilePointerDown = false;
        recomputeMenuState();
      }
    }

    onMounted(() => {
      recomputeMenuState();
      const ed = props.editor;
      if (!ed || ed.isDestroyed) return;
      ed.on('transaction', onEditorTransaction);
      ed.view?.dom?.addEventListener('pointerdown', onPointerDown);
      // window-level pointerup: drags that end outside the editor still settle
      window.addEventListener('pointerup', onPointerUp);
    });

    onBeforeUnmount(() => {
      const ed = props.editor;
      if (ed && !ed.isDestroyed) {
        ed.off('transaction', onEditorTransaction);
        try {
          ed.view?.dom?.removeEventListener('pointerdown', onPointerDown);
        } catch { /* view already torn down */ }
      }
      window.removeEventListener('pointerup', onPointerUp);
      if (menuStateTimer) clearTimeout(menuStateTimer);
    });

    const nodeName = computed(() => activeNodeLabel.value);

    const menuOptions = computed(() => {
      return blockTypes.map((type) => ({
        label: type.label,
        command: () => type.cmd(props.editor),
        icon: type.icon,
        className: type.className || '',
      }));
    });

    const currentAlignment = computed(() => {
      const active = alignmentTypes.find((type) => type.id === activeAlign.value);
      return active ? active.label : t('left') || 'Left';
    });

    const currentAlignmentIcon = computed(() => {
      const active = alignmentTypes.find((type) => type.id === activeAlign.value);
      return active ? active.icon : 'riAlignLeft';
    });

    const alignmentOptions = computed(() => {
      return alignmentTypes.map((type) => ({
        label: type.label,
        command: () => type.cmd(props.editor),
        icon: type.icon,
        isActive: type.id === activeAlign.value,
      }));
    });

    return {
      ...menu,
      activeFmt,
      nodeName,
      menuOptions,
      currentAlignment,
      currentAlignmentIcon,
      alignmentOptions,
      canComment,
      // Comment input
      commentInputValue,
      commentInputRef,
      commentPopoverOpen,
      commentCardRef,
      commentCardStyles,
      commentAuthor,
      commentQuote,
      openCommentComposer,
      saveCommentInput,
      closeCommentInput,
      // Link input
      linkInputValue,
      linkInputRef,
      selectedLinkIndex,
      linkPopoverOpen,
      linkSuggestions,
      onLinkPopoverShow,
      onLinkInputKeydown,
      closeLinkInput,
      saveLinkInput,
      selectLinkNote,
    };
  },
};
</script>
