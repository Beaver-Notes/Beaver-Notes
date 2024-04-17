<template>
  <div
    v-if="note"
    class="editor mx-auto relative px-4 lg:px-0 pb-6"
    :style="{ 'padding-bottom': isLocked ? 0 : null }"
  >
    <button
      v-if="$route.query.linked && !store.inFocusMode"
      class="ltr:left-0 rtl:right-0 ml-24 mt-4 fixed group"
      title="Alt+Arrow left"
      @click="$router.back()"
    >
      <v-remixicon
        name="riArrowDownLine"
        class="mr-2 -ml-1 rtl:ml-0 group-hover:-translate-x-1 transform transition rotate-90 rtl:-rotate-90"
      />
      <span>
        {{ translations._idvue.Previousnote || '-' }}
      </span>
    </button>
    <template v-if="editor && !note.isLocked">
      <note-menu v-bind="{ editor, id }" class="mb-6" />
      <note-search
        v-if="showSearch"
        v-bind="{ editor }"
        @keyup.esc="closeSearch"
      />
    </template>
    <div
      v-if="!isLocked"
      contenteditable="true"
      :value="note.title"
      class="text-4xl outline-none block font-bold bg-transparent w-full mb-6 cursor-text title-placeholder"
      :placeholder="translations._idvue.untitlednote || '-'"
      @input="updateNote({ title: $event.target.innerText })"
      @keydown="disallowedEnter"
    >
      {{ note.title }}
    </div>
    <div v-else class="flex flex-col items-center justify-center h-screen">
      <v-remixicon
        class="w-24 h-auto text-gray-600 dark:text-white"
        name="riLockLine"
      />
      <p class="text-center pb-2 text-gray-600 dark:text-gray-200">
        {{ translations.card.unlocktoedit }}
      </p>
      <div class="pb-2">
        <button
          class="ui-button py-2 text-center h-10 relative transition focus:ring-2 ring-amber-300 bg-input py-2 px-3 rounded-lg w-64"
          @click="unlockNote(note.id)"
        >
          {{ translations.card.unlock }}
        </button>
      </div>
      <router-link
        class="ui-button py-2 text-center h-10 relative transition focus:ring-2 ring-amber-300 bg-input py-2 px-3 rounded-lg w-64"
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
import {
  ref,
  shallowRef,
  computed,
  watch,
  onMounted,
  shallowReactive,
} from 'vue';
import { useRouter, onBeforeRouteLeave, useRoute } from 'vue-router';
import { useNoteStore } from '@/store/note';
import { usePasswordStore } from '@/store/passwd';
import { useLabelStore } from '@/store/label';
import { useStore } from '@/store';
import { useDialog } from '@/composable/dialog';
import { useStorage } from '@/composable/storage';
import { debounce } from '@/utils/helper';
import Mousetrap from '@/lib/mousetrap';
import NoteEditor from '@/components/note/NoteEditor.vue';
import NoteMenu from '@/components/note/NoteMenu.vue';
import NoteSearch from '@/components/note/NoteSearch.vue';

export default {
  components: { NoteEditor, NoteMenu, NoteSearch },
  setup() {
    const store = useStore();
    const route = useRoute();
    const router = useRouter();
    const storage = useStorage();
    const noteStore = useNoteStore();
    const labelStore = useLabelStore();
    const dialog = useDialog();
    const userPassword = ref('');

    const editor = shallowRef(null);
    const noteEditor = ref();
    const showSearch = shallowRef(false);

    const id = computed(() => route.params.id);
    const note = computed(() => noteStore.getById(id.value));
    const isLocked = computed(() => note.value && note.value.isLocked);

    const autoScroll = debounce(() => {
      if (!noteEditor.value) {
        return;
      }
      const lastChild =
        noteEditor.value.$el.querySelector('.ProseMirror').lastChild;
      // does scrollbar appear
      if (
        !(
          document.body.scrollHeight >
          (window.innerHeight || document.documentElement.clientHeight)
        )
      ) {
        return;
      }
      const selection = window.getSelection();
      // the anchorNode must be the child of the last child or is the last child.
      if (!lastChild.contains(selection.anchorNode)) {
        return;
      }
      const range = selection.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      const lastRect = lastChild.getBoundingClientRect();

      const lineHeight = rect.height;

      const offset = Math.abs(rect.bottom - lastRect.bottom);
      // editor must fill the viewport
      if (lastRect.top + lastRect.height <= window.innerHeight) {
        return;
      }
      if (lineHeight === 0) {
        // empty line
        lastChild.scrollIntoView();
      } else if (offset < lineHeight) {
        // the offset of last line will not exceed the line height
        lastChild.scrollIntoView();
      }
    }, 50);

    const updateNote = debounce((data) => {
      Object.assign(data, { updatedAt: Date.now() });

      noteStore.update(note.value.id, data);
    }, 250);

    function closeSearch() {
      showSearch.value = false;
      editor.value.commands.focus();
    }

    watch(
      () => route.params.id,
      (noteId, oldNoteId) => {
        if (oldNoteId) {
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

    onMounted(() => {
      Mousetrap.bind(['mod+f', 'alt+left'], (event, combo) => {
        if (combo === 'mod+f') {
          document.querySelector('.editor-search input')?.focus();

          showSearch.value = true;
        } else if (route.query.linked) {
          router.back();
        }
      });
    });
    onBeforeRouteLeave(() => {
      const labels = new Set();
      const labelEls =
        editor.value?.options.element.querySelectorAll('[data-mention]') ?? [];

      Array.from(labelEls).forEach((el) => {
        const labelId = el.dataset.id;

        if (labelStore.data.includes(labelId)) labels.add(labelId);
      });

      noteStore.update(route.params.id, {
        labels: [...labels],
      });

      Mousetrap.unbind('mod+f');
    });

    // Translations
    const translations = shallowReactive({
      _idvue: {
        Previousnote: '_idvue.Previousnote',
        untitlednote: '_idvue.untitlednote',
      },
      card: {
        unlocktoedit: 'card.unlocktoedit',
        unlock: 'card.unlock',
      },
      index: {
        close: 'index.close',
      },
    });

    onMounted(async () => {
      // Load translations
      const loadedTranslations = await loadTranslations();
      if (loadedTranslations) {
        Object.assign(translations, loadedTranslations);
      }
    });

    const loadTranslations = async () => {
      const selectedLanguage = localStorage.getItem('selectedLanguage') || 'en';
      try {
        const translationModule = await import(
          `../settings/locales/${selectedLanguage}.json`
        );
        return translationModule.default;
      } catch (error) {
        console.error('Error loading translations:', error);
        return null;
      }
    };

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
        title: translations.card.enterpasswd,
        okText: translations.card.unlock,
        cancelText: translations.card.Cancel,
        placeholder: translations.card.Password,
        onConfirm: async (enteredPassword) => {
          try {
            const isValidPassword = await passwordStore.isValidPassword(
              enteredPassword
            );
            if (isValidPassword) {
              console.log(translations.card.Passwordcorrect);
              // Note unlocked
              userPassword.value = '';
              await noteStore.unlockNote(note, enteredPassword); // Pass entered password to unlockNote
              console.log(`Note (ID: ${note}) is unlocked`);
            } else {
              console.log(translations.card.Passwordcorrect);
              alert(translations.card.wrongpasswd);
            }
          } catch (error) {
            console.error('Error unlocking note:', error);
            alert(translations.card.wrongpasswd);
          }
        },
      });
    }

    return {
      id,
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
  --selected-width: '48rem';
}

.editor {
  max-width: var(--selected-width);
}
</style>
