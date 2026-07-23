<template>
  <div v-if="note" class="flex flex-col">
    <template v-if="editor && !isLocked">
      <div
        class="no-print sticky top-4 mobile:top-0 z-10 flex items-start px-4"
      >
        <div
          v-if="previousNote && !uiState.inReaderMode"
          class="bg-white dark:bg-neutral-900 border p-1 rounded-lg shadow-sm flex items-center w-fit max-w-content"
        >
          <button
            class="hoverable h-8 px-2 rounded-lg transition-colors flex items-center gap-1.5 text-sm text-neutral-700 dark:text-neutral-300 mobile:hidden"
            :title="translations.editor.backShortcutTitle || 'Alt+Arrow left'"
            @click="goToPrevious"
          >
            <v-remixicon name="riArrowLeftLine" class="flex-shrink-0" />
            <span class="truncate max-w-[16rem]">
              {{
                previousNote.title ||
                translations.editor.untitledNote ||
                'Untitled'
              }}
            </span>
          </button>
        </div>
        <div class="flex-1"></div>
        <note-actions
          v-bind="{ editor, id, note, showSearch, goBack }"
          @toggle-search="showSearch = !showSearch"
        />
      </div>
    </template>

    <div
      class="editor note-editor-page self-center w-full mobile:px-4 px-12 lg:px-0 mobile:pt-0 pt-20"
      :class="{ 'mobile-search-open': showSearch }"
      :style="{
        '--selected-width': note?.isFullWidth ? '100%' : '54rem',
        'padding-bottom': isLocked ? 0 : 'var(--app-note-page-padding)',
        ...(note?.isFullWidth
          ? { 'padding-left': '5rem', 'padding-right': '5rem' }
          : {}),
      }"
    >
      <template v-if="editor && !isLocked">
        <transition
          v-if="showSearch"
          enter-active-class="transition duration-200 ease-out"
          enter-from-class="opacity-0 translate-y-4"
          enter-to-class="opacity-0 translate-y-0"
          leave-active-class="transition duration-150 ease-out"
          leave-from-class="opacity-0 translate-y-0"
          leave-to-class="opacity-0 translate-y-4"
        >
          <note-search
            v-bind="{ editor }"
            @close="closeSearch"
            @keyup.esc="closeSearch"
          />
        </transition>
        <note-toolbar v-else v-bind="{ editor, id, note, showSearch }" />
      </template>
      <textarea
        v-if="!isLocked"
        ref="titleDiv"
        data-testid="note-title-input"
        rows="1"
        class="text-5xl outline-none block font-bold bg-transparent w-full mb-6 cursor-text title-placeholder resize-none overflow-hidden leading-tight"
        :class="editor ? '' : 'invisible'"
        :placeholder="translations.editor.untitledNote"
        @input="handleTitleInput"
        @keydown="disallowedEnter"
      ></textarea>
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

      <div v-if="!isLocked" class="relative editor-skeleton-wrapper">
        <note-editor
          v-if="yjsReady"
          :id="$route.params.id"
          ref="noteEditor"
          :key="$route.params.id"
          :ydoc="ydoc"
          :note="note"
          :cursor-position="note.lastCursorPosition"
          @update="
            autoScroll();
            handleContentUpdate($event);
          "
          @init="editor = $event"
          @keyup.down="autoScroll"
        />
        <div
          v-if="yjsReady && !editor"
          class="editor-skeleton"
        >
          <div class="space-y-4 animate-pulse">
            <div class="h-4 bg-neutral-200 dark:bg-neutral-700 rounded w-3/4" />
            <div class="h-4 bg-neutral-200 dark:bg-neutral-700 rounded w-1/2" />
            <div class="h-4 bg-neutral-200 dark:bg-neutral-700 rounded w-5/6" />
            <div class="h-4 bg-neutral-200 dark:bg-neutral-700 rounded w-2/3" />
          </div>
        </div>
        <div v-if="!yjsReady" class="editor-skeleton">
          <div class="space-y-4 animate-pulse">
            <div class="h-4 bg-neutral-200 dark:bg-neutral-700 rounded w-3/4" />
            <div class="h-4 bg-neutral-200 dark:bg-neutral-700 rounded w-1/2" />
            <div class="h-4 bg-neutral-200 dark:bg-neutral-700 rounded w-5/6" />
            <div class="h-4 bg-neutral-200 dark:bg-neutral-700 rounded w-2/3" />
          </div>
        </div>
      </div>
      <note-backlinks v-if="!isLocked" />
    </div>
    <note-headings-progress
      v-if="editor"
      :editor="editor"
      class="mobile:hidden ipad:hidden"
    />
  </div>
</template>

<script>
import {
  ref,
  shallowRef,
  computed,
  watch,
  nextTick,
  onMounted,
  onUnmounted,
} from 'vue';
import { debounce } from '@/utils/helpers/index.js';
import { useRouter, onBeforeRouteLeave, useRoute } from 'vue-router';
import { useNoteStore } from '@/store/note';
import { useLabelStore } from '@/store/label';
import { useUiState } from '@/composable/useUiState';
import { useStorage } from '@/composable/storage';
import { useStore } from '@/store';
import { addCloseHandler } from '@/lib/tauri-bridge';
import { useNotePersistence } from '@/composable/useNotePersistence';
import { useNoteEncryption } from '@/composable/useNoteEncryption';
import NoteToolbar from '@/components/note/NoteToolbar.vue';
import NoteEditor from '@/components/note/NoteEditor.vue';
import NoteActions from '@/components/note/NoteActions.vue';
import NoteSearch from '@/components/note/NoteSearch.vue';
import NoteHeadingsProgress from '@/components/note/NoteHeadingsProgress.vue';
import NoteBacklinks from '@/components/note/NoteBacklinks.vue';
import { useAppStore } from '../../store/app';
import { isEncryptedContent } from '@/utils/crypto/encryption.js';
import { decryptNoteForMemory, hydrateNote } from '@/utils/note/serializer.js';
import { bindGlobalShortcuts } from '@/utils/ui/globalShortcuts.js';
import { useTranslations } from '@/composable/useTranslations';
import { useNoteYjs } from '@/composable/useNoteYjs';

export default {
  components: {
    NoteEditor,
    NoteActions,
    NoteSearch,
    NoteToolbar,
    NoteHeadingsProgress,
    NoteBacklinks,
  },
  inheritAttrs: false,
  setup() {
    const uiState = useUiState();
    const route = useRoute();
    const store = useStore();
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

    // Yjs document management for note content
    const {
      doc: ydoc,
      ready: yjsReady,
      load: yjsLoad,
    } = useNoteYjs();

    // Persistence
    const { updateNote, persistCurrentNote, flushScheduledPersist } =
      useNotePersistence({
        noteStore,
        labelStore,
        appEncryptedLocked,
      });

    // Navigation
    const showBack = computed(() => {
      const back = router.options.history.state.back;
      if (!back) return false;
      if (back === '/' || back.includes('/#/?')) return false;
      return true;
    });
    const previousNote = computed(() => {
      const fromId = route.query.from;
      if (!fromId) return null;
      return noteStore.getById(fromId) || null;
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
    function goToPrevious() {
      if (previousNote.value) {
        router.push({
          name: 'Note',
          params: { id: previousNote.value.id },
        });
        return;
      }
      goBack();
    }

    // Encryption
    const { unlockNote, unlockAppEncryption } = useNoteEncryption({
      noteId: id,
      appEncryptedLocked,
    });

    // Auto-scroll
    const autoScroll = debounce(() => {
      if (!noteEditor.value) return;
      const lastChild =
        noteEditor.value.$el.querySelector('.ProseMirror')?.lastChild;
      if (!lastChild) return;
      if (
        !(
          document.body.scrollHeight >
          (window.innerHeight || document.documentElement.clientHeight)
        )
      )
        return;
      const selection = window.getSelection();
      if (!lastChild.contains(selection.anchorNode)) return;
      const range = selection.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      const lastRect = lastChild.getBoundingClientRect();
      const lineHeight = rect.height;
      const offset = Math.abs(rect.bottom - lastRect.bottom);
      if (lastRect.top + lastRect.height <= window.innerHeight) return;
      if (lineHeight === 0) lastChild.scrollIntoView();
      else if (offset < lineHeight) lastChild.scrollIntoView();
    }, 50);

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
          console.time(`[perf] convertNote ${n}`);
          noteStore.convertNote(n);
          console.timeEnd(`[perf] convertNote ${n}`);
        }
      },
      { immediate: true }
    );

    // Title / content handlers
    const handleTitleInput = debounce((event) => {
      return updateNote(id.value, { title: event.target.value });
    }, 150);

    function handleContentUpdate(content) {
      if (ydoc.value) return; // Yjs manages content persistence
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

        const seedContent = noteStore.getById(noteId)?.content;
        console.time(`[perf] yjsLoad ${noteId}`);
        yjsLoad(noteId, seedContent).catch((err) => {
          console.error('[yjs] Failed to load note:', err);
        }).finally(() => {
          console.timeEnd(`[perf] yjsLoad ${noteId}`);
        });
      },
      { immediate: true }
    );

    // Lifecycle
    const handleBeforeUnload = () => {
      void persistCurrentNote(editor.value, titleDiv.value, route.params.id);
    };
    let removeGlobalShortcuts = () => {};

    const scrollTitleIntoView = () => {
      const titleEl = titleDiv.value;
      if (!titleEl) return;
      const rect = titleEl.getBoundingClientRect();
      const stickyHeight = 56;
      if (rect.top < stickyHeight) {
        window.scrollTo({
          top: Math.max(0, window.scrollY + rect.top - stickyHeight),
          behavior: 'instant',
        });
      }
    };

    let removeEditorListeners = () => {};

    watch(editor, (ed) => {
      if (!ed) return;
      const dom = ed.view.dom;
      let isFirstFocus = true;

      const onFocus = () => {
        if (window.innerWidth >= 768) return;
        if (!isFirstFocus) return;
        isFirstFocus = false;
        setTimeout(scrollTitleIntoView, 350);
      };

      dom.addEventListener('focusin', onFocus);
      removeEditorListeners = () => dom.removeEventListener('focusin', onFocus);
    });

    onMounted(() => {
      removeGlobalShortcuts = bindGlobalShortcuts({
        'mod+f': () => {
          showSearch.value = true;
        },
        'alt+left': () => {
          if (!route.query.linked) return false;
          router.back();
        },
      });
      window.addEventListener('beforeunload', handleBeforeUnload);

      if (titleDiv.value && note.value.title) {
        titleDiv.value.value = note.value.title;
        autoResizeTitle();
      }
    });

    onUnmounted(() => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      removeGlobalShortcuts();
      removeEditorListeners();
    });

    onBeforeRouteLeave(() => {
      void persistCurrentNote(editor.value, titleDiv.value, route.params.id, {
        wait: false,
      });
      removeGlobalShortcuts();
    });

    addCloseHandler(async () => {
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

    function autoResizeTitle() {
      const el = titleDiv.value;
      if (!el) return;
      el.style.height = 'auto';
      el.style.height = el.scrollHeight + 'px';
    }

    watch(
      () => uiState.showPrompt.value,
      (n) => {
        if (!n) {
          focusEditor();
        }
      }
    );

    watch(
      () => note.value,
      async (newNote) => {
        if (!newNote) return;
        await nextTick();
        if (!titleDiv.value) return;
        const stored = newNote.title || '';
        if (titleDiv.value.value !== stored) {
          titleDiv.value.value = stored;
        }
        autoResizeTitle();
      },
      { immediate: true }
    );

    return {
      id,
      showBack,
      previousNote,
      titleDiv,
      goBack,
      goToPrevious,
      noteEditor,
      note,
      translations,
      uiState,
      unlockNote,
      unlockAppEncryption,
      appEncryptedLocked,
      editor,
      showSearch,
      handleTitleInput,
      handleContentUpdate,
      closeSearch,
      disallowedEnter,
      autoResizeTitle,
      autoScroll,
      isLocked,
      yjsReady,
      ydoc,
    };
  },
};
</script>

<style scoped>
.title-placeholder::placeholder {
  color: var(--text-muted);
}

.title-placeholder {
  field-sizing: content;
  max-height: 8em;
}

.editor {
  max-width: var(--selected-width);
}

.editor-skeleton-wrapper {
  min-height: calc(100dvh - 16rem);
}

.editor-skeleton {
  position: absolute;
  inset: 0;
}
</style>
