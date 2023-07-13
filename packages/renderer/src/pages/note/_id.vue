<template>
  <div v-if="note" class="max-w-3xl mx-auto relative px-4 lg:px-0">
    <button
      v-if="$route.query.linked && !store.inFocusMode"
      class="left-0 ml-24 mt-4 fixed group"
      title="Alt+Arrow left"
      @click="$router.back()"
    >
      <v-remixicon
        name="riArrowDownLine"
        class="
          mr-2
          -ml-1
          group-hover:-translate-x-1
          transform
          transition
          rotate-90
        "
      />
      <span>Previous note</span>
    </button>
    <template v-if="editor">
      <note-menu v-bind="{ editor }" class="mb-6" />
      <note-search
        v-if="showSearch"
        v-bind="{ editor }"
        @keyup.esc="closeSearch"
      />
    </template>
    <input
      :value="note.title"
      class="text-4xl block font-bold bg-transparent w-full mb-6"
      placeholder="Untitled note"
      @input="updateNote({ title: $event.target.value })"
    />
    <note-editor
      :id="$route.params.id"
      :key="$route.params.id"
      :model-value="note.content"
      :cursor-position="note.lastCursorPosition"
      @update="updateNote({ content: $event })"
      @init="editor = $event"
    />
  </div>
</template>
<script>
import { shallowRef, computed, watch, onMounted } from 'vue';
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
    const showSearch = shallowRef(false);

    const note = computed(() => noteStore.getById(route.params.id));

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

    return {
      note,
      store,
      editor,
      showSearch,
      updateNote,
      closeSearch,
    };
  },
};
</script>
