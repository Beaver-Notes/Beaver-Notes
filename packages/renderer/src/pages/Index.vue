<!-- eslint-disable vue/multi-word-component-names -->
<template>
  <div class="container py-5">
    <h1 class="text-3xl mb-8 font-bold">
      {{ translations.sidebar.notes || '-' }}
    </h1>
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
        noteStore.notes.length !== 0 || folderStore.rootFolders.length !== 0
      "
      class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 items-stretch"
    >
      <template v-if="folders.all.length">
        <p
          class="col-span-full text-gray-600 dark:text-[color:var(--selected-dark-text)] capitalize mt-2"
        >
          {{ translations.index.folders }}
        </p>
        <div v-for="folder in folders.all" :key="folder.id" :min-height="120">
          <home-folder-card
            :key="folder.id"
            :folder="folder"
            :class="{
              'ring-2 ring-secondary':
                dragOverFolderId === folder.id ||
                (state.query && highlightedFolderIds.has(folder.id)),
              'opacity-50 transform rotate-1': draggedFolderId === folder.id,
            }"
            draggable="true"
            @dragstart="handleFolderDragStart($event, folder.id)"
            @dragend="handleDragEnd"
            @dragover="handleDragOver($event, folder.id)"
            @dragleave="handleDragLeave"
            @drop="handleDrop($event, folder.id)"
          />
        </div>
      </template>
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

        <div
          v-for="note in notes[name]"
          :key="note.id"
          :min-height="180"
          :unrender="true"
        >
          <home-note-card
            :key="note.id"
            :note-id="note.id"
            :is-locked="note.isLocked"
            v-bind="{ note }"
            :class="{
              'opacity-50 transform rotate-2': draggedNoteId === note.id,
            }"
            class="h-full"
            draggable="true"
            @dragstart="handleNoteDragStart($event, note.id)"
            @dragend="handleDragEnd"
            @update:label="state.activeLabel = $event"
            @update="noteStore.update(note.id, $event)"
          />
        </div>
      </template>
    </div>

    <div v-else class="text-center">
      <img
        :src="$route.query.archived === 'true' ? ArchiveImg : HomeImg"
        class="mx-auto w-1/4"
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
import KeyboardNavigation from '@/utils/keyboard-navigation';
import HomeImg from '@/assets/images/home.png';
import ArchiveImg from '@/assets/images/archive.png';
import HomeFolderCard from '../components/home/HomeFolderCard.vue';
import { useFolderStore } from '../store/folder';
import HomeSearch from '../components/home/HomeSearch.vue';

export default {
  components: { HomeNoteCard, HomeSearch, HomeFolderCard },
  setup() {
    const translations = ref({
      sidebar: {},
      index: {},
      card: {},
    });
    const highlightedFolderIds = ref(new Set());
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
    const scrollContainer = ref(null);
    const autoScrollInterval = ref(null);
    const SCROLL_ZONE_SIZE = 80;
    const SCROLL_SPEED = 5;

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

      const sortedFolders = sortArray({
        data: rootFolders,
        order: state.sortOrder,
        key: 'name',
      });

      return {
        all: filterFolders(sortedFolders),
        bookmarked: [],
        archived: [],
      };
    });

    function filterNotes(notes) {
      const filteredNotes = { all: [], archived: [], bookmarked: [] };
      highlightedFolderIds.value.clear();

      notes.forEach((note) => {
        let { title, content, isArchived, isBookmarked, labels, folderId } =
          note;

        const normalizedTitle =
          title && title.trim() !== ''
            ? title
            : translations.value.card?.untitledNote || '';

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
            normalizedTitle.toLocaleLowerCase().includes(queryLower) ||
            content.toLocaleLowerCase().includes(queryLower);

        if (isMatch && labelFilter) {
          if (folderId !== null && folderId !== undefined) {
            highlightedFolderIds.value.add(folderId);
            bubbleHighlight(folderId);
            return;
          }

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
        const normalizedName =
          folder.name && folder.name.trim() !== ''
            ? folder.name
            : translations.value.card?.untitledFolder || '';

        const queryLower = state.query.toLocaleLowerCase();
        const matchesSelf = normalizedName
          .toLocaleLowerCase()
          .includes(queryLower);

        const matchesChildren = highlightedFolderIds.value.has(folder.id);

        if (matchesSelf || matchesChildren) {
          highlightedFolderIds.value.add(folder.id);
          bubbleHighlight(folder.id);
          return true;
        }

        return false;
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

    function bubbleHighlight(folderId) {
      let current = folderStore.data[folderId];
      while (current?.parentId) {
        highlightedFolderIds.value.add(current.parentId);
        current = folderStore.data[current.parentId];
      }
    }

    function handleDragOver(event, folderId) {
      event.preventDefault();

      const dragData = event.dataTransfer.types.includes('application/json');
      if (!dragData) return;

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
          noteStore.update(dragData.id, { folderId: targetFolderId });
        } else if (dragData.type === 'folder') {
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
    watch(
      () => noteStore.notes,
      (notes) => {
        state.notes = notes.map(extractNoteContent);
      },
      { immediate: true }
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
        activeClass: 'ring-2 ring-primary active-note',
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

    onMounted(async () => {
      await useTranslation().then((trans) => {
        if (trans) {
          translations.value = trans;
        }
      });
    });

    function startAutoScroll(event) {
      if (autoScrollInterval.value) return;

      const rect = window.innerHeight;
      const clientY = event.clientY;

      let scrollDirection = 0;

      if (clientY < SCROLL_ZONE_SIZE) {
        scrollDirection = -1;
      } else if (clientY > rect - SCROLL_ZONE_SIZE) {
        scrollDirection = 1;
      }

      if (scrollDirection !== 0) {
        autoScrollInterval.value = setInterval(() => {
          const currentScrollTop =
            window.scrollY || document.documentElement.scrollTop;
          const maxScroll =
            document.documentElement.scrollHeight - window.innerHeight;

          if (scrollDirection === -1 && currentScrollTop > 0) {
            window.scrollBy(0, -SCROLL_SPEED);
          } else if (scrollDirection === 1 && currentScrollTop < maxScroll) {
            window.scrollBy(0, SCROLL_SPEED);
          }
        }, 16);
      }
    }

    function stopAutoScroll() {
      if (autoScrollInterval.value) {
        clearInterval(autoScrollInterval.value);
        autoScrollInterval.value = null;
      }
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
      event.dataTransfer.effectAllowed = 'move';

      document.addEventListener('dragover', handleGlobalDragOver, {
        passive: false,
      });
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
      event.dataTransfer.effectAllowed = 'move';

      document.addEventListener('dragover', handleGlobalDragOver, {
        passive: false,
      });
    }

    function handleGlobalDragOver(event) {
      event.preventDefault();

      stopAutoScroll();

      startAutoScroll(event);
    }

    function handleDragEnd() {
      dragOverFolderId.value = null;
      draggedNoteId.value = null;
      draggedFolderId.value = null;
      dragType.value = null;

      stopAutoScroll();
      document.removeEventListener('dragover', handleGlobalDragOver);
    }

    onUnmounted(() => {
      keyboardNavigation.value?.destroy();
      stopAutoScroll();
      document.removeEventListener('dragover', handleGlobalDragOver);
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
      HomeImg,
      ArchiveImg,
      theme,
      dragOverFolderId,
      draggedNoteId,
      draggedFolderId,
      handleNoteDragStart,
      handleFolderDragStart,
      handleDragOver,
      handleDragLeave,
      handleDrop,
      handleDragEnd,
      scrollContainer,
      startAutoScroll,
      stopAutoScroll,
      highlightedFolderIds,
      handleGlobalDragOver,
    };
  },
};
</script>

<style>
[draggable='true'] {
  cursor: grab;
  transition: all 0.2s ease;
}

[draggable='true']:active {
  cursor: grabbing;
}

/* Enhanced drag feedback */
.drag-over {
  transform: scale(1.02);
  box-shadow: 0 8px 25px rgba(59, 130, 246, 0.15);
}

.drag-forbidden {
  cursor: not-allowed;
  opacity: 0.6;
}
</style>
