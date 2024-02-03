<template>
  <div v-if="note" class="max-w-3xl mx-auto relative pb-6 px-4 lg:px-0">
    <button
      v-if="$route.query.linked && !store.inFocusMode"
      class="left-0 ml-24 mt-4 fixed group"
      title="Alt+Arrow left"
      @click="$router.back()"
    >
      <v-remixicon
        name="riArrowDownLine"
        class="mr-2 -ml-1 group-hover:-translate-x-1 transform transition rotate-90"
      />
      <span>
        {{ translations._idvue.Previousnote || '-' }}
      </span>
    </button>
    <template v-if="editor">
      <note-menu v-bind="{ editor, id }" class="mb-6" />
      <note-search
        v-if="showSearch"
        v-bind="{ editor }"
        @keyup.esc="closeSearch"
      />
    </template>
    <div
      contenteditable="true"
      :value="note.title"
      class="text-4xl outline-none block font-bold bg-transparent w-full mb-6 cursor-text title-placeholder"
      :placeholder="translations._idvue.untitlednote || '-'"
      @input="updateNote({ title: $event.target.innerText })"
      @keydown="disallowedEnter"
    >
      {{ note.title }}
    </div>

    <note-editor
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
import { useLabelStore } from '@/store/label';
import { useStore } from '@/store';
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

    const editor = shallowRef(null);
    const noteEditor = ref();
    const showSearch = shallowRef(false);

    const id = computed(() => route.params.id);
    const note = computed(() => noteStore.getById(id.value));

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
      noteEditor.value.$el.querySelector('*[tabindex="0"]').focus();
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

    return {
      id,
      noteEditor,
      note,
      translations,
      store,
      editor,
      showSearch,
      updateNote,
      closeSearch,
      disallowedEnter,
      autoScroll,
    };
  },
};
</script>
<style scoped>
.title-placeholder:empty::before {
  content: attr(placeholder);
  color: #a1a1aa;
}
</style>
