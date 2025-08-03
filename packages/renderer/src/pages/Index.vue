<!-- eslint-disable vue/multi-word-component-names -->
<template>
  <div class="container py-5">
    <h1 class="text-3xl mb-8 font-bold">
      {{ translations.sidebar.notes || '-' }}
    </h1>
    <home-note-filter
      v-model:query="state.query"
      v-model:label="state.activeLabel"
      v-model:sort-by="state.sortBy"
      v-model:sort-order="state.sortOrder"
      v-bind="{
        labels: labelStore.data,
      }"
      @delete:label="deleteLabel"
    />

    <div
      v-if="
        noteStore.notes.length !== 0 || folderStore.rootFolders.length !== 0
      "
      class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4"
    >
      <template v-if="folders.all.length">
        <p
          class="col-span-full text-gray-600 dark:text-[color:var(--selected-dark-text)] capitalize mt-2"
        >
          Folders
        </p>
        <home-folder-card
          v-for="folder in folders.all"
          :key="folder.id"
          :folder="folder"
          :class="{
            'ring-2 ring-blue-400 bg-blue-50 dark:bg-blue-900':
              dragOverFolderId === folder.id,
          }"
          @dragover.prevent="dragOverFolderId = folder.id"
          @dragleave="dragOverFolderId = null"
          @drop="handleDrop($event, folder.id)"
        />
      </template>
    </div>

    <div
      v-if="
        noteStore.notes.length !== 0 || folderStore.rootFolders.length !== 0
      "
      class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4"
    >
      <template
        v-for="name in $route.query.archived
          ? ['archived']
          : ['bookmarked', 'all']"
        :key="name"
      >
        <p
          v-if="notes[name].length !== 0"
          class="col-span-full text-gray-600 dark:text-[color:var(--selected-dark-text)] capitalize mt-2"
        >
          {{ translations.index[name] }}
        </p>
        <home-note-card
          v-for="note in notes[name]"
          :key="note.id"
          :note-id="note.id"
          :is-locked="note.isLocked"
          v-bind="{ note }"
          :class="{
            'opacity-50 transform rotate-2': draggedNoteId === note.id,
          }"
          draggable="true"
          @dragstart="handleDragStart($event, note.id)"
          @dragend="draggedNoteId = null"
          @update:label="state.activeLabel = $event"
          @update="noteStore.update(note.id, $event)"
        />
      </template>
    </div>

    <div v-else class="text-center">
      <img
        :src="theme.currentTheme.value === 'dark' ? BeaverDark : Beaver"
        class="mx-auto w-2/4"
      />

      <p
        class="max-w-md mx-auto dark:text-[color:var(--selected-dark-text)] text-gray-600 mt-2"
      >
        {{ translations.index.newNote || '-' }}
      </p>
    </div>
  </div>
</template>

<script>
import {
  computed,
  reactive,
  watch,
  ref,
  shallowRef,
  onMounted,
  onUnmounted,
} from 'vue';
import { useTranslation } from '@/composable/translations';
import { useRoute, useRouter } from 'vue-router';
import { useTheme } from '@/composable/theme';
import { useNoteStore } from '@/store/note';
import { useLabelStore } from '@/store/label';
import { useDialog } from '@/composable/dialog';
import { sortArray, extractNoteText } from '@/utils/helper';
import HomeNoteCard from '@/components/home/HomeNoteCard.vue';
import HomeNoteFilter from '@/components/home/HomeNoteFilter.vue';
import KeyboardNavigation from '@/utils/keyboard-navigation';
import Beaver from '@/assets/images/Beaver.png';
import BeaverDark from '@/assets/images/Beaver-dark.png';
import HomeFolderCard from '../components/home/HomeFolderCard.vue';
import { useFolderStore } from '../store/folder';

export default {
  components: { HomeNoteCard, HomeNoteFilter, HomeFolderCard },
  setup() {
    const disableDialog = ref(false);
    const theme = useTheme();

    const route = useRoute();
    const router = useRouter();
    const noteStore = useNoteStore();
    const folderStore = useFolderStore();
    const labelStore = useLabelStore();
    const dialog = useDialog();

    const keyboardNavigation = shallowRef(null);
    const dragOverFolderId = ref(null);
    const draggedNoteId = ref(null);

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

    const folders = computed(() => {
      const rootFolders = folderStore.rootFolders.filter(
        (f) => !folderStore.deletedIds[f.id]
      );

      return {
        all: rootFolders,
        bookmarked: [],
        archived: [],
      };
    });

    function filterNotes(notes) {
      const filteredNotes = {
        all: [],
        archived: [],
        bookmarked: [],
      };

      notes.forEach((note) => {
        let { title, content, isArchived, isBookmarked, labels, folderId } =
          note;

        if (folderId !== null && folderId !== undefined) {
          return;
        }

        labels = labels.sort((a, b) => a.localeCompare(b));

        const labelFilter = state.activeLabel
          ? labels.includes(state.activeLabel)
          : true;

        const queryLower = state.query.toLocaleLowerCase();
        const isMatch = queryLower.startsWith('#')
          ? labels.some((label) =>
              label.toLocaleLowerCase().includes(queryLower.substr(1))
            )
          : labels.some((label) =>
              label.toLocaleLowerCase().includes(queryLower)
            ) ||
            title.toLocaleLowerCase().includes(queryLower) ||
            content.toLocaleLowerCase().includes(queryLower);

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

    function handleDragStart(event, noteId) {
      event.dataTransfer.setData('text/plain', noteId);
      draggedNoteId.value = noteId;
    }

    function handleDrop(event, folderId) {
      event.preventDefault();
      const noteId = event.dataTransfer.getData('text/plain');
      if (noteId) {
        noteStore.update(noteId, { folderId });
      }
      dragOverFolderId.value = null;
      draggedNoteId.value = null;
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

          if (key === 'Enter') {
            router.push(`/note/${noteId}`);
          } else if (key === 'Backspace' || key === 'Delete') {
            dialog.confirm({
              title: translations.value.card.confirmPrompt,
              okText: translations.value.card.confirm,
              cancelText: translations.value.card.cancel,
              onConfirm: async () => {
                await noteStore.delete(noteId);
              },
            });
          }
        }
      );
    });

    onUnmounted(() => {
      keyboardNavigation.value.destroy();
    });

    const translations = ref({
      sidebar: {},
      index: {},
    });

    onMounted(async () => {
      await useTranslation().then((trans) => {
        if (trans) {
          translations.value = trans;
        }
      });
    });

    return {
      notes,
      state,
      noteStore,
      folderStore,
      labelStore,
      translations,
      folders,
      deleteLabel,
      disableDialog,
      Beaver,
      BeaverDark,
      theme,
      dragOverFolderId,
      draggedNoteId,
      handleDragStart,
      handleDrop,
    };
  },
};
</script>

<style>
input[type='checkbox'] {
  appearance: none;
  -webkit-appearance: none;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  border: 2px solid #ccc;
  outline: none;
  cursor: pointer;
  transition: border-color 0.3s;
  vertical-align: middle;
}

input[type='checkbox']:checked {
  border-color: #fbbf24;
}

input[type='checkbox']:checked::before {
  content: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' width='16' height='16'%3E%3Cpath d='M10.0007 15.1709L19.1931 5.97852L20.6073 7.39273L10.0007 17.9993L3.63672 11.6354L5.05093 10.2212L10.0007 15.1709Z' fill='rgba(251,191,36,1)'%3E%3C/path%3E%3C/svg%3E");
  display: block;
  width: 100%;
  height: 100%;
  font-size: 16px;
  line-height: 20px;
  text-align: center;
  color: #fbbf24;
}

[draggable='true'] {
  cursor: grab;
  transition: all 0.2s ease;
}

[draggable='true']:active {
  cursor: grabbing;
}
</style>

<style lang="scss">
@use 'sass:math';
.tiptap {
  > * + * {
    margin-top: 0.75em;
  }
}

.iframe-wrapper {
  position: relative;
  padding-bottom: math.div(100, 16) * 9%;
  height: 0;
  overflow: hidden;
  width: 100%;
  height: auto;

  &.ProseMirror-selectednode {
    outline: 3px solid #fbbf24;
  }

  iframe {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
  }
}
</style>
