<template>
  <div
    v-if="note"
    class="editor mx-auto relative px-4 lg:px-0 pb-6"
    :style="{ 'padding-bottom': isLocked ? 0 : null }"
  >
    <button
      v-if="
        (showBack && !store.inReaderMode) ||
        ($route.query.linked && !store.inReaderMode)
      "
      class="ltr:left-0 rtl:right-0 ml-24 mt-4 fixed group print:hidden"
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

    <template v-if="editor && !note.isLocked">
      <note-menu v-bind="{ editor, id, note }" class="mb-6" />
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
    </template>
    <div
      v-if="!isLocked"
      ref="titleDiv"
      data-testid="note-title-input"
      contenteditable="true"
      class="text-5xl outline-none block font-bold bg-transparent w-full mb-6 cursor-text title-placeholder"
      :placeholder="translations.editor.untitledNote"
      @input="updateNote({ title: $event.target.innerText })"
      @keydown="disallowedEnter"
    ></div>
    <div v-else class="flex flex-col items-center justify-center h-screen">
      <v-remixicon
        class="w-24 h-auto text-gray-600 dark:text-white"
        name="riLockLine"
      />
      <p class="text-center pb-2 text-gray-600 dark:text-gray-200">
        {{ translations.card.unlockToEdit }}
      </p>
      <div class="pb-2">
        <button
          class="ui-button py-2 text-center h-10 relative transition focus:ring-1 ring-secondary bg-input py-2 px-3 rounded-lg w-64"
          @click="unlockNote(note.id)"
        >
          {{ translations.card.unlock }}
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
        updateNote({ content: $event });
      "
      @init="editor = $event"
      @keyup.down="autoScroll"
    />
  </div>
</template>

<script>
import { ref, shallowRef, computed, watch, onMounted, onUnmounted } from 'vue';
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
import Mousetrap from '@/lib/mousetrap';
import NoteEditor from '@/components/note/NoteEditor.vue';
import NoteMenu from '@/components/note/NoteMenu.vue';
import NoteSearch from '@/components/note/NoteSearch.vue';
import { useAppStore } from '../../store/app';

export default {
  components: { NoteEditor, NoteMenu, NoteSearch },
  setup() {
    const store = useStore();
    const route = useRoute();
    const router = useRouter();
    const storage = useStorage();
    const noteStore = useNoteStore();
    const labelStore = useLabelStore();
    const appStore = useAppStore();
    const dialog = useDialog();

    const editor = shallowRef(null);
    const noteEditor = ref();
    const showSearch = shallowRef(false);

    const id = computed(() => route.params.id);
    const note = computed(() => noteStore.getById(id.value));
    const isLocked = computed(() => note.value && note.value.isLocked);
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

    async function persistCurrentNote(noteId = route.params.id) {
      if (!noteId || !noteStore.getById(noteId)) return;

      const labels = new Set();
      const labelEls =
        editor.value?.options.element.querySelectorAll('[data-mention]') ?? [];

      Array.from(labelEls).forEach((el) => {
        const labelId = el.dataset.id;
        if (labelStore.data.includes(labelId)) labels.add(labelId);
      });

      const currentContent = editor.value?.getJSON();
      const currentTitle = titleDiv.value?.innerText ?? '';

      await noteStore.update(noteId, {
        labels: [...labels],
        ...(currentContent ? { content: currentContent } : {}),
        ...(currentTitle !== undefined ? { title: currentTitle } : {}),
      });
    }

    const updateNote = (data) => {
      const noteId = note.value?.id || route.params.id;
      if (!noteId || !noteStore.getById(noteId)) return Promise.resolve();

      Object.assign(data, { updatedAt: Date.now() });
      return noteStore.update(noteId, data);
    };

    function closeSearch() {
      showSearch.value = false;
    }

    watch(
      () => route.params.id,
      (noteId, oldNoteId) => {
        if (oldNoteId && noteStore.getById(oldNoteId)) {
          noteStore.update(oldNoteId, {
            lastCursorPosition: editor.value?.state.selection.to,
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

    onMounted(() => {
      Mousetrap.bind(['mod+f', 'alt+left'], (event, combo) => {
        if (combo === 'mod+f') {
          document.querySelector('.editor-search input')?.focus();

          showSearch.value = true;
        } else if (route.query.linked) {
          router.back();
        }
      });
      window.addEventListener('beforeunload', handleBeforeUnload);
    });

    onUnmounted(() => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    });
    onBeforeRouteLeave(async () => {
      await persistCurrentNote(route.params.id);
      Mousetrap.unbind('mod+f');
    });

    onClose(async () => {
      await persistCurrentNote(route.params.id);
    });

    const focusEditor = () =>
      noteEditor.value?.$el?.querySelector('*[tabindex="0"]')?.focus();
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
                console.log('test');
                await noteStore.unlockNote(note, enteredPassword);
                await passwordStore.setsharedKey(enteredPassword);
              } catch (error) {
                alert(translations.value.card.wrongPasswd);
                return;
              }
            } else {
              const isValidPassword = await passwordStore.isValidPassword(
                enteredPassword
              );
              if (isValidPassword) {
                await noteStore.unlockNote(note, enteredPassword);
              } else {
                alert(translations.value.card.wrongPasswd);
              }
            }
          } catch (error) {
            console.error('Error unlocking note:', error);
            alert(translations.value.card.wrongPasswd);
          }
        },
      });
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
      editor,
      showSearch,
      updateNote,
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
  --selected-width: '54rem';
}

.editor {
  max-width: var(--selected-width);
}
</style>
