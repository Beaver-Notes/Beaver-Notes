<template>
  <div
    v-if="note"
    class="editor note-editor-page mx-auto relative px-4 lg:px-0"
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
      :title="translations.editor.backShortcutTitle || 'Alt+Arrow left'"
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
      <editor-actions-mobile
        v-bind="{ editor, id, note, goBack, showSearch }"
        class="hidden mobile:flex"
        @toggle-search="showSearch = !showSearch"
      />
      <note-menu v-bind="{ editor, id, note }" class="mb-6 mobile:hidden" />
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
              'This note is encrypted at rest. Enter your password to unlock it.'
            : translations.card.unlockToEdit
        }}
      </p>
      <div class="pb-2">
        <button
          class="ui-button py-2 text-center h-10 relative transition focus:ring-1 ring-secondary bg-input py-2 px-3 rounded-lg w-64"
          @click="
            appEncryptedLocked ? unlockAppEncryption() : unlockNote(note.id)
          "
        >
          {{
            appEncryptedLocked
              ? translations.settings?.unlock || 'Unlock'
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
      @init="editor = $event"
      @keyup.down="autoScroll"
    />
  </div>
</template>

<script>
import { ref, shallowRef, computed, watch, onMounted, onUnmounted } from 'vue';
import { debounce } from '@/utils/helper';
import { useRouter, onBeforeRouteLeave, useRoute } from 'vue-router';
import { useNoteStore } from '@/store/note';
import { useLabelStore } from '@/store/label';
import { useStore } from '@/store';
import { useStorage } from '@/composable/storage';
import { onClose } from '@/composable/onClose';
import { useNotePersistence } from '@/composable/useNotePersistence';
import { useNoteBackNavigation } from '@/composable/useNoteBackNavigation';
import { useNoteEncryption } from '@/composable/useNoteEncryption';
import { useEditorAutoScroll } from '@/composable/useEditorAutoScroll';
import NoteMenuMobile from '@/components/note/NoteMenuMobile.vue';
import EditorActionsMobile from '@/components/note/EditorActionsMobile.vue';
import NoteEditor from '@/components/note/NoteEditor.vue';
import NoteMenu from '@/components/note/NoteMenu.vue';
import NoteSearch from '@/components/note/NoteSearch.vue';
import { useAppStore } from '../../store/app';
import { isEncryptedContent } from '@/utils/encryption.js';
import { decryptNoteForMemory, hydrateNote } from '@/utils/noteSerializer.js';
import { bindGlobalShortcuts } from '@/utils/global-shortcuts';
import { useTranslations } from '@/composable/useTranslations';

export default {
  components: {
    NoteEditor,
    NoteMenu,
    NoteSearch,
    NoteMenuMobile,
    EditorActionsMobile,
  },
  setup() {
    const store = useStore();
    const route = useRoute();
    const router = useRouter();
    const storage = useStorage();
    const noteStore = useNoteStore();
    const labelStore = useLabelStore();
    const appStore = useAppStore();

    const editor = shallowRef(null);
    const noteEditor = ref();
    const showSearch = shallowRef(false);
    const titleDiv = ref(null);

    const id = computed(() => route.params.id);
    const note = computed(() => noteStore.getById(id.value));
    const appEncryptedLocked = computed(
      () => !!note.value && isEncryptedContent(note.value.content)
    );
    const isLocked = computed(
      () => !!note.value && (note.value.isLocked || appEncryptedLocked.value)
    );
    const { translations } = useTranslations();

    // Persistence
    const { updateNote, persistCurrentNote, flushScheduledPersist } =
      useNotePersistence({
        noteStore,
        labelStore,
        appEncryptedLocked,
      });

    // Navigation
    const { showBack, goBack } = useNoteBackNavigation();

    // Encryption
    const { unlockNote, unlockAppEncryption } = useNoteEncryption({
      noteId: id,
      appEncryptedLocked,
    });

    // Auto-scroll
    const { autoScroll } = useEditorAutoScroll(noteEditor);

    // Watch note ID for decryption and heading conversion
    watch(
      id,
      async (n) => {
        const currentNote = noteStore.getById(n);
        if (currentNote && isEncryptedContent(currentNote.content)) {
          const decrypted = await decryptNoteForMemory(currentNote);
          if (decrypted !== currentNote) {
            noteStore.data[n] = hydrateNote(decrypted);
          }
        }
        if (!appStore.setting.collapsibleHeading && !isLocked.value) {
          noteStore.convertNote(n);
        }
      },
      { immediate: true }
    );

    // Title / content handlers
    const handleTitleInput = debounce((event) => {
      return updateNote(id.value, { title: event.target.innerText });
    }, 150);

    function handleContentUpdate(content) {
      return updateNote(id.value, { content });
    }

    function closeSearch() {
      showSearch.value = false;
    }

    // Route watcher for persist-on-leave
    watch(
      () => route.params.id,
      (noteId, oldNoteId) => {
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

    // Lifecycle
    const handleBeforeUnload = () => {
      void persistCurrentNote(editor.value, titleDiv.value, route.params.id);
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

      if (titleDiv.value && note.value.title) {
        titleDiv.value.innerText = note.value.title;
      }
    });

    onUnmounted(() => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      removeGlobalShortcuts();
    });

    onBeforeRouteLeave(() => {
      void persistCurrentNote(editor.value, titleDiv.value, route.params.id, {
        wait: false,
      });
      removeGlobalShortcuts();
    });

    onClose(async () => {
      await persistCurrentNote(editor.value, titleDiv.value, route.params.id);
    });

    // Editor focus helpers
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
      unlockAppEncryption,
      appEncryptedLocked,
      editor,
      showSearch,
      handleTitleInput,
      handleContentUpdate,
      closeSearch,
      disallowedEnter,
      autoScroll,
      isLocked,
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
  --selected-width: 54rem;
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
