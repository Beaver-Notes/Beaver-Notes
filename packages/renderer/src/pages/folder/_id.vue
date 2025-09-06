<!-- eslint-disable vue/multi-word-component-names -->
<template>
  <div class="container pt-5">
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
            <li>
              <router-link
                v-if="index < folderPath.length - 1 && pathFolder?.id"
                :to="`/folder/${pathFolder.id}`"
                class="hover:text-primary"
              >
                {{ pathFolder?.name || translations.index.untitledFolder }}
              </router-link>
              <span v-else class="font-medium">
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
      v-bind="{ labels: labelStore.data, context: 'folder' }"
      @delete:label="deleteLabel"
    />
  </div>
  <div
    class="container pb-5"
    @mousedown="handleMouseDown"
    @mousemove="handleMouseMove"
  >
    <div
      v-if="isSelecting"
      class="fixed border-2 border-primary bg-primary bg-opacity-30 pointer-events-none z-50"
      :style="selectionBoxStyle"
    />

    <div
      v-if="noteStore.notes.length !== 0 || folderStore.all.lenght !== 0"
      class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 items-stretch mb-14"
      @mousedown="handleMouseDown"
      @mousemove="handleMouseMove"
      @click="handleGridClick"
    >
      <template v-if="folders.all.length">
        <p
          class="col-span-full text-gray-600 dark:text-[color:var(--selected-dark-text)] capitalize mt-2"
        >
          {{ translations.index.folders }}
        </p>
        <div
          v-for="folder in folders.all"
          :key="folder.id"
          :min-height="120"
          :data-item-id="`folder-${folder.id}`"
          @click="
            handleItemClick($event, 'folder', folder.id, getAllVisibleItems)
          "
        >
          <home-folder-card
            :key="folder.id"
            :folder="folder"
            :class="{
              'ring-2 ring-secondary':
                dragOverFolderId === folder.id ||
                (state.query && highlightedFolderIds.has(folder.id)),
              'opacity-50 transform rotate-1': draggedFolderId === folder.id,
              'ring-2 ring-secondary': selectedItems.has(`folder-${folder.id}`),
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
          :data-item-id="`note-${note.id}`"
          @click="handleItemClick($event, 'note', note.id, getAllVisibleItems)"
        >
          <home-note-card
            :key="note.id"
            :note-id="note.id"
            :is-locked="note.isLocked"
            v-bind="{ note }"
            :class="{
              'opacity-50 transform rotate-2': draggedNoteId === note.id,
              'ring-2 ring-secondary': selectedItems.has(`note-${note.id}`),
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
import Mousetrap from 'mousetrap';
import { useTranslation } from '@/composable/translations';
import { useRoute, useRouter } from 'vue-router';
import { useNoteStore } from '@/store/note';
import { useLabelStore } from '@/store/label';
import { useDialog } from '@/composable/dialog';
import {
  sortArray,
  extractNoteText,
  parseItemId,
  areSetsEqual,
} from '@/utils/helper';
import HomeNoteCard from '@/components/home/HomeNoteCard.vue';
import KeyboardNavigation from '@/utils/keyboard-navigation';
import HomeImg from '@/assets/images/home.png';
import ArchiveImg from '@/assets/images/archive.png';
import HomeFolderCard from '@/components/home/HomeFolderCard.vue';
import { useFolderStore } from '@/store/folder';
import HomeSearch from '@/components/home/HomeSearch.vue';
import FolderTree from '@/components/home/FolderTree.vue';
import Actions from '@/components/home/Actions.vue';
import { useSelection } from '@/composable/selection';
import { useDragAndDrop } from '@/composable/dragAndDrop';

export default {
  components: { HomeNoteCard, HomeSearch, HomeFolderCard, FolderTree, Actions },
  setup() {
    const translations = ref({
      sidebar: {},
      index: {},
      card: {},
    });
    const highlightedFolderIds = ref(new Set());
    const currentFolderId = computed(() => route.params.id);

    const route = useRoute();
    const router = useRouter();
    const noteStore = useNoteStore();
    const folderStore = useFolderStore();
    const labelStore = useLabelStore();
    const dialog = useDialog();

    const keyboardNavigation = shallowRef(null);
    const suppressNextClick = ref(false);
    const SCROLL_ZONE_SIZE = 80;
    const SCROLL_SPEED = 5;

    const showMoveModal = ref(false);
    const baseSelection = ref(new Set());
    const cachedItems = [];
    const dragAccumulated = ref(null);
    let cachedScrollY = 0;

    let rafId = null;
    let pendingPointer = null;
    function patchSelectionSet(target, source) {
      for (const v of Array.from(target)) if (!source.has(v)) target.delete(v);
      for (const v of source) if (!target.has(v)) target.add(v);
    }

    const {
      selectedItems,
      isSelecting,
      selectionStart,
      selectionEnd,
      selectionBoxStyle,
      handleItemClick,
      clearSelection,
    } = useSelection({ suppressNextClick });

    const {
      dragOverFolderId,
      draggedNoteId,
      draggedFolderId,
      handleNoteDragStart,
      handleFolderDragStart,
      handleDragEnd,
      handleDragOver,
      handleDragLeave,
    } = useDragAndDrop({ selectedItems, clearSelection });

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

      dragAccumulated.value = new Set(baseSelection.value);
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
          dragAccumulated.value.add(id);
        }
      }

      if (!areSetsEqual(dragAccumulated.value, selectedItems.value)) {
        patchSelectionSet(selectedItems.value, dragAccumulated.value);
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
      dragAccumulated.value = null;
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
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
      selectedItems.value.clear();
      getAllVisibleItems().forEach((item) => selectedItems.value.add(item));
    }

    async function bulkDelete() {
      dialog.confirm({
        title: translations.value.card.confirmPrompt,
        okText: translations.value.card.confirm,
        cancelText: translations.value.card.cancel,
        onConfirm: async () => {
          for (const item of selectedItems.value) {
            const { type, id } = parseItemId(item);
            if (type === 'note') {
              await noteStore.delete(id);
            } else if (type === 'folder') {
              await folderStore.delete(id);
            }
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
        const matchesQuery = normalizedName
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
      window.addEventListener('mouseup', handleMouseUp);

      const sortState = JSON.parse(localStorage.getItem('sort-notes'));
      if (sortState) Object.assign(state, sortState);

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

      Mousetrap.bind(['command+a', 'ctrl+a'], (e) => {
        e.preventDefault();
        selectAll();
      });

      Mousetrap.bind(['del', 'backspace'], (e) => {
        if (selectedItems.value.size > 0) {
          e.preventDefault();
          bulkDelete();
        }
      });
    });

    onMounted(async () => {
      await useTranslation().then((trans) => {
        if (trans) {
          translations.value = trans;
        }
      });
    });

    onUnmounted(() => {
      keyboardNavigation.value?.destroy();

      window.removeEventListener('mouseup', handleMouseUp);
      Mousetrap.reset();
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
      draggedFolderId,
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
      selectAll,
      clearSelection,
      bulkDelete,
      bulkMove,
      handleMoved,
      showMoveModal,
      moveMode,
      isSelecting,
      selectionBoxStyle,
      selectedNotes,
      selectedFolders,
      draggedNoteId,
      handleDragEnd,
      dragOverFolderId,
      getAllVisibleItems,
      childFolders,
      notesInFolder,
      folderPath,
    };
  },
};
</script>
