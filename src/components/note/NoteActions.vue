<template>
  <!-- One action set, two presentations. On a foldable it moves to the rail and
       stacks; everywhere else it stays the horizontal dock. -->
  <teleport to="#app-rail-top" :disabled="!rail">
    <div
      ref="container"
      :class="[
        rail
          ? 'rail-actions no-print flex flex-col items-center gap-1 py-1'
          : 'bg-white dark:bg-neutral-900 border overflow-x-auto w-fit p-1 rounded-xl shadow-sm no-print max-w-content mobile:hidden',
        {
          'opacity-0 hover:opacity-100 focus-within:opacity-100 transition-opacity':
            store.inReaderMode && !rail,
        },
      ]"
      @wheel.passive="changeWheelDirection"
    >
      <div
        class="w-full h-full flex"
        :class="rail ? 'flex-col items-center gap-0.5' : 'items-center justify-between'"
      >
        <button
          v-if="rail"
          v-tooltip.group="translations.editor?.backToNotes || 'Back to notes'"
          :aria-label="translations.editor?.backToNotes || 'Back to notes'"
          class="hoverable h-8 px-1 rounded-lg transition-colors flex items-center"
          @click="goBack"
        >
          <v-remixicon name="riArrowLeftLine" />
        </button>
        <button
          v-if="!rail"
          v-tooltip.group="translations.noteActions?.undo || 'Undo'"
          :aria-label="translations.noteActions?.undo || 'Undo'"
          class="hoverable h-8 px-1 rounded-lg transition-colors flex items-center"
          @click="editor.chain().focus().undo().run()"
        >
          <v-remixicon name="riArrowGoBackLine" />
        </button>

      <button
        v-if="!rail"
        v-tooltip.group="translations.noteActions?.redo || 'Redo'"
        :aria-label="translations.noteActions?.redo || 'Redo'"
        class="hoverable h-8 px-1 rounded-lg transition-colors flex items-center"
        @click="editor.chain().focus().redo().run()"
      >
        <v-remixicon name="riArrowGoForwardLine" />
      </button>

      <hr
        class="mx-1 h-6 border-r"
        :class="rail ? 'h-0 w-6 border-r-0 border-t mx-0 my-1' : ''"
      />

      <!-- Rail: open the share dialog straight away, like the mobile shell does. -->
      <button
        v-if="rail"
        v-tooltip.group="translations.menu.share"
        :aria-label="translations.menu.share"
        class="hoverable h-8 px-1 rounded-lg transition-colors flex items-center"
        @click="showShareModal = true"
      >
        <v-remixicon name="riShare2Line" />
      </button>

      <ui-popover v-else>
        <template #trigger>
          <button
            v-tooltip.group="translations.menu.share"
            :aria-label="translations.menu.share"
            class="hoverable h-8 px-1 rounded-lg transition-colors flex items-center"
          >
            <v-remixicon name="riShare2Line" />
          </button>
        </template>

        <ui-list>
          <ui-list-item
            v-if="isAuthenticated"
            tag="button"
            class="gap-2 text-left"
            @click="showShareModal = true"
          >
            <v-remixicon name="riUserSharedLine" />
            <span
              class="block text-sm font-medium dark:text-[color:var(--selected-dark-text)]"
            >
              {{ translations.share?.collaborate || 'Collaborate' }}
            </span>
          </ui-list-item>

          <hr v-if="isAuthenticated" class="border-t my-1" />

          <ui-list-item
            v-for="s in shareActions"
            :key="s.name"
            tag="button"
            class="gap-2 text-left"
            @click="s.handler"
          >
            <v-remixicon :name="s.icon" />
            <span
              class="block text-sm font-medium dark:text-[color:var(--selected-dark-text)]"
            >
              {{ s.title }}
            </span>
          </ui-list-item>
        </ui-list>
      </ui-popover>

      <button
        v-if="canUseHistory"
        v-tooltip.group="'History'"
        :aria-label="'History'"
        :class="{ 'is-active': showHistory }"
        class="hoverable h-8 px-1 rounded-lg transition-colors flex items-center"
        @click="$emit('toggle-history')"
      >
        <v-remixicon name="riHistoryLine" />
      </button>

      <!-- History is part of a paid plan: the locked button opens the paywall -->
      <button
        v-else
        v-tooltip.group="translations.noteActions?.historyLocked || 'Note history is part of a paid plan'"
        :aria-label="translations.noteActions?.historyLocked || 'Note history is part of a paid plan'"
        data-testid="history-locked"
        class="hoverable h-8 px-1 rounded-lg transition-colors flex items-center text-neutral-500 dark:text-neutral-400"
        @click="paywallOpen('history')"
      >
        <v-remixicon name="riLockLine" />
      </button>

      <button
        v-if="isAuthenticated"
        v-tooltip.group="translations.comments?.title || 'Comments'"
        :aria-label="translations.comments?.title || 'Comments'"
        :class="{ 'is-active': showComments }"
        class="hoverable h-8 px-1 rounded-lg transition-colors flex items-center"
        @click="$emit('toggle-comments')"
      >
        <v-remixicon name="riChat3Line" />
      </button>

      <presence-avatars
        v-if="showCollaboration"
        :peers="peers"
        class="mx-0.5"
      />

      <button
        v-tooltip.group="translations.menu.readerMode"
        :aria-label="translations.menu.readerMode"
        :class="{ 'is-active': store.inReaderMode }"
        class="hoverable h-8 px-1 rounded-lg transition-colors flex items-center"
        @click="toggleReaderMode"
      >
        <v-remixicon name="riArticleLine" />
      </button>

      <button
        v-tooltip.group="translations.noteActions?.search || 'Search'"
        :aria-label="translations.noteActions?.search || 'Search'"
        :class="{ 'is-active': showSearch }"
        class="hoverable h-8 px-1 rounded-lg transition-colors flex items-center"
        @click="$emit('toggle-search')"
      >
        <v-remixicon name="riSearchLine" />
      </button>

      <ui-popover v-if="!rail">
        <template #trigger>
          <button
            v-tooltip.group="
              translations.noteActions?.noteActions || 'Note actions'
            "
            :aria-label="
              translations.noteActions?.noteActions || 'Note actions'
            "
            class="hoverable h-8 px-1 rounded-lg transition-colors flex items-center"
          >
            <v-remixicon name="riEqualizer3Line" />
          </button>
        </template>

        <button
          class="flex w-full items-center gap-2 rounded-lg p-1.5 text-left hoverable transition-colors"
          :class="{ 'text-primary': note.isBookmarked }"
          @click="toggleBookmark"
        >
          <v-remixicon
            :name="note.isBookmarked ? 'riBookmarkFill' : 'riBookmarkLine'"
          />
          <span
            class="block text-sm font-medium dark:text-[color:var(--selected-dark-text)]"
          >
            {{
              note.isBookmarked
                ? translations.noteActions?.removeBookmark || 'Remove bookmark'
                : translations.noteActions?.bookmark || 'Bookmark'
            }}
          </span>
        </button>

        <button
          class="flex w-full items-center gap-2 rounded-lg p-1.5 text-left hoverable transition-colors"
          :class="{ 'text-primary': note.isArchived }"
          @click="toggleArchive"
        >
          <v-remixicon
            :name="note.isArchived ? 'riInboxUnarchiveLine' : 'riArchiveLine'"
          />
          <span
            class="block text-sm font-medium dark:text-[color:var(--selected-dark-text)]"
          >
            {{
              note.isArchived
                ? translations.noteActions?.unarchive || 'Unarchive'
                : translations.noteActions?.archive || 'Archive'
            }}
          </span>
        </button>

        <button
          class="flex w-full items-center gap-2 rounded-lg p-1.5 text-left hoverable transition-colors"
          @click="lockNote"
        >
          <v-remixicon name="riLockLine" />
          <span
            class="block text-sm font-medium dark:text-[color:var(--selected-dark-text)]"
          >
            {{ translations.noteActions?.lockNote || 'Lock note' }}
          </span>
        </button>

        <button
          class="flex w-full items-center gap-2 rounded-lg p-1.5 text-left transition-colors group hover:bg-red-500/10"
          @click="deleteNode"
        >
          <v-remixicon
            name="riDeleteBin6Line"
            class="text-red-600 dark:text-red-400"
          />
          <span
            class="block text-sm font-medium text-red-600 dark:text-red-400"
          >
            {{ translations.noteActions?.delete || 'Delete' }}
          </span>
        </button>

        <hr class="border-t my-1 border-neutral-200 dark:border-neutral-700" />

        <div
          class="flex w-full items-center justify-between gap-2 rounded-lg p-1.5 text-left hoverable transition-colors"
        >
          <div class="flex items-center gap-2">
            <v-remixicon name="riExpandWidthLine" />
            <span
              class="block text-sm font-medium dark:text-[color:var(--selected-dark-text)]"
            >
              {{ translations.noteActions?.fullWidth || 'Full width' }}
            </span>
          </div>
          <ui-switch
            :model-value="note.isFullWidth"
            @update:model-value="toggleFullWidth"
          />
        </div>

        <button
          class="flex w-full items-center gap-2 rounded-lg p-1.5 text-left hoverable transition-colors"
          :class="{ 'text-primary': note.showWordCount }"
          @click="toggleWordCount"
        >
          <v-remixicon name="riParagraph" />
          <span
            class="block text-sm font-medium dark:text-[color:var(--selected-dark-text)]"
          >
            {{ translations.noteActions?.wordCount || 'Word count' }}
          </span>
        </button>

        <hr class="border-t my-1 border-neutral-200 dark:border-neutral-700" />

        <!-- Copy note content -->
        <button
          class="flex w-full items-center gap-2 rounded-lg p-1.5 text-left hoverable transition-colors"
          @click="copyNoteContent"
        >
          <v-remixicon
            :name="copyState === 1 ? 'riCheckLine' : 'riClipboardLine'"
          />
          <span
            class="block text-sm font-medium dark:text-[color:var(--selected-dark-text)]"
          >
            {{
              copyState === 1
                ? translations.noteActions?.copied || 'Copied!'
                : translations.noteActions?.copyContent || 'Copy content'
            }}
          </span>
        </button>
      </ui-popover>
      </div>
    </div>
  </teleport>

  <div
    v-if="!rail"
    ref="shellRef"
    class="editor-actions-mobile-shell sticky z-[160] no-print transition-opacity duration-150 w-full bg-white/90 dark:bg-neutral-900/90 top-0 mb-4 hidden mobile:flex"
    :style="shellStyle"
  >
    <div class="flex w-full items-center justify-between">
      <button
        aria-label="Back"
        class="flex h-10 w-10 items-center justify-center rounded-xl text-neutral-600 transition-colors hover:bg-black/5 hover:text-neutral-900 dark:text-neutral-300 dark:hover:bg-white/10 dark:hover:text-white"
        @click="goBack"
      >
        <v-remixicon name="riArrowLeftLine" />
      </button>

      <div class="flex items-center gap-1">
        <button
          v-if="canUseHistory"
          :aria-label="'History'"
          class="flex h-10 w-10 items-center justify-center rounded-xl text-neutral-600 transition-colors hover:bg-black/5 hover:text-neutral-900 dark:text-neutral-300 dark:hover:bg-white/10 dark:hover:text-white"
          @click="$emit('toggle-history')"
        >
          <v-remixicon name="riHistoryLine" />
        </button>
        <button
          v-if="isAuthenticated"
          :aria-label="translations.comments?.title || 'Comments'"
          class="flex h-10 w-10 items-center justify-center rounded-xl transition-colors"
          :class="showComments
            ? 'bg-primary/10 text-primary dark:bg-secondary/10 dark:text-secondary'
            : 'text-neutral-600 hover:bg-black/5 hover:text-neutral-900 dark:text-neutral-300 dark:hover:bg-white/10 dark:hover:text-white'"
          @click="$emit('toggle-comments')"
        >
          <v-remixicon name="riChat3Line" />
        </button>
        <button
          :aria-label="translations.menu.share"
          class="flex h-10 w-10 items-center justify-center rounded-xl text-neutral-600 transition-colors hover:bg-black/5 hover:text-neutral-900 dark:text-neutral-300 dark:hover:bg-white/10 dark:hover:text-white"
          @click="showShareModal = true"
        >
          <v-remixicon name="riShare2Line" />
        </button>
        <button
          :aria-label="translations.menu.readerMode"
          class="flex h-10 w-10 items-center justify-center rounded-xl transition-colors"
          :class="
            store.inReaderMode
              ? 'bg-primary/10 text-primary dark:bg-secondary/10 dark:text-secondary'
              : 'text-neutral-600 hover:bg-black/5 hover:text-neutral-900 dark:text-neutral-300 dark:hover:bg-white/10 dark:hover:text-white'
          "
          @click="toggleReaderMode"
        >
          <v-remixicon name="riArticleLine" />
        </button>
        <button
          :aria-label="translations.noteActions?.search || 'Search'"
          class="flex h-10 w-10 items-center justify-center rounded-xl transition-colors"
          :class="
            showSearch
              ? 'bg-primary/10 text-primary dark:bg-secondary/10 dark:text-secondary'
              : 'text-neutral-600 hover:bg-black/5 hover:text-neutral-900 dark:text-neutral-300 dark:hover:bg-white/10 dark:hover:text-white'
          "
          @click="$emit('toggle-search')"
        >
          <v-remixicon name="riSearchLine" />
        </button>
      </div>
    </div>
  </div>

  <share-modal v-model="showShareModal" :note-id="id" :share-actions="shareActions" />
  <!-- Desktop: fixed dock above the editor. Mobile: the house bottom sheet,
       since the dock crowds the phone toolbar. The transition lives here, not
       inside HistoryPanel: only the owner of the v-if can animate both mounts. -->
  <ui-modal
    v-if="mobile && canUseHistory"
    v-model="showHistoryModel"
    custom-content
  >
    <history-panel
      :note-id="id"
      :editor="editor"
      :docked="false"
      @close="showHistoryModel = false"
      @restore="$emit('restore', $event)"
      @preview="$emit('preview', $event)"
    />
  </ui-modal>
  <transition v-else name="slide-up">
    <history-panel
      v-if="showHistory && canUseHistory"
      :note-id="id"
      :editor="editor"
      @close="$emit('toggle-history'); $emit('preview', null)"
      @restore="$emit('restore', $event)"
      @preview="$emit('preview', $event)"
    />
  </transition>
</template>

<script>
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { isMobileRuntime } from '@/lib/tauri/runtime';
import { foldState } from '@/lib/foldable';
import { useNoteMenu } from '@/composable/useNoteMenu';
import { useNoteStore } from '@/store/note';
import { useClipboard } from '@/composable/clipboard';
import { useDialog } from '@/lib/dialog';
import { useTranslations } from '@/composable/useTranslations';
import { extractTextFromContent } from '@/utils/note/serializer.js';
import { verifyPassphrase } from '@/utils/crypto/encryption.js';
import { useAccountStore } from '@/store/account';
import { usePaywall } from '@/composable/usePaywall';
import HistoryPanel from '@/components/note/HistoryPanel.vue';
import PresenceAvatars from '@/components/note/PresenceAvatars.vue';
import ShareModal from '@/components/note/ShareModal.vue';
export default {
  components: {
    HistoryPanel,
    PresenceAvatars,
    ShareModal,
  },
  props: {
    editor: { type: Object, default: () => ({}) },
    id: { type: String, default: '' },
    note: { type: Object, required: true },
    goBack: { type: Function, required: true },
    showSearch: { type: Boolean, default: false },
    peers: { type: [Map, Object], default: () => ({}) },
    localColor: { type: String, default: '' },
    localName: { type: String, default: '' },
    showHistory: { type: Boolean, default: false },
    showComments: { type: Boolean, default: false },
  },
  emits: [
    'toggle-search',
    'toggle-history',
    'toggle-comments',
    'restore',
    'preview',
  ],
  setup(props, { emit }) {
    const menu = useNoteMenu(props);
    const noteStore = useNoteStore();
    const accountStore = useAccountStore();
    const shellRef = ref(null);
    const showShareModal = ref(false);
    const isStuck = ref(false);
    const mobile = isMobileRuntime();
    // Foldable: the same action set renders stacked in the app rail instead of
    // the horizontal top row.
    const rail = computed(() => foldState.isFoldable);
    // Two-way binding onto the parent's showHistory ref; closing the sheet
    // (swipe, overlay, Escape) must also drop any editor preview.
    const showHistoryModel = computed({
      get: () => props.showHistory,
      set: (v) => {
        emit('toggle-history', v);
        if (!v) emit('preview', null);
      },
    });
    const { copyState, copyToClipboard } = useClipboard();

    const isAuthenticated = computed(() => accountStore.isAuthenticated);
    const canUseHistory = computed(() => accountStore.canUseHistory);
    const paywallOpen = usePaywall().open;
    // ponytail: anonymous users keep the app fully usable — the lock only opens
    // the paywall, never blocks the editor itself.
    const hasOnlinePeers = computed(() => {
      const p = props.peers;
      return p instanceof Map ? p.size > 0 : Object.keys(p).length > 0;
    });
    const showCollaboration = computed(
      () => isAuthenticated.value && hasOnlinePeers.value,
    );

    function lockNote() {
      const dialog = useDialog();
      const noteStore = useNoteStore();
      const { translations } = useTranslations();
      const t = translations.value.card;
      const dlg = translations.value.dialog;
      const settings = translations.value.settings;

      dialog.prompt({
        title: t.enterPasswd || 'Enter vault key',
        body: t.warning || 'Enter your vault key to lock this note.',
        icon: 'riLockLine',
        okText: t.lock || 'Lock',
        cancelText: t.cancel || 'Cancel',
        placeholder: t.password || 'Vault key',
        password: true,
        onConfirm: async (enteredPassword) => {
          const result = await verifyPassphrase(enteredPassword);
          if (result.ok) {
            await noteStore.lockNote(props.note.id);
          } else {
            dialog.alert({
              title: settings?.alertTitle || 'Alert',
              body: result.error || t.wrongPasswd || 'Wrong vault key.',
              okText: dlg?.close || 'Close',
            });
          }
        },
      });
    }

    function toggleBookmark() {
      noteStore.update(props.note.id, {
        isBookmarked: !props.note.isBookmarked,
      });
    }

    function toggleArchive() {
      noteStore.update(props.note.id, {
        isArchived: !props.note.isArchived,
      });
    }

    function toggleFullWidth() {
      noteStore.update(props.note.id, {
        isFullWidth: !props.note.isFullWidth,
      });
    }

    function toggleWordCount() {
      noteStore.update(props.note.id, {
        showWordCount: !props.note.showWordCount,
      });
    }

    function copyNoteContent() {
      let text = '';
      if (props.editor) {
        text = props.editor.getText();
      } else if (props.note?.content) {
        text = extractTextFromContent(props.note.content);
      }
      if (text) {
        copyToClipboard(text);
      }
    }

    const shellStyle = computed(() => ({
      paddingTop: isStuck.value ? 'calc(var(--app-safe-area-top))' : undefined,
    }));

    const syncStickyState = () => {
      if (typeof window === 'undefined' || !shellRef.value) return;

      const { top } = shellRef.value.getBoundingClientRect();
      isStuck.value = top <= 0;
    };

    onMounted(() => {
      syncStickyState();
      window.addEventListener('scroll', syncStickyState, { passive: true });
      window.addEventListener('resize', syncStickyState, { passive: true });
    });

    onUnmounted(() => {
      window.removeEventListener('scroll', syncStickyState);
      window.removeEventListener('resize', syncStickyState);
    });

    return {
      ...menu,
      copyState,
      shellRef,
      shellStyle,
      toggleBookmark,
      toggleArchive,
      toggleFullWidth,
      toggleWordCount,
      copyNoteContent,
      lockNote,
      syncStickyState,
      showShareModal,
      isAuthenticated,
      canUseHistory,
      paywallOpen,
      showCollaboration,
      mobile,
      rail,
      showHistoryModel,
    };
  },
};
</script>

<style scoped>
@media print {
  .no-print {
    visibility: hidden;
  }
}
button {
  @apply hover:text-neutral-800 dark:hover:text-[color:var(--selected-dark-text)];
}
button.is-active {
  @apply text-primary dark:text-secondary hover:text-primary dark:hover:text-secondary;
}
input[type='number']::-webkit-inner-spin-button,
input[type='number']::-webkit-outer-spin-button {
  -webkit-appearance: none;
  margin: 0;
}
input[type='number'] {
  -moz-appearance: textfield;
}

.editor-actions-mobile-shell {
  transition:
    box-shadow var(--motion-fast) var(--ease-standard),
    background-color var(--motion-fast) var(--ease-standard);
}

/* Rail: same square touch target as the nav buttons below it, so the column
   reads as one control strip rather than two mismatched lists. */
.rail-actions button {
  justify-content: center;
  width: 3rem;
  height: 3rem;
  padding: 0;
  border-radius: 0.75rem;
}
</style>
