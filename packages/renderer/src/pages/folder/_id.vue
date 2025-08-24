<template>
  <div class="container py-5">
    <!-- Header Section -->
    <div class="flex flex-col gap-2 mb-6">
      <div class="flex items-center gap-3">
        <span v-if="folder.icon" class="text-2xl select-none">
          {{ folder.icon }}
        </span>
        <v-remixicon
          v-else
          name="riFolder5Fill"
          class="w-6 h-6"
          :style="{ color: folder.color || '#6B7280' }"
        />
        <h1 class="text-2xl md:text-3xl font-bold">
          {{ folder.name }}
        </h1>
      </div>

      <nav aria-label="Breadcrumb" class="text-sm text-neutral-500">
        <ol class="flex flex-wrap items-center gap-1">
          <li>
            <router-link to="/" class="hover:text-primary font-medium">
              {{ translations.index.home }}
            </router-link>
          </li>
          <template
            v-for="(pathFolder, index) in folderPath"
            :key="pathFolder?.id ?? index"
          >
            <li class="mx-1">/</li>
            <li>
              <router-link
                v-if="index < folderPath.length - 1 && pathFolder?.id"
                :to="`/folder/${pathFolder.id}`"
                class="hover:text-primary"
              >
                {{ pathFolder?.name || '...' }}
              </router-link>
              <span v-else class="font-medium text-neutral-900">
                {{ pathFolder?.name || '...' }}
              </span>
            </li>
          </template>
        </ol>
      </nav>
    </div>

    <!-- Filters and content below -->
    <home-search
      v-model:query="state.query"
      v-model:label="state.activeLabel"
      v-model:sort-by="state.sortBy"
      v-model:sort-order="state.sortOrder"
      v-bind="{ labels: labelStore.data, context: 'folder' }"
      @delete:label="deleteLabel"
    />

    <div
      v-if="
        folders.all.length ||
        notes.archived.length ||
        notes.bookmarked.length ||
        notes.all.length
      "
      class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4"
    >
      <!-- Render folders first -->
      <template v-if="folders.all.length">
        <p
          class="col-span-full text-neutral-600 dark:text-[color:var(--selected-dark-text)] capitalize mt-2"
        >
          {{ translations.index.folders }}
        </p>
        <home-folder-card
          v-for="folder in folders.all"
          :key="folder.id"
          :folder="folder"
          draggable="true"
          @dragstart="handleFolderDragStart($event, folder.id)"
          @dragend="handleDragEnd"
          @dragover="handleDragOver($event, folder.id)"
          @dragleave="handleDragLeave"
          @drop="handleDrop($event, folder.id)"
        />
      </template>

      <!-- Then render notes -->
      <template v-for="name in ['archived', 'bookmarked', 'all']" :key="name">
        <p
          v-if="notes[name].length !== 0"
          class="col-span-full text-neutral-600 dark:text-[color:var(--selected-dark-text)] capitalize"
          :class="{ 'mt-2': name === 'all' }"
        >
          {{ name === 'all' ? '' : translations.index[name] }}
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
          @update:label="state.activeLabel = $event"
          @update="noteStore.update(note.id, $event)"
          @dragstart="handleNoteDragStart($event, note.id)"
          @dragend="handleDragEnd"
        />
      </template>
    </div>

    <div v-else class="text-center items-center justify-center h-full">
      <img :src="FolderImg" class="mx-auto w-1/4" />
      <p
        class="w-sm mx-auto dark:text-[color:var(--selected-dark-text)] text-neutral-600 mt-2"
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
import HomeSearch from '@/components/home/HomeSearch.vue';
import KeyboardNavigation from '@/utils/keyboard-navigation';
import FolderImg from '@/assets/images/folder.png';
import HomeFolderCard from '@/components/home/HomeFolderCard.vue';
import { useFolderStore } from '@/store/folder';
import dayjs from 'dayjs';

export default {
  components: { HomeNoteCard, HomeSearch, HomeFolderCard },
  setup() {
    const folderId = computed(() => route.params.id);
    const currentFolderId = computed(() => route.params.id);
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
    const draggedFolderId = ref(null);
    const dragType = ref(null);
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
      const childFolders = folderStore.folders.filter(
        (f) =>
          f.parentId === currentFolderId.value && !folderStore.deletedIds[f.id]
      );

      return {
        all: filterFolders(childFolders),
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

        if (folderId !== currentFolderId.value) {
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

    function filterFolders(folders) {
      return folders.filter((folder) => {
        const queryLower = state.query.toLocaleLowerCase();
        const matchesQuery = folder.name
          .toLocaleLowerCase()
          .includes(queryLower);

        return matchesQuery;
      });
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

    const folder = computed(() => {
      if (!folderId.value) return null;
      return folderStore.getById(folderId.value) ?? null;
    });

    const childFolders = computed(() => {
      if (!folderId.value) return [];
      return folderStore
        .getByParent(folderId.value)
        .filter((f) => f?.id && !folderStore.deletedIds[f.id])
        .sort((a, b) => a.name.localeCompare(b.name));
    });

    const notesInFolder = computed(() => {
      if (!folderId.value) return [];
      return noteStore
        .getByFolder(folderId.value)
        .filter((note) => note && typeof note === 'object' && note.id)
        .sort((a, b) => b.updatedAt - a.updatedAt);
    });

    const folderPath = computed(() => {
      if (!folderId.value) return [];
      return folderStore.getFolderPath(folderId.value) || [];
    });

    function formatDate(date) {
      return date ? dayjs(date).format('MMMM D, YYYY') : 'Unknown date';
    }

    function updateNote(noteId, updates) {
      if (!noteId) return;
      noteStore.update(noteId, updates);
    }

    function handleNoteDragStart(event, noteId) {
      event.dataTransfer.setData(
        'application/json',
        JSON.stringify({
          type: 'note',
          id: noteId,
        })
      );
      draggedNoteId.value = noteId;
      dragType.value = 'note';

      // Set drag image
      event.dataTransfer.effectAllowed = 'move';
    }

    function handleFolderDragStart(event, folderId) {
      event.dataTransfer.setData(
        'application/json',
        JSON.stringify({
          type: 'folder',
          id: folderId,
        })
      );
      draggedFolderId.value = folderId;
      dragType.value = 'folder';

      // Set drag image
      event.dataTransfer.effectAllowed = 'move';
    }

    function handleDragOver(event, folderId) {
      event.preventDefault();

      // Only show drop indicator if it's a valid drop target
      const dragData = event.dataTransfer.types.includes('application/json');
      if (!dragData) return;

      // If dragging a folder, check for circular reference
      if (dragType.value === 'folder' && draggedFolderId.value) {
        if (
          folderStore.wouldCreateCircularReference(
            draggedFolderId.value,
            folderId
          )
        ) {
          event.dataTransfer.dropEffect = 'none';
          return;
        }
      }

      dragOverFolderId.value = folderId;
      event.dataTransfer.dropEffect = 'move';
    }

    function handleDragLeave(event) {
      // Only clear if we're actually leaving the folder area
      if (!event.currentTarget.contains(event.relatedTarget)) {
        dragOverFolderId.value = null;
      }
    }

    function handleDrop(event, targetFolderId) {
      event.preventDefault();

      try {
        const dragData = JSON.parse(
          event.dataTransfer.getData('application/json')
        );

        if (dragData.type === 'note') {
          // Move note to folder
          noteStore.update(dragData.id, { folderId: targetFolderId });
        } else if (dragData.type === 'folder') {
          // Move folder inside another folder
          if (
            !folderStore.wouldCreateCircularReference(
              dragData.id,
              targetFolderId
            )
          ) {
            folderStore.update(dragData.id, { parentId: targetFolderId });
          }
        }
      } catch (error) {
        console.error('Error handling drop:', error);
      }

      handleDragEnd();
    }

    function handleDragEnd() {
      dragOverFolderId.value = null;
      draggedNoteId.value = null;
      draggedFolderId.value = null;
      dragType.value = null;
    }

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
      FolderImg,
      theme,
      folderId,
      folder,
      childFolders,
      notesInFolder,
      folderPath,
      formatDate,
      updateNote,
      dragOverFolderId,
      draggedNoteId,
      draggedFolderId,
      handleNoteDragStart,
      handleFolderDragStart,
      handleDragOver,
      handleDragLeave,
      handleDrop,
      handleDragEnd,
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

/* Optional: You can add a custom background or other styles for the checked state */
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
