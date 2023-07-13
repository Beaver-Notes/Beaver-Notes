<template>
  <div class="container py-5">
    <h1 class="text-3xl mb-8 font-bold">Notes</h1>
    <home-note-filter
      v-model:query="state.query"
      v-model:label="state.activeLabel"
      v-model:sortBy="state.sortBy"
      v-model:sortOrder="state.sortOrder"
      v-bind="{
        labels: labelStore.data,
      }"
      @delete:label="deleteLabel"
    />
    <div
      v-if="noteStore.notes.length !== 0"
      class="
        grid grid-cols-1
        md:grid-cols-2
        lg:grid-cols-3
        xl:grid-cols-4
        gap-4
      "
    >
      <template
        v-for="name in $route.query.archived
          ? ['archived']
          : ['bookmarked', 'all']"
        :key="name"
      >
        <p
          v-if="notes[name].length !== 0"
          class="col-span-full text-gray-600 dark:text-gray-200 capitalize"
          :class="{ 'mt-2': name === 'all' }"
        >
          {{ name }}
        </p>
        <home-note-card
          v-for="note in notes[name]"
          :key="note.id"
          :note-id="note.id"
          v-bind="{ note }"
          @update:label="state.activeLabel = $event"
          @delete="noteStore.delete(note.id)"
          @update="noteStore.update(note.id, $event)"
        />
      </template>
    </div>
    <div v-else class="text-center">
      <img src="../assets/svg/Notes_Outline.svg" class="mx-auto" />
      <h1 class="text-xl">It looks like you don't have a note</h1>
      <p class="max-w-md mx-auto dark:text-gray-300 text-gray-600 mt-2">
        To create a new note, you can press <kbd>Ctrl</kbd> + <kbd>N</kbd> or
        click the <kbd>+</kbd> button on top left
      </p>
    </div>
  </div>
</template>
<script>
import {
  computed,
  reactive,
  watch,
  shallowRef,
  onMounted,
  onUnmounted,
} from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useNoteStore } from '@/store/note';
import { useLabelStore } from '@/store/label';
import { sortArray, extractNoteText } from '@/utils/helper';
import HomeNoteCard from '@/components/home/HomeNoteCard.vue';
import HomeNoteFilter from '@/components/home/HomeNoteFilter.vue';
import KeyboardNavigation from '@/utils/keyboard-navigation';

export default {
  components: { HomeNoteCard, HomeNoteFilter },
  setup() {
    const route = useRoute();
    const router = useRouter();
    const noteStore = useNoteStore();
    const labelStore = useLabelStore();

    const keyboardNavigation = shallowRef(null);
    const state = reactive({
      notes: [],
      query: '',
      activeLabel: '',
      sortBy: 'createdAt',
      sortOrder: 'asc',
    });

    const sortedNotes = computed(() =>
      sortArray({
        data: state.notes,
        order: state.sortOrder,
        key: state.sortBy,
      })
    );
    const notes = computed(() => filterNotes(sortedNotes.value));

    function filterNotes(notes) {
      const filteredNotes = {
        all: [],
        archived: [],
        bookmarked: [],
      };

      notes.forEach((note) => {
        const { title, content, isArchived, isBookmarked, labels } = note;
        const labelFilter = state.activeLabel
          ? labels.includes(state.activeLabel)
          : true;

        const isMatch = state.query.startsWith('#')
          ? labels.some((label) =>
              label.toLocaleLowerCase().includes(state.query.substr(1))
            )
          : title.toLocaleLowerCase().includes(state.query) ||
            content.includes(state.query);

        if (isMatch && labelFilter) {
          if (isArchived) return filteredNotes.archived.push(note);

          isBookmarked
            ? filteredNotes.bookmarked.push(note)
            : filteredNotes.all.push(note);
        }
      });

      return filteredNotes;
    }
    function extractNoteContent(note) {
      const text = extractNoteText(note.content.content).toLocaleLowerCase();

      return { ...note, content: text };
    }
    function deleteLabel(id) {
      labelStore.delete(id).then(() => {
        state.activeLabel = '';
      });
    }

    watch(
      () => noteStore.data,
      () => {
        state.notes = noteStore.notes.map(extractNoteContent);
      },
      { immediate: true, deep: true }
    );
    watch(
      () => route.query.label,
      (label) => {
        if (label) {
          state.activeLabel = decodeURIComponent(label);
        }
      },
      { immediate: true }
    );
    watch(
      () => [state.sortBy, state.sortOrder],
      ([sortBy, sortOrder]) => {
        localStorage.setItem(
          'sort-notes',
          JSON.stringify({ sortBy, sortOrder })
        );
      }
    );
    watch(notes, () => {
      setTimeout(() => {
        keyboardNavigation.value.refresh();
      }, 250);
    });

    onMounted(() => {
      const sortState = JSON.parse(localStorage.getItem('sort-notes'));

      if (sortState) {
        Object.assign(state, sortState);
      }

      keyboardNavigation.value = new KeyboardNavigation({
        itemSelector: '.note-card',
        activeClass: 'ring-2 active-note',
        breakpoints: {
          default: 1,
          '(min-width: 768px)': 2,
          '(min-width: 1024px)': 3,
          '(min-width: 1280px)': 4,
        },
      });

      keyboardNavigation.value.on(
        'keydown',
        ({ event: { key }, activeItem }) => {
          const noteId = activeItem?.getAttribute('note-id');

          if (!activeItem || !noteId) return;

          if (key === 'Enter') router.push(`/note/${noteId}`);
          else if (key === 'Backspace' || key === 'Delete')
            noteStore.delete(noteId);
        }
      );
    });
    onUnmounted(() => {
      keyboardNavigation.value.destroy();
    });

    return {
      notes,
      state,
      noteStore,
      labelStore,
      deleteLabel,
    };
  },
};
</script>
