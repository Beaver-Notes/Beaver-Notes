<template>
  <div
    ref="container"
    class="bg-white dark:bg-neutral-900 border overflow-x-auto w-fit p-1 rounded-xl shadow-sm no-print max-w-content mobile:hidden"
    :class="{
      'opacity-0 hover:opacity-100 focus-within:opacity-100 transition-opacity': store.inReaderMode,
    }"
    @wheel.passive="changeWheelDirection"
  >
    <div class="w-full h-full flex items-center justify-between">
      <button
        v-tooltip.group="translations.noteActions?.undo || 'Undo'"
        :aria-label="translations.noteActions?.undo || 'Undo'"
        class="hoverable h-8 px-1 rounded-lg transition-colors flex items-center"
        @click="editor.chain().focus().undo().run()"
      >
        <v-remixicon name="riArrowGoBackLine" />
      </button>

      <button
        v-tooltip.group="translations.noteActions?.redo || 'Redo'"
        :aria-label="translations.noteActions?.redo || 'Redo'"
        class="hoverable h-8 px-1 rounded-lg transition-colors flex items-center"
        @click="editor.chain().focus().redo().run()"
      >
        <v-remixicon name="riArrowGoForwardLine" />
      </button>

      <hr class="border-r mx-1 h-6" />

      <ui-popover>
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
        v-if="isAuthenticated"
        v-tooltip.group="'History'"
        :aria-label="'History'"
        :class="{ 'is-active': showHistory }"
        class="hoverable h-8 px-1 rounded-lg transition-colors flex items-center"
        @click="$emit('toggle-history')"
      >
        <v-remixicon name="riHistoryLine" />
      </button>

      <button
        v-if="isShared"
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

      <ui-popover>
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
          class="flex w-full items-center gap-2 rounded-lg p-1.5 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
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
          class="flex w-full items-center gap-2 rounded-lg p-1.5 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
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
          class="flex w-full items-center gap-2 rounded-lg p-1.5 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
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
          class="flex w-full items-center justify-between gap-2 rounded-lg p-1.5 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
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
          class="flex w-full items-center gap-2 rounded-lg p-1.5 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
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
          class="flex w-full items-center gap-2 rounded-lg p-1.5 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
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

  <div
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
          v-if="isAuthenticated"
          :aria-label="'History'"
          class="flex h-10 w-10 items-center justify-center rounded-xl text-neutral-600 transition-colors hover:bg-black/5 hover:text-neutral-900 dark:text-neutral-300 dark:hover:bg-white/10 dark:hover:text-white"
          @click="$emit('toggle-history')"
        >
          <v-remixicon name="riHistoryLine" />
        </button>
        <button
          v-if="isShared"
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
  <history-panel
    v-if="showHistory"
    :note-id="id"
    @close="$emit('toggle-history')"
  />
</template>

<script>
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useNoteMenu } from '@/composable/useNoteMenu';
import { useNoteStore } from '@/store/note';
import { useClipboard } from '@/composable/clipboard';
import { useDialog } from '@/lib/dialog';
import { useTranslations } from '@/composable/useTranslations';
import { extractTextFromContent } from '@/utils/note/serializer.js';
import { verifyPassphrase } from '@/utils/crypto/encryption.js';
import { useAccountStore } from '@/store/account';
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
    localName: { type: String, default: 'Anonymous' },
    showHistory: { type: Boolean, default: false },
    showComments: { type: Boolean, default: false },
    isShared: { type: Boolean, default: false },
  },
  emits: ['toggle-search', 'toggle-history', 'toggle-comments'],
  setup(props) {
    const menu = useNoteMenu(props);
    const noteStore = useNoteStore();
    const accountStore = useAccountStore();
    const shellRef = ref(null);
    const showShareModal = ref(false);
    const isStuck = ref(false);
    const { copyState, copyToClipboard } = useClipboard();

    const isAuthenticated = computed(() => accountStore.isAuthenticated);
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
        title: t.enterPasswd || 'Enter passphrase',
        body: t.warning || 'Enter your workspace passphrase to lock this note.',
        icon: 'riLockLine',
        okText: t.lock || 'Lock',
        cancelText: t.cancel || 'Cancel',
        placeholder: t.password || 'Passphrase',
        password: true,
        onConfirm: async (enteredPassword) => {
          const result = await verifyPassphrase(enteredPassword);
          if (result.ok) {
            await noteStore.lockNote(props.note.id);
          } else {
            dialog.alert({
              title: settings?.alertTitle || 'Alert',
              body: result.error || t.wrongPasswd || 'Wrong passphrase.',
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
      showCollaboration,
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
</style>
