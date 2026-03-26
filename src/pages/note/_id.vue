<template>
  <div
    v-if="note"
    class="editor note-editor-page mx-auto relative px-4 pb-0 lg:px-0 md:pb-6"
    :class="{ 'mobile-search-open': showSearch }"
    :style="{
      'padding-bottom': isLocked ? 0 : 'var(--app-note-page-padding)',
    }"
  >
    <button
      v-if="
        (showBack && !store.inReaderMode) ||
        ($route.query.linked && !store.inReaderMode)
      "
      class="ltr:left-0 rtl:right-0 ml-24 mt-4 fixed group print:hidden mobile:hidden"
      title="Alt+Arrow left"
      @click="goBack"
    >
      <v-remixicon
        name="riArrowDownLine"
        class="mr-2 -ml-1 rtl:ml-0 group-hover:-translate-x-1 transform transition rotate-90 rtl:-rotate-90"
      />
      <span v-if="$route.query.linked && !store.inReaderMode">
        {{ translations.editor.previousNote || '-' }}
      </span>
    </button>

    <template v-if="editor && !isLocked">
      <note-menu v-bind="{ editor, id, note }" class="mb-6 mobile:hidden" />
      <editor-actions-mobile
        v-bind="{ editor, id, note, goBack, showSearch }"
        class="hidden mobile:flex"
        @toggle-search="showSearch = !showSearch"
      />
      <transition
        enter-active-class="transition duration-200 ease-out"
        enter-from-class="opacity-0 translate-y-4"
        enter-to-class="opacity-100 translate-y-0"
        leave-active-class="transition duration-150 ease-in"
        leave-from-class="opacity-100 translate-y-0"
        leave-to-class="opacity-0 translate-y-4"
      >
        <note-search
          v-if="showSearch"
          v-bind="{ editor }"
          @close="closeSearch"
          @keyup.esc="closeSearch"
        />
      </transition>
      <note-menu-mobile v-bind="{ editor, id, note, showSearch }" />
    </template>
    <div
      v-if="!isLocked"
      ref="titleDiv"
      data-testid="note-title-input"
      contenteditable="true"
      class="text-5xl outline-none block font-bold bg-transparent w-full mb-6 cursor-text title-placeholder"
      :placeholder="translations.editor.untitledNote"
      @input="handleTitleInput"
      @keydown="disallowedEnter"
    ></div>
    <div v-else class="flex flex-col items-center justify-center h-screen">
      <v-remixicon
        class="w-24 h-auto text-gray-600 dark:text-white"
        name="riLockLine"
      />
      <p class="text-center pb-2 text-gray-600 dark:text-gray-200">
        {{
          appEncryptedLocked
            ? translations.settings?.unlockAppEncryption ||
              'This note is encrypted at rest. Unlock app encryption in Settings to edit it.'
            : translations.card.unlockToEdit
        }}
      </p>
      <div class="pb-2">
        <button
          class="ui-button py-2 text-center h-10 relative transition focus:ring-1 ring-secondary bg-input py-2 px-3 rounded-lg w-64"
          @click="
            appEncryptedLocked
              ? openSettingsForAppUnlock()
              : unlockNote(note.id)
          "
        >
          {{
            appEncryptedLocked
              ? translations.app?.openSettings || 'Open Settings'
              : translations.card.unlock
          }}
        </button>
      </div>
      <router-link
        class="ui-button py-2 text-center h-10 relative transition focus:ring-1 ring-secondary bg-input py-2 px-3 rounded-lg w-64"
        :to="`/`"
      >
        {{ translations.index.close }}
      </router-link>
    </div>

    <note-editor
      v-if="!isLocked"
      :id="$route.params.id"
      ref="noteEditor"
      :key="$route.params.id"
      :model-value="note.content"
      :cursor-position="note.lastCursorPosition"
      @update="
        autoScroll();
        handleContentUpdate($event);
      "
      @init="
        editor = $event;
        drawing.syncFromEditor($event);
      "
      @keyup.down="autoScroll"
    />
    <OverlayCanvas />
    <OverlayToolbar />
  </div>
</template>

<script>
import { ref, shallowRef, computed, watch, onMounted, onUnmounted } from 'vue';
import { isMobileRuntime } from '@/lib/tauri/runtime';
import { useTranslations } from '@/composable/useTranslations';
import { useRouter, onBeforeRouteLeave, useRoute } from 'vue-router';
import { useNoteStore } from '@/store/note';
import { usePasswordStore } from '@/store/passwd';
import { useLabelStore } from '@/store/label';
import { useStore } from '@/store';
import { useDialog } from '@/composable/dialog';
import { useStorage } from '@/composable/storage';
import { onClose } from '@/composable/onClose';
import { debounce } from '@/utils/helper';
import NoteMenuMobile from '@/components/note/NoteMenuMobile.vue';
import EditorActionsMobile from '@/components/note/EditorActionsMobile.vue';
import NoteEditor from '@/components/note/NoteEditor.vue';
import NoteMenu from '@/components/note/NoteMenu.vue';
import NoteSearch from '@/components/note/NoteSearch.vue';
import OverlayCanvas from '@/components/overlay/OverlayCanvas.vue';
import OverlayToolbar from '@/components/overlay/OverlayToolbar.vue';
import { useOverlayDrawing } from '@/composable/useOverlayDrawing';
import { useAppStore } from '../../store/app';
import { isAppEncryptedContent } from '@/utils/appCrypto';
import { bindGlobalShortcuts } from '@/utils/global-shortcuts';

export default {
  components: {
    NoteEditor,
    NoteMenu,
    NoteSearch,
    NoteMenuMobile,
    EditorActionsMobile,
    OverlayCanvas,
    OverlayToolbar,
  },
  setup() {
    const store = useStore();
    const route = useRoute();
    const router = useRouter();
    const storage = useStorage();
    const noteStore = useNoteStore();
    const labelStore = useLabelStore();
    const appStore = useAppStore();
    const dialog = useDialog();
    const drawing = useOverlayDrawing();

    const editor = shallowRef(null);
    const noteEditor = ref();
    const showSearch = shallowRef(false);

    const id = computed(() => route.params.id);
    const note = computed(() => noteStore.getById(id.value));
    const appEncryptedLocked = computed(
      () => !!note.value && isAppEncryptedContent(note.value.content)
    );
    const isLocked = computed(
      () => !!note.value && (note.value.isLocked || appEncryptedLocked.value)
    );
    const { translations } = useTranslations();

    watch(
      id,
      (n) => {
        if (!appStore.setting.collapsibleHeading && !isLocked.value) {
          noteStore.convertNote(n);
        }
      },
      {
        immediate: true,
      }
    );

    const showBack = computed(() => {
      const back = router.options.history.state.back;
      if (!back) return false;
      if (back === '/' || back.includes('/#/?')) return false;
      return true;
    });

    function goBack() {
      const from = router.options.history.state.back;

      if (!from) {
        router.push('/');
        return;
      }

      if (from.includes('/folder/') || from.includes('/archive/')) {
        router.go(-1);
        return;
      }

      if (from.includes('/note/')) {
        router.go(-1);
        return;
      }

      router.push('/');
    }

    const autoScroll = debounce(() => {
      if (!noteEditor.value) {
        return;
      }
      const lastChild =
        noteEditor.value.$el.querySelector('.ProseMirror').lastChild;
      if (
        !(
          document.body.scrollHeight >
          (window.innerHeight || document.documentElement.clientHeight)
        )
      ) {
        return;
      }
      const selection = window.getSelection();
      if (!lastChild.contains(selection.anchorNode)) {
        return;
      }
      const range = selection.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      const lastRect = lastChild.getBoundingClientRect();

      const lineHeight = rect.height;

      const offset = Math.abs(rect.bottom - lastRect.bottom);
      if (lastRect.top + lastRect.height <= window.innerHeight) {
        return;
      }
      if (lineHeight === 0) {
        lastChild.scrollIntoView();
      } else if (offset < lineHeight) {
        lastChild.scrollIntoView();
      }
    }, 50);

    const PERSIST_DELAY_MS = 300;
    let pendingPersistTimer = null;
    let pendingPersistNoteId = null;
    let pendingPersistPromise = null;
    let resolvePendingPersist = null;
    let rejectPendingPersist = null;

    function clearPendingPersistState() {
      pendingPersistTimer = null;
      pendingPersistNoteId = null;
      pendingPersistPromise = null;
      resolvePendingPersist = null;
      rejectPendingPersist = null;
    }

    function schedulePersist(noteId) {
      if (!noteId || !noteStore.getById(noteId)) {
        return Promise.resolve();
      }

      pendingPersistNoteId = noteId;
      clearTimeout(pendingPersistTimer);

      if (!pendingPersistPromise) {
        pendingPersistPromise = new Promise((resolve, reject) => {
          resolvePendingPersist = resolve;
          rejectPendingPersist = reject;
        });
      }

      pendingPersistTimer = setTimeout(async () => {
        const targetNoteId = pendingPersistNoteId;
        try {
          if (targetNoteId && noteStore.getById(targetNoteId)) {
            await noteStore.persist(targetNoteId);
          }
          resolvePendingPersist?.();
        } catch (error) {
          rejectPendingPersist?.(error);
        } finally {
          clearPendingPersistState();
        }
      }, PERSIST_DELAY_MS);

      return pendingPersistPromise;
    }

    async function flushScheduledPersist(noteId = pendingPersistNoteId) {
      if (!pendingPersistTimer) {
        if (noteId && noteStore.getById(noteId)) {
          await noteStore.persist(noteId);
        }
        return;
      }

      clearTimeout(pendingPersistTimer);

      try {
        if (noteId && noteStore.getById(noteId)) {
          await noteStore.persist(noteId);
        }
        resolvePendingPersist?.();
      } catch (error) {
        rejectPendingPersist?.(error);
        throw error;
      } finally {
        clearPendingPersistState();
      }
    }

    function buildCurrentNotePatch() {
      const labels = new Set();
      const labelEls =
        editor.value?.options.element.querySelectorAll('[data-mention]') ?? [];

      Array.from(labelEls).forEach((el) => {
        const labelId = el.dataset.id;
        if (labelStore.data.includes(labelId)) labels.add(labelId);
      });

      const currentContent = editor.value?.getJSON();
      const currentTitle = titleDiv.value?.innerText ?? '';
      const currentCursorPosition = editor.value?.state.selection.to;

      return {
        labels: [...labels],
        ...(currentContent ? { content: currentContent } : {}),
        ...(currentTitle !== undefined ? { title: currentTitle } : {}),
        ...(Number.isFinite(currentCursorPosition)
          ? { lastCursorPosition: currentCursorPosition }
          : {}),
        updatedAt: Date.now(),
      };
    }

    async function persistCurrentNote(
      noteId = route.params.id,
      { wait = true } = {}
    ) {
      if (appEncryptedLocked.value) return;
      if (!noteId || !noteStore.getById(noteId)) return;

      noteStore.patchLocal(noteId, buildCurrentNotePatch());
      const persistPromise = flushScheduledPersist(noteId);

      if (!wait) {
        persistPromise.catch((error) => {
          console.error('Error persisting note during navigation:', error);
        });
        return;
      }

      await persistPromise;
    }

    const updateNote = (data) => {
      if (appEncryptedLocked.value) return Promise.resolve();
      const noteId = note.value?.id || route.params.id;
      if (!noteId || !noteStore.getById(noteId)) return Promise.resolve();

      noteStore.patchLocal(noteId, {
        ...data,
        updatedAt: Date.now(),
      });
      return schedulePersist(noteId);
    };

    function handleTitleInput(event) {
      return updateNote({ title: event.target.innerText });
    }

    function handleContentUpdate(content) {
      return updateNote({ content });
    }

    function closeSearch() {
      showSearch.value = false;
    }

    watch(
      () => route.params.id,
      (noteId, oldNoteId) => {
        drawing.exitDrawMode();
        drawing.syncFromEditor(null);

        if (oldNoteId && noteId && noteStore.getById(oldNoteId)) {
          noteStore.patchLocal(oldNoteId, {
            lastCursorPosition: editor.value?.state.selection.to,
          });
          void flushScheduledPersist(oldNoteId).catch((error) => {
            console.error('Error persisting previous note:', error);
          });
        }

        if (!noteId) return;

        storage.get(`notes.${noteId}`).then((data) => {
          if (!data || data.id === '') {
            router.push('/');
          } else {
            store.activeNoteId = data.id;
            localStorage.setItem('lastNoteEdit', noteId);
          }
        });
      },
      { immediate: true }
    );

    const handleBeforeUnload = () => {
      // Best-effort flush for Cmd/Ctrl+R or hard renderer reload.
      void persistCurrentNote(route.params.id);
    };
    let removeGlobalShortcuts = () => {};

    onMounted(() => {
      removeGlobalShortcuts = bindGlobalShortcuts({
        'mod+f': () => {
          document.querySelector('.editor-search input')?.focus();
          showSearch.value = true;
        },
        'alt+left': () => {
          if (!route.query.linked) return false;
          router.back();
        },
      });
      window.addEventListener('beforeunload', handleBeforeUnload);
    });

    onUnmounted(() => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      removeGlobalShortcuts();
    });
    onBeforeRouteLeave(() => {
      drawing.exitDrawMode();
      drawing.syncFromEditor(null);
      void persistCurrentNote(route.params.id, { wait: false });
      removeGlobalShortcuts();
    });

    onClose(async () => {
      await persistCurrentNote(route.params.id);
    });

    const focusEditor = () => {
      if (editor.value?.commands?.focus) {
        editor.value.commands.focus(undefined, { scrollIntoView: false });
        return;
      }

      const focusTarget =
        noteEditor.value?.$el?.querySelector('*[tabindex="0"]');

      if (!focusTarget?.focus) return;

      try {
        focusTarget.focus({ preventScroll: true });
      } catch {
        focusTarget.focus();
      }
    };

    const disallowedEnter = (event) => {
      if (event && event.key === 'Enter') {
        focusEditor();
        event.returnValue = false;
      }
    };

    watch(
      () => store.showPrompt,
      (n) => {
        if (!n) {
          focusEditor();
        }
      }
    );

    async function unlockNote(note) {
      const passwordStore = usePasswordStore();
      const noteStore = useNoteStore();
      const showWrongPassword = () =>
        dialog.alert({
          title: translations.value.settings?.alertTitle || 'Alert',
          body: translations.value.card.wrongPasswd,
          okText: translations.value.dialog?.close || 'Close',
        });

      dialog.prompt({
        title: translations.value.card.enterPasswd,
        okText: translations.value.card.unlock,
        cancelText: translations.value.card.cancel,
        placeholder: translations.value.card.password,
        onConfirm: async (enteredPassword) => {
          try {
            const hassharedKey = await passwordStore.retrieve();

            if (!hassharedKey) {
              try {
                await noteStore.unlockNote(note, enteredPassword);
                await passwordStore.setsharedKey(enteredPassword);
              } catch (error) {
                showWrongPassword();
                return;
              }
            } else {
              const isValidPassword = await passwordStore.isValidPassword(
                enteredPassword
              );
              if (isValidPassword) {
                await noteStore.unlockNote(note, enteredPassword);
              } else {
                showWrongPassword();
              }
            }
          } catch (error) {
            console.error('Error unlocking note:', error);
            showWrongPassword();
          }
        },
      });
    }

    function openSettingsForAppUnlock() {
      router.push('/settings');
    }

    const titleDiv = ref(null);

    onMounted(() => {
      if (titleDiv.value && note.value.title) {
        titleDiv.value.innerText = note.value.title;
      }
    });

    watch(
      () => note.value?.id,
      () => {
        if (!titleDiv.value) return;

        titleDiv.value.innerText = note.value?.title || '';
      },
      { immediate: true }
    );

    return {
      id,
      showBack,
      titleDiv,
      goBack,
      noteEditor,
      note,
      translations,
      store,
      unlockNote,
      openSettingsForAppUnlock,
      appEncryptedLocked,
      editor,
      showSearch,
      updateNote,
      handleTitleInput,
      handleContentUpdate,
      closeSearch,
      disallowedEnter,
      autoScroll,
      isLocked,
      drawing,
    };
  },
};
</script>

<style scoped>
.title-placeholder:empty::before {
  content: attr(placeholder);
  color: #a1a1aa;
}

:root {
  --selected-width: '54rem';
}

.editor {
  max-width: var(--selected-width);
}

@media (max-width: 767px) {
  .note-editor-page {
    padding-top: 0;
  }

  .note-editor-page.mobile-search-open {
    padding-top: 0;
  }
}
</style>
