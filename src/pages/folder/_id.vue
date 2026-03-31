<!-- eslint-disable vue/multi-word-component-names -->
<template>
  <div>
    <div class="container pt-5">
      <div class="flex flex-col gap-2 mb-6">
        <div class="flex items-center gap-3 min-w-0">
          <span v-if="folder.icon" class="text-2xl select-none flex-shrink-0">
            {{ folder.icon }}
          </span>
          <v-remixicon
            v-else
            name="riFolder5Fill"
            class="w-6 h-6 flex-shrink-0"
            :style="{ color: folder.color || '#6B7280' }"
          />
          <h1
            class="text-2xl md:text-3xl font-bold flex-1 min-w-0 truncate whitespace-nowrap"
          >
            {{ folder.name || translations.index.untitledFolder }}
          </h1>
        </div>

        <nav aria-label="Breadcrumb" class="text-sm">
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

              <li
                v-if="index < folderPath.length - 1 && pathFolder?.id"
                class="min-w-0"
              >
                <router-link
                  :to="`/folder/${pathFolder.id}`"
                  class="hover:text-primary inline-block align-middle max-w-[10rem] md:max-w-[14rem] lg:max-w-[18rem]"
                  :title="pathFolder?.name || translations.index.untitledFolder"
                >
                  <span class="truncate">
                    {{ pathFolder?.name || translations.index.untitledFolder }}
                  </span>
                </router-link>
              </li>

              <li v-else class="font-medium min-w-0">
                <span
                  class="inline-block align-middle max-w-[10rem] md:max-w-[14rem] lg:max-w-[18rem] truncate"
                  :title="pathFolder?.name || translations.index.untitledFolder"
                >
                  {{ pathFolder?.name || translations.index.untitledFolder }}
                </span>
              </li>
            </template>
          </ol>
        </nav>
      </div>
      <home-search
        v-model:query="state.query"
        v-model:label="state.activeLabel"
        v-model:sort-by="state.sortBy"
        v-model:sort-order="state.sortOrder"
      />
    </div>

    <div
      class="container md:pb-5"
      @mousedown="handleMouseDown"
      @click="handleGridClick"
    >
      <div
        v-if="isSelecting"
        class="fixed border-2 border-primary bg-primary bg-opacity-30 pointer-events-none z-50"
        :style="selectionBoxStyle"
      />

      <template v-if="noteStore.notes.length !== 0 || folders.all.length !== 0">
        <section v-if="folders.all.length" class="mb-10">
          <p
            class="text-gray-600 dark:text-[color:var(--selected-dark-text)] capitalize mt-2 mb-4"
          >
            {{ translations.index.folders }}
          </p>
          <TransitionGroup
            tag="div"
            :css="isSorting"
            :name="isSorting ? 'sort-cards' : undefined"
            class="folder-grid"
          >
            <div
              v-for="childFolder in folders.all"
              :key="childFolder.id"
              :min-height="120"
              :data-item-id="`folder-${childFolder.id}`"
              class="folder-grid__item"
              @click="
                handleItemClick(
                  $event,
                  'folder',
                  childFolder.id,
                  getAllVisibleItems
                )
              "
              @touchstart="
                handleItemTouchStart($event, 'folder', childFolder.id)
              "
              @touchmove="handleItemTouchMove($event)"
              @touchend="handleItemTouchEnd($event, 'folder', childFolder.id)"
              @touchcancel="handleItemTouchCancel"
            >
              <home-folder-card
                :key="childFolder.id"
                :folder="childFolder"
                :disable-open="selectionMode"
                :class="{
                  'transform scale-[1.02]':
                    dragOverFolderId === childFolder.id ||
                    (state.query && highlightedFolderIds.has(childFolder.id)),
                  'transform scale-[1.02] transition-transform duration-200':
                    selectedItems.has(`folder-${childFolder.id}`),
                }"
                style="contain: layout style"
                draggable="true"
                @dragstart="handleFolderDragStart($event, childFolder.id)"
                @dragend="handleDragEnd"
                @dragover="handleDragOver($event, childFolder.id)"
                @dragleave="handleDragLeave"
                @drop="handleDrop($event, childFolder.id)"
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
          <template v-if="notes[name].length !== 0">
            <p
              class="text-gray-600 dark:text-[color:var(--selected-dark-text)] capitalize mt-2 mb-4"
            >
              {{ translations.index[name] }}
            </p>

            <home-note-masonry
              :notes="notes[name]"
              :selected-items="selectedItems"
              :selection-mode="selectionMode"
              :gap-px="16"
              :breakpoints="[
                { min: 0, cols: 1 },
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
import { useLabelStore } from '@/store/label';
import { useDialog } from '@/composable/dialog';
import { sortArray } from '@/utils/helper';
import HomeNoteMasonry from '@/components/home/HomeNoteMasonry.vue';
import HomeImg from '@/assets/images/home.png';
import ArchiveImg from '@/assets/images/archive.png';
import HomeFolderCard from '@/components/home/HomeFolderCard.vue';
import { useFolderStore } from '@/store/folder';
import HomeSearch from '@/components/home/HomeSearch.vue';
import FolderTree from '@/components/home/FolderTree.vue';
import Actions from '@/components/home/Actions.vue';
import { useNotesBrowser } from '@/composable/useNotesBrowser';
import { extractTextFromContent } from '@/utils/noteSerializer';

export default {
  components: {
    HomeNoteMasonry,
    HomeSearch,
    HomeFolderCard,
    FolderTree,
    Actions,
  },
  setup() {
    const { translations } = useTranslations();
    const highlightedFolderIds = ref(new Set());
    const route = useRoute();
    const router = useRouter();
    const noteStore = useNoteStore();
    const folderStore = useFolderStore();
    const labelStore = useLabelStore();
    const dialog = useDialog();
    const state = reactive({
      query: '',
      activeLabel: '',
      sortBy: 'createdAt',
      sortOrder: 'asc',
    });
    const currentFolderId = computed(() => route.params.id);

    const sortedNotes = computed(() =>
      sortArray({
        data: noteStore.notes,
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
      const queryLower = state.query.toLocaleLowerCase();
      const isLabelQuery = queryLower.startsWith('#');
      const labelQuery = isLabelQuery ? queryLower.slice(1) : queryLower;

      notes.forEach((note) => {
        let { title, isArchived, isBookmarked, labels, folderId } = note;

        if (folderId !== currentFolderId.value) {
          return;
        }

        const normalizedTitle =
          title && title.trim() !== ''
            ? title
            : translations.value.card?.untitledNote || '';

        labels = [...labels].sort((a, b) => a.localeCompare(b));

        const labelFilter = state.activeLabel
          ? labels.includes(state.activeLabel)
          : true;

        const isMatch = isLabelQuery
          ? labels.some((label) =>
              label.toLocaleLowerCase().includes(labelQuery)
            )
          : labels.some((label) =>
              label.toLocaleLowerCase().includes(queryLower)
            ) ||
            normalizedTitle.toLocaleLowerCase().includes(queryLower) ||
            (note.searchText ?? extractTextFromContent(note.content)).toLowerCase().includes(queryLower);

        if (isMatch && labelFilter) {
          const noteCard = { ...note, content: note.searchText ?? extractTextFromContent(note.content) };

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
        const matchesQuery = normalizedName
          .toLocaleLowerCase()
          .includes(queryLower);

        return matchesQuery;
      });
    }

    function deleteLabel(id) {
      labelStore.delete(id).then(() => {
        state.activeLabel = '';
      });
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
    });

    const folder = computed(() => {
      if (!currentFolderId.value) return null;
      return folderStore.getById(currentFolderId.value) ?? null;
    });

    const childFolders = computed(() => {
      if (!currentFolderId.value) return [];
      return folderStore
        .getByParent(currentFolderId.value)
        .filter((f) => f?.id && !folderStore.deletedIds[f.id])
        .sort((a, b) => a.name.localeCompare(b.name));
    });

    const notesInFolder = computed(() => {
      if (!currentFolderId.value) return [];
      return noteStore
        .getByFolder(currentFolderId.value)
        .filter((note) => note && typeof note === 'object' && note.id)
        .sort((a, b) => b.updatedAt - a.updatedAt);
    });

    const folderPath = computed(() => {
      if (!currentFolderId.value) return [];
      return folderStore.getFolderPath(currentFolderId.value) || [];
    });

    return {
      notes,
      state,
      noteStore,
      folderStore,
      labelStore,
      translations,
      folders,
      folder,
      deleteLabel,
      HomeImg,
      ArchiveImg,
      highlightedFolderIds,
      childFolders,
      notesInFolder,
      folderPath,
      ...pageController,
    };
  },
};
</script>

<style scoped>
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
  .sort-cards-move {
    transition: transform 320ms cubic-bezier(0.25, 0.46, 0.45, 0.94);
  }

  .sort-cards-enter-active {
    transition: opacity 200ms ease, transform 200ms ease;
  }
}
</style>
