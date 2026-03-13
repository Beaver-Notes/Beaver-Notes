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
            class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4"
          >
            <div
              v-for="folder in folders.all"
              :key="folder.id"
              :data-item-id="`folder-${folder.id}`"
              @click.stop="
                handleItemClick($event, 'folder', folder.id, getAllVisibleItems)
              "
            >
              <home-folder-card
                :folder="folder"
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
          <template v-if="notes[name].length !== 0">
            <h2
              class="text-gray-600 dark:text-[color:var(--selected-dark-text)] capitalize mb-4 font-medium"
            >
              {{ translations.index[name] }}
            </h2>
            <TransitionGroup
              tag="div"
              :css="isSorting"
              :name="isSorting ? 'sort-cards' : undefined"
              :class="{ 'filter-pulse': isFiltering }"
              class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5 xl:gap-6 items-stretch"
            >
              <div
                v-for="note in notes[name]"
                :key="note.id"
                :data-item-id="`note-${note.id}`"
                @click.stop="
                  handleItemClick($event, 'note', note.id, getAllVisibleItems)
                "
              >
                <home-note-card
                  :note-id="note.id"
                  :is-locked="note.isLocked"
                  v-bind="{ note }"
                  :class="{
                    'ring-1 ring-secondary bg-primary/5 transform scale-[1.02] transition-transform duration-200':
                      selectedItems.has(`note-${note.id}`),
                  }"
                  class="h-full"
                  draggable="true"
                  style="contain: layout style"
                  @dragstart="handleNoteDragStart($event, note.id)"
                  @dragend="handleDragEnd"
                  @update:label="state.activeLabel = $event"
                  @update="noteStore.update(note.id, $event)"
                />
              </div>
            </TransitionGroup>
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
// All your existing script logic stays exactly the same
import {
  computed,
  reactive,
  watch,
  ref,
  shallowRef,
  onMounted,
  onUnmounted,
} from 'vue';
import Mousetrap from '@/lib/mousetrap';
import emitter from 'tiny-emitter/instance';
import { useTranslations } from '@/composable/useTranslations';
import { useRoute, useRouter } from 'vue-router';
import { useNoteStore } from '@/store/note';
import { useDialog } from '@/composable/dialog';
import {
  sortArray,
  getPlainTextFromNoteContent,
  parseItemId,
  areSetsEqual,
} from '@/utils/helper';
import HomeNoteCard from '@/components/home/HomeNoteCard.vue';
import KeyboardNavigation from '@/utils/keyboard-navigation';
import HomeFolderCard from '../components/home/HomeFolderCard.vue';
import { useFolderStore } from '../store/folder';
import HomeSearch from '../components/home/HomeSearch.vue';
import FolderTree from '../components/home/FolderTree.vue';
import Actions from '../components/home/Actions.vue';
import { useSelection, patchSelectionSet } from '@/composable/selection';
import { useDragAndDrop } from '@/composable/dragAndDrop';
import EmptyState from '../components/app/EmptyState.vue';

export default {
  components: {
    HomeNoteCard,
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

    const keyboardNavigation = shallowRef(null);
    const suppressNextClick = ref(false);
    const SCROLL_ZONE_SIZE = 80;
    const SCROLL_SPEED = 5;
    const isSorting = ref(false);
    const isFiltering = ref(false);

    const showMoveModal = ref(false);
    const baseSelection = ref(new Set());
    const cachedItems = [];
    let dragAccumulated = null;
    let cachedScrollY = 0;

    let rafId = null;
    let pendingPointer = null;
    let mouseMoveListener = null;
    let sortTimer = null;
    let filterTimer = null;
    let enableSortMotion = false;

    const {
      selectedItems,
      isSelecting,
      selectionStart,
      selectionEnd,
      selectionBoxStyle,
      handleItemClick,
      clearSelection,
      selectAllItems,
    } = useSelection({ suppressNextClick });

    const {
      dragOverFolderId,
      handleNoteDragStart,
      handleFolderDragStart,
      handleDragEnd,
      handleDragOver,
      handleDragLeave,
    } = useDragAndDrop({ selectedItems, clearSelection });

    const state = reactive({
      query: '',
      activeLabel: '',
      sortBy: 'createdAt',
      sortOrder: 'asc',
    });

    const noteSearchCache = new Map();

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

    const selectedNotes = computed(() => {
      return Array.from(selectedItems.value)
        .map(parseItemId)
        .filter(({ type, id }) => type === 'note' && id)
        .map(({ id }) => noteStore.getById(id))
        .filter(Boolean);
    });

    const selectedFolders = computed(() => {
      return Array.from(selectedItems.value)
        .map(parseItemId)
        .filter(({ type, id }) => type === 'folder' && id)
        .map(({ id }) => folderStore.getById(id))
        .filter(Boolean);
    });

    const moveMode = computed(() => {
      if (selectedNotes.value.length > 0 && selectedFolders.value.length > 0) {
        return null;
      } else if (selectedNotes.value.length > 0) {
        return 'note';
      } else if (selectedFolders.value.length > 0) {
        return 'folder';
      }
      return null;
    });

    function cacheItemRects() {
      cachedItems.length = 0;
      const nodes = document.querySelectorAll('[data-item-id]');
      nodes.forEach((el) => {
        const id = el.getAttribute('data-item-id');
        const r = el.getBoundingClientRect();
        cachedItems.push({
          id,
          rect: { left: r.left, top: r.top, right: r.right, bottom: r.bottom },
        });
      });
      cachedScrollY = window.scrollY || document.documentElement.scrollTop || 0;
    }

    function handleMouseDown(event) {
      if (event.button !== 0) return;

      const clickedInsideItem = event.target.closest('[data-item-id]');
      if (clickedInsideItem) return;

      event.preventDefault();

      cacheItemRects();
      isSelecting.value = true;
      selectionStart.value = { x: event.clientX, y: event.clientY };
      selectionEnd.value = { x: event.clientX, y: event.clientY };

      if (!event.ctrlKey && !event.metaKey) {
        selectedItems.value.clear();
      }
      baseSelection.value = new Set(selectedItems.value);

      dragAccumulated = new Set(baseSelection.value);
      mouseMoveListener = handleMouseMove;
      document.addEventListener('mousemove', mouseMoveListener);
    }

    function handleMouseMove(event) {
      if (!isSelecting.value) return;
      event.preventDefault();
      pendingPointer = { x: event.clientX, y: event.clientY };
      if (rafId === null) rafId = requestAnimationFrame(tickSelection);
    }

    let lastReflowAtDelta = 0;
    function tickSelection() {
      rafId = null;
      const H = window.innerHeight;
      let dy = 0;
      if (pendingPointer.y < SCROLL_ZONE_SIZE) dy = -SCROLL_SPEED;
      else if (pendingPointer.y > H - SCROLL_ZONE_SIZE) dy = SCROLL_SPEED;

      if (dy !== 0) window.scrollBy(0, dy);

      selectionEnd.value = pendingPointer;

      const currentDelta =
        (window.scrollY || document.documentElement.scrollTop || 0) -
        cachedScrollY;

      if (Math.abs(currentDelta - lastReflowAtDelta) >= 64) {
        cacheItemRects();
        lastReflowAtDelta = currentDelta;
      }

      updateSelection();
      if (isSelecting.value) rafId = requestAnimationFrame(tickSelection);
    }

    function updateSelection() {
      const left = Math.min(selectionStart.value.x, selectionEnd.value.x);
      const top = Math.min(selectionStart.value.y, selectionEnd.value.y);
      const right = Math.max(selectionStart.value.x, selectionEnd.value.x);
      const bottom = Math.max(selectionStart.value.y, selectionEnd.value.y);

      const scrollDelta =
        (window.scrollY || document.documentElement.scrollTop || 0) -
        cachedScrollY;

      let detectedType = null;
      for (const { id, rect: r } of cachedItems) {
        const rTop = r.top - scrollDelta;
        const rBottom = r.bottom - scrollDelta;

        const isIntersecting = !(
          r.right < left ||
          r.left > right ||
          rBottom < top ||
          rTop > bottom
        );
        if (!isIntersecting) continue;

        const [type] = id.split('-');
        if (!detectedType) detectedType = type;
        if (type === detectedType) {
          dragAccumulated.add(id);
        }
      }

      if (!areSetsEqual(dragAccumulated, selectedItems.value)) {
        patchSelectionSet(selectedItems.value, dragAccumulated);
      }
    }

    function handleMouseUp(event) {
      if (!isSelecting.value) return;

      const dx = Math.abs(selectionEnd.value.x - selectionStart.value.x);
      const dy = Math.abs(selectionEnd.value.y - selectionStart.value.y);

      if (dx >= 5 || dy >= 5) {
        suppressNextClick.value = true;
        event.preventDefault();
        event.stopPropagation();
      }

      isSelecting.value = false;
      dragAccumulated = null;
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }

      if (mouseMoveListener) {
        document.removeEventListener('mousemove', mouseMoveListener);
        mouseMoveListener = null;
      }
    }

    function handleGridClick(event) {
      if (suppressNextClick.value) {
        suppressNextClick.value = false;
        event.preventDefault();
        event.stopPropagation();
        return;
      }

      if (event.target === event.currentTarget && !isSelecting.value) {
        clearSelection();
      }
    }

    function getAllVisibleItems() {
      const items = [];
      folders.value.all.forEach((folder) => items.push(`folder-${folder.id}`));
      ['bookmarked', 'all', 'archived'].forEach((category) => {
        if (notes.value[category]) {
          notes.value[category].forEach((note) =>
            items.push(`note-${note.id}`)
          );
        }
      });
      return items;
    }

    function selectAll() {
      selectAllItems(getAllVisibleItems);
    }

    function deleteDialogCopy(count) {
      const title =
        count === 1
          ? translations.value.card.deleteItem
          : translations.value.card.deleteItems.replace('{count}', count);
      return { title };
    }

    async function bulkDelete() {
      const count = selectedItems.value.size;
      const { title } = deleteDialogCopy(count);

      dialog.confirm({
        title,
        okText: translations.value.card.delete,
        cancelText: translations.value.card.cancel,
        destructive: true,
        onConfirm: async () => {
          for (const item of selectedItems.value) {
            const { type, id } = parseItemId(item);
            if (type === 'note') await noteStore.delete(id);
            else if (type === 'folder') await folderStore.delete(id);
          }
          clearSelection();
        },
      });
    }

    function bulkMove() {
      if (selectedItems.value.size > 0) {
        showMoveModal.value = true;
      }
    }

    function handleMoved(result) {
      const targetFolderId = result.folderId;

      for (const item of selectedItems.value) {
        const { type, id } = parseItemId(item);
        if (type === 'note') {
          noteStore.update(id, { folderId: targetFolderId });
        } else if (type === 'folder') {
          if (!folderStore.wouldCreateCircularReference(id, targetFolderId)) {
            folderStore.update(id, { parentId: targetFolderId });
          }
        }
      }

      clearSelection();
      showMoveModal.value = false;
    }

    function handleDrop(event, targetFolderId) {
      event.preventDefault();

      try {
        const dragData = JSON.parse(
          event.dataTransfer.getData('application/json')
        );

        if (dragData.type === 'notes' || dragData.type === 'note') {
          const noteIds = dragData.ids || [dragData.id];
          noteIds.forEach((noteId) => {
            noteStore.update(noteId, { folderId: targetFolderId });
          });
          clearSelection();
        } else if (dragData.type === 'folders' || dragData.type === 'folder') {
          const folderIds = dragData.ids || [dragData.id];
          folderIds.forEach((folderId) => {
            if (
              !folderStore.wouldCreateCircularReference(
                folderId,
                targetFolderId
              )
            ) {
              folderStore.update(folderId, { parentId: targetFolderId });
            }
          });
          clearSelection();
        }
      } catch (error) {
        console.error('Error handling drop:', error);
      }

      handleDragEnd();
    }

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
              getNoteSearchText(note).includes(queryLower);

        if (matchesQuery && labelFilter) {
          if (folderId !== null && folderId !== undefined) {
            highlightedFolderIds.value.add(folderId);
            bubbleHighlight(folderId);
            return;
          }

          const noteCard = { ...note, content: getNoteSearchText(note) };

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

    function getNoteSearchText(note) {
      const cacheKey = `${note.id}:${note.updatedAt || 0}`;
      const cached = noteSearchCache.get(note.id);
      if (cached?.key === cacheKey) {
        return cached.value;
      }

      const text = getPlainTextFromNoteContent(
        note.content
      ).toLocaleLowerCase();
      noteSearchCache.set(note.id, { key: cacheKey, value: text });
      return text;
    }

    function bubbleHighlight(folderId) {
      let current = folderStore.data[folderId];
      while (current?.parentId) {
        highlightedFolderIds.value.add(current.parentId);
        current = folderStore.data[current.parentId];
      }
    }

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

        if (!enableSortMotion) return;

        clearTimeout(sortTimer);
        isSorting.value = true;
        sortTimer = setTimeout(() => {
          isSorting.value = false;
        }, 400);
      }
    );

    watch(
      () => state.query,
      (value) => {
        clearTimeout(filterTimer);

        if (!value) {
          isFiltering.value = false;
          return;
        }

        isFiltering.value = true;
        filterTimer = setTimeout(() => {
          isFiltering.value = false;
        }, 250);
      }
    );

    watch(notes, () => {
      setTimeout(() => {
        keyboardNavigation.value.refresh();
      }, 250);
    });

    onMounted(async () => {
      window.addEventListener('mouseup', handleMouseUp);

      emitter.on('set-label', (name) => {
        state.activeLabel = name;
      });

      const sortState = JSON.parse(localStorage.getItem('sort-notes'));
      if (sortState) Object.assign(state, sortState);
      enableSortMotion = true;

      keyboardNavigation.value = new KeyboardNavigation({
        itemSelector: '.note-card',
        activeClass: 'ring-1 ring-primary active-note',
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
          if (!noteId) return;

          if (key === 'Enter') {
            router.push(`/note/${noteId}`);
          } else if (['Backspace', 'Delete'].includes(key)) {
            dialog.confirm({
              title: translations.value.card.confirmPrompt,
              okText: translations.value.card.confirm,
              cancelText: translations.value.card.cancel,
              onConfirm: async () => await noteStore.delete(noteId),
            });
          }
        }
      );

      Mousetrap.bind(['del', 'backspace'], (e) => {
        if (selectedItems.value.size > 0) {
          e.preventDefault();
          bulkDelete();
        }
      });

      Mousetrap.bind(['command+a', 'ctrl+a'], (e) => {
        e.preventDefault();
        selectAll();
      });

      Mousetrap.bind('esc', (e) => {
        if (selectedItems.value.size > 0) {
          e.preventDefault();
          clearSelection();
        }
      });
    });

    onUnmounted(() => {
      keyboardNavigation.value?.destroy();
      window.removeEventListener('mouseup', handleMouseUp);
      clearTimeout(sortTimer);
      clearTimeout(filterTimer);
      emitter.off('set-label');
      Mousetrap.reset();
      if (mouseMoveListener) {
        document.removeEventListener('mousemove', mouseMoveListener);
        mouseMoveListener = null;
      }
    });

    return {
      notes,
      state,
      noteStore,
      folderStore,
      translations,
      folders,
      handleNoteDragStart,
      handleFolderDragStart,
      handleDragOver,
      handleDragLeave,
      handleDrop,
      highlightedFolderIds,
      selectedItems,
      handleItemClick,
      handleGridClick,
      handleMouseDown,
      handleMouseMove,
      handleMouseUp,
      clearSelection,
      selectAll,
      bulkDelete,
      bulkMove,
      handleMoved,
      showMoveModal,
      moveMode,
      isSorting,
      isFiltering,
      isSelecting,
      selectionBoxStyle,
      selectedNotes,
      selectedFolders,
      handleDragEnd,
      dragOverFolderId,
      getAllVisibleItems,
    };
  },
};
</script>

<style scoped>
.filter-pulse {
  opacity: 1;
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
