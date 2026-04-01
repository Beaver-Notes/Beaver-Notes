<!-- eslint-disable vue/multi-word-component-names -->
<template>
  <div>
    <div class="container pt-5">
      <h1 class="text-3xl mb-8 font-bold">
        {{
          $route.query.archived === 'true'
            ? translations.sidebar.archive || '-'
            : translations.sidebar.notes || '-'
        }}
      </h1>
      <home-search
        v-model:query="state.query"
        v-model:label="state.activeLabel"
        v-model:sort-by="state.sortBy"
        v-model:sort-order="state.sortOrder"
      />
    </div>

    <div
      class="container pb-5"
      @mousedown="handleMouseDown"
      @click="handleGridClick"
    >
      <div
        v-if="isSelecting"
        class="fixed border-2 border-primary bg-primary bg-opacity-30 pointer-events-none z-50"
        :style="selectionBoxStyle"
      />

      <template
        v-if="
          noteStore.notes.length !== 0 || folderStore.rootFolders.length !== 0
        "
      >
        <section v-if="folders.all.length" class="mb-10">
          <h2
            class="text-gray-600 dark:text-[color:var(--selected-dark-text)] capitalize mb-4 font-medium px-1"
          >
            {{ translations.index.folders }}
          </h2>

          <TransitionGroup
            tag="div"
            :css="isSorting"
            :name="isSorting ? 'sort-cards' : undefined"
            class="folder-grid"
          >
            <div
              v-for="folder in folders.all"
              :key="folder.id"
              :data-item-id="`folder-${folder.id}`"
              class="folder-grid__item"
              @click.stop="
                handleItemClick($event, 'folder', folder.id, getAllVisibleItems)
              "
              @touchstart="handleItemTouchStart($event, 'folder', folder.id)"
              @touchmove="handleItemTouchMove($event)"
              @touchend="handleItemTouchEnd($event, 'folder', folder.id)"
              @touchcancel="handleItemTouchCancel"
            >
              <home-folder-card
                :folder="folder"
                :disable-open="selectionMode"
                :class="{
                  'transform scale-[1.02]':
                    dragOverFolderId === folder.id ||
                    (state.query && highlightedFolderIds.has(folder.id)),
                  'transform scale-[1.02] transition-transform duration-200':
                    selectedItems.has(`folder-${folder.id}`),
                }"
                draggable="true"
                style="contain: layout style"
                @dragstart="handleFolderDragStart($event, folder.id)"
                @dragend="handleDragEnd"
                @dragover="handleDragOver($event, folder.id)"
                @dragleave="handleDragLeave"
                @drop="handleDrop($event, folder.id)"
              />
            </div>
          </TransitionGroup>
        </section>

        <section
          v-for="name in $route.query.archived
            ? ['archived']
            : ['bookmarked', 'all']"
          :key="name"
          class="mb-12"
        >
          <template v-if="notes[name] && notes[name].length > 0">
            <h2
              class="text-gray-600 dark:text-[color:var(--selected-dark-text)] capitalize mb-4 font-medium"
            >
              {{ translations.index[name] }}
            </h2>

            <home-note-masonry
              :notes="notes[name] || []"
              :selected-items="selectedItems"
              :selection-mode="selectionMode"
              :pulse="isFiltering"
              :gap-px="24"
              :breakpoints="[
                { min: 0, cols: 2 },
                { min: 640, cols: 2 },
                { min: 768, cols: 2 },
                { min: 1024, cols: 3 },
                { min: 1280, cols: 4 },
              ]"
              @item-click="
                handleItemClick(
                  $event.event,
                  'note',
                  $event.noteId,
                  getAllVisibleItems
                )
              "
              @item-touchstart="
                handleItemTouchStart($event.event, 'note', $event.noteId)
              "
              @item-touchmove="handleItemTouchMove($event.event)"
              @item-touchend="
                handleItemTouchEnd($event.event, 'note', $event.noteId)
              "
              @item-touchcancel="handleItemTouchCancel"
              @dragstart="handleNoteDragStart($event.event, $event.noteId)"
              @dragend="handleDragEnd($event.event)"
              @update:label="state.activeLabel = $event"
              @update="noteStore.update($event.noteId, $event.payload)"
            />
          </template>
        </section>
      </template>

      <empty-state
        v-if="
          noteStore.notes.length === 0 && folderStore.rootFolders.length === 0
        "
      />

      <folder-tree
        v-model="showMoveModal"
        :notes="selectedNotes"
        :folders="selectedFolders"
        :mode="moveMode"
        @moved="handleMoved"
      />
    </div>

    <actions
      :selected-items="selectedItems"
      @delete="bulkDelete"
      @move="bulkMove"
      @clear="clearSelection"
    />
  </div>
</template>

<script>
import { computed, reactive, ref } from 'vue';
import { useTranslations } from '@/composable/useTranslations';
import { useRoute, useRouter } from 'vue-router';
import { useNoteStore } from '@/store/note';
import { useDialog } from '@/composable/dialog';
import { sortArray } from '@/utils/helper';
import HomeNoteMasonry from '@/components/home/HomeNoteMasonry.vue';
import HomeFolderCard from '../components/home/HomeFolderCard.vue';
import { useFolderStore } from '../store/folder';
import HomeSearch from '../components/home/HomeSearch.vue';
import FolderTree from '../components/home/FolderTree.vue';
import Actions from '../components/home/Actions.vue';
import { useNotesBrowser } from '@/composable/useNotesBrowser';
import EmptyState from '../components/app/EmptyState.vue';
import { extractTextFromContent } from '@/utils/noteSerializer';

export default {
  components: {
    HomeNoteMasonry,
    HomeSearch,
    HomeFolderCard,
    FolderTree,
    Actions,
    EmptyState,
  },
  setup() {
    const { translations } = useTranslations();
    const highlightedFolderIds = ref(new Set());
    const route = useRoute();
    const router = useRouter();
    const noteStore = useNoteStore();
    const folderStore = useFolderStore();
    const dialog = useDialog();
    const state = reactive({
      query: '',
      activeLabel: '',
      sortBy: 'createdAt',
      sortOrder: 'asc',
    });

    const sortedNotes = computed(() =>
      sortArray({
        data: noteStore.notes,
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
      const queryLower = state.query.trim().toLocaleLowerCase();
      const isLabelQuery = queryLower.startsWith('#');
      const labelQuery = isLabelQuery ? queryLower.slice(1) : queryLower;

      highlightedFolderIds.value.clear();

      notes.forEach((note) => {
        const { title, isArchived, isBookmarked, labels = [], folderId } = note;

        const normalizedTitle =
          title && title.trim() !== ''
            ? title
            : translations.value.card?.untitledNote || '';

        const labelFilter = state.activeLabel
          ? labels.includes(state.activeLabel)
          : true;

        const matchesQuery =
          queryLower === ''
            ? true
            : isLabelQuery
            ? labels.some((label) =>
                label.toLocaleLowerCase().includes(labelQuery)
              )
            : labels.some((label) =>
                label.toLocaleLowerCase().includes(queryLower)
              ) ||
              normalizedTitle.toLocaleLowerCase().includes(queryLower) ||
              (note.searchText ?? extractTextFromContent(note.content))
                .toLowerCase()
                .includes(queryLower);

        if (matchesQuery && labelFilter) {
          if (folderId !== null && folderId !== undefined) {
            highlightedFolderIds.value.add(folderId);
            bubbleHighlight(folderId);
            return;
          }

          const noteCard = { ...note, content: note.content };

          if (isArchived) return filteredNotes.archived.push(noteCard);
          isBookmarked
            ? filteredNotes.bookmarked.push(noteCard)
            : filteredNotes.all.push(noteCard);
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

    function bubbleHighlight(folderId) {
      let current = folderStore.data[folderId];
      while (current?.parentId) {
        highlightedFolderIds.value.add(current.parentId);
        current = folderStore.data[current.parentId];
      }
    }

    const pageController = useNotesBrowser({
      state,
      route,
      router,
      noteStore,
      folderStore,
      dialog,
      translations,
      notes,
      folders,
      enableFilterPulse: true,
      listenForLabelEvents: true,
    });

    return {
      notes,
      state,
      noteStore,
      folderStore,
      translations,
      folders,
      highlightedFolderIds,
      ...pageController,
    };
  },
};
</script>

<style scoped>
.filter-pulse {
  opacity: 1;
}

.folder-grid {
  --folder-card-max: 216px;
  display: grid;
  grid-template-columns: repeat(
    auto-fit,
    minmax(min(100%, 180px), var(--folder-card-max))
  );
  justify-content: start;
  align-items: stretch;
  gap: 1rem;
}

.folder-grid__item {
  width: 100%;
}

.sort-cards-move {
  transition: transform 0.01ms linear;
}

.sort-cards-enter-active {
  transition: opacity 0.01ms linear, transform 0.01ms linear;
}

.sort-cards-enter-from {
  opacity: 0;
  transform: translateY(6px);
}

@media (prefers-reduced-motion: no-preference) {
  .filter-pulse {
    animation: filterPulse 200ms ease forwards;
  }

  .sort-cards-move {
    transition: transform 320ms cubic-bezier(0.25, 0.46, 0.45, 0.94);
  }

  .sort-cards-enter-active {
    transition: opacity 200ms ease, transform 200ms ease;
  }

  @keyframes filterPulse {
    0% {
      opacity: 1;
    }

    40% {
      opacity: 0.6;
    }

    100% {
      opacity: 1;
    }
  }
}
</style>
