<template>
  <!-- Desktop -->
  <div
    ref="container"
    class="bg-white dark:bg-neutral-900 border overflow-x-auto w-fit p-1 rounded-lg shadow-sm no-print max-w-content mobile:hidden"
    :class="{
      'opacity-0 hover:opacity-100 transition-opacity': store.inReaderMode,
    }"
    @wheel.passive="changeWheelDirection"
  >
    <div class="w-full h-full flex items-center justify-between">
      <button
        v-tooltip.group="translations.noteActions?.undo || 'Undo'"
        class="hoverable h-8 px-1 rounded-lg transition-colors flex items-center"
        @click="editor.chain().focus().undo().run()"
      >
        <v-remixicon name="riArrowGoBackLine" />
      </button>

      <button
        v-tooltip.group="translations.noteActions?.redo || 'Redo'"
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
            class="hoverable h-8 px-1 rounded-lg transition-colors flex items-center"
          >
            <v-remixicon name="riShare2Line" />
          </button>
        </template>

        <button
          v-for="s in shareActions"
          :key="s.name"
          class="flex w-full items-center gap-2 rounded-lg p-1.5 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
          @click="s.handler"
        >
          <v-remixicon :name="s.icon" />
          <span
            class="block text-sm font-medium dark:text-[color:var(--selected-dark-text)]"
          >
            {{ s.title }}
          </span>
        </button>
      </ui-popover>

      <button
        v-tooltip.group="translations.menu.readerMode"
        :class="{ 'is-active': store.inReaderMode }"
        class="hoverable h-8 px-1 rounded-lg transition-colors flex items-center"
        @click="toggleReaderMode"
      >
        <v-remixicon name="riArticleLine" />
      </button>

      <button
        v-tooltip.group="translations.noteActions?.search || 'Search'"
        :class="{ 'is-active': showSearch }"
        class="hoverable h-8 px-1 rounded-lg transition-colors flex items-center"
        @click="$emit('toggle-search')"
      >
        <v-remixicon name="riSearchLine" />
      </button>

      <ui-popover>
        <template #trigger>
          <button
            v-tooltip.group="translations.noteActions?.noteActions || 'Note actions'"
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
            {{ note.isBookmarked ? translations.noteActions?.removeBookmark || 'Remove bookmark' : translations.noteActions?.bookmark || 'Bookmark' }}
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
            {{ note.isArchived ? (translations.noteActions?.unarchive || 'Unarchive') : (translations.noteActions?.archive || 'Archive') }}
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
            {{ copyState === 1 ? (translations.noteActions?.copied || 'Copied!') : (translations.noteActions?.copyContent || 'Copy content') }}
          </span>
        </button>
      </ui-popover>
    </div>
  </div>

  <!-- Mobile -->
  <div
    ref="shellRef"
    class="editor-actions-mobile-shell sticky z-[160] no-print transition-opacity duration-150 w-full bg-white/90 dark:bg-neutral-900/90 top-0 mb-4 hidden mobile:flex"
    :style="shellStyle"
  >
    <div class="flex w-full items-center justify-between p-1.5">
      <button
        class="flex h-10 w-10 items-center justify-center rounded-xl text-neutral-600 transition-colors hover:bg-black/5 hover:text-neutral-900 dark:text-neutral-300 dark:hover:bg-white/10 dark:hover:text-white"
        @click="goBack"
      >
        <v-remixicon name="riArrowLeftLine" />
      </button>

      <div class="flex items-center gap-1">
        <button
          class="flex h-10 w-10 items-center justify-center rounded-xl text-neutral-600 transition-colors hover:bg-black/5 hover:text-neutral-900 dark:text-neutral-300 dark:hover:bg-white/10 dark:hover:text-white"
          @click="showShareDialog = true"
        >
          <v-remixicon name="riShare2Line" />
        </button>
        <button
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

  <!-- Share modal (mobile only)  -->
  <ui-modal v-model="showShareDialog" content-class="max-w-sm">
    <template #header>
      <h3 class="text-lg font-semibold">
        {{ translations.menu.share || 'Share' }}
      </h3>
    </template>

    <div class="grid gap-2 p-2">
      <button
        v-for="s in shareActions"
        :key="s.name"
        class="flex items-center gap-3 rounded-xl px-3 py-3 text-left text-neutral-700 transition-colors hover:bg-black/5 dark:text-neutral-100 dark:hover:bg-white/10"
        @click="s.handler"
      >
        <v-remixicon :name="s.icon" />
        <span class="min-w-0 flex-1">
          <span class="block text-sm font-medium">{{ s.title }}</span>
        </span>
      </button>
    </div>
  </ui-modal>
</template>

<script>
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useNoteMenu } from '@/composable/useNoteMenu';
import { useNoteStore } from '@/store/note';
import { usePasswordStore } from '@/store/passwd';
import { useClipboard } from '@/composable/clipboard';
import { useDialog } from '@/composable/dialog';
import { useTranslations } from '@/composable/useTranslations';
import { extractTextFromContent } from '@/utils/note/serializer.js';
import { verifyPassphrase } from '@/utils/crypto/encryption.js';
export default {
  props: {
    editor: { type: Object, default: () => ({}) },
    id: { type: String, default: '' },
    note: { type: Object, required: true },
    goBack: { type: Function, required: true },
    showSearch: { type: Boolean, default: false },
  },
  emits: ['toggle-search'],
  setup(props) {
    const menu = useNoteMenu(props);
    const noteStore = useNoteStore();
    const shellRef = ref(null);
    const showShareDialog = ref(false);
    const isStuck = ref(false);
    const { copyState, copyToClipboard } = useClipboard();

    function lockNote() {
      const passwordStore = usePasswordStore();
      const noteStore = useNoteStore();
      const dialog = useDialog();
      const { translations } = useTranslations();
      const t = translations.value.card;
      const dlg = translations.value.dialog;
      const settings = translations.value.settings;

      passwordStore.retrieve().then((hasSharedKey) => {
        if (!hasSharedKey) {
          dialog.prompt({
            title: t.enterPasswd || 'Set a password',
            okText: t.setKey || 'Set Key',
            body: t.warning || 'Set a password to lock this note.',
            cancelText: t.cancel || 'Cancel',
            placeholder: t.password || 'Password',
            onConfirm: async (newKey) => {
              if (newKey) {
                try {
                  await passwordStore.setSharedKey(newKey);
                  await verifyPassphrase(newKey);
                  await noteStore.lockNote(props.note.id, newKey);
                } catch {
                  dialog.alert({
                    title: t.keyFail || 'Error',
                    body: t.keyFail || 'Failed to lock note.',
                    okText: dlg?.close || 'Close',
                  });
                }
              }
            },
          });
        } else {
          dialog.prompt({
            title: t.enterPasswd || 'Enter password',
            body:
              t.warning ||
              'Warning, if you forget your password, you will lose access to your locked notes.',
            icon: 'riLockLine',
            okText: t.lock || 'Lock',
            cancelText: t.cancel || 'Cancel',
            placeholder: t.password || 'Password',
            onConfirm: async (enteredPassword) => {
              const isValid = await passwordStore.isValidPassword(
                enteredPassword
              );
              if (isValid) {
                await noteStore.lockNote(props.note.id, enteredPassword);
              } else {
                dialog.alert({
                  title: settings?.alertTitle || 'Alert',
                  body: t.wrongPasswd || 'Wrong password.',
                  okText: dlg?.close || 'Close',
                });
              }
            },
          });
        }
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
      copyNoteContent,
      lockNote,
      syncStickyState,
      showShareDialog,
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
  transition: padding-top 180ms ease, box-shadow 180ms ease,
    background-color 180ms ease;
}
</style>
