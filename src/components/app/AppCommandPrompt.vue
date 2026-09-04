<template>
  <Transition name="command-prompt-shell">
    <div
      v-if="uiState.showPrompt"
      class="command-prompt-shell fixed left-1/2 -translate-x-1/2 top-16 z-[60] w-full max-w-4xl px-4"
      :style="shellOffsetStyle"
      role="combobox"
      aria-haspopup="listbox"
      :aria-expanded="items.length > 0"
      @keydown.escape="onShellEscape"
    >
      <!-- Search bar -->
      <div
        class="command-prompt-panel flex items-center gap-3 px-4 py-2.5 rounded-2xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 shadow-xl"
      >
        <v-remixicon
          name="riSearch2Line"
          size="16"
          class="flex-shrink-0 text-neutral-400"
        />
        <input
          v-model="state.query"
          v-autofocus
          type="text"
          class="flex-1 bg-transparent text-sm text-neutral-800 dark:text-neutral-100 placeholder:text-neutral-400 outline-none"
          :placeholder="
            translations.commandPrompt.placeholder ||
            'Search notes, folders, or type › for commands…'
          "
          @keydown="keydownHandler"
        />
      </div>

      <!-- Results card -->
      <Transition name="command-prompt-results">
        <ui-card
          v-if="state.query.length > 0"
          padding="p-0"
          radius="rounded-2xl"
          bg="bg-white dark:bg-neutral-900"
          class="command-prompt-results mt-1 overflow-hidden"
        >
          <!-- Filters -->
          <div
            v-if="!isCommand"
            class="flex items-center gap-2 px-2 py-2 border-b border-neutral-100 dark:border-neutral-800 overflow-x-auto no-scrollbar"
          >
            <ui-button type="button" @click="toggleTitleOnly">
              <v-remixicon name="riHeading" />
              {{ translations.commandPrompt.titleOnly || 'Title only' }}
            </ui-button>
            <ui-button
              type="button"
              @click="toggleFoldersOnly"
            >
              <v-remixicon name="riFolderLine" />
              {{ translations.commandPrompt.foldersOnly || 'Folders' }}
            </ui-button>
            <ui-select
              v-model="state.folderScope"
              :options="folderOptions"
              class="shrink-0 max-w-40"
              menu-class="!z-[70]"
              @update:modelValue="resetSelection"
            />
          </div>

          <div class="flex min-h-0 max-h-[340px]">
            <!-- Results list -->
            <div
              class="flex-1 min-w-0 overflow-y-auto no-scrollbar scroll-py-2"
            >
              <p
                v-if="items.length === 0"
                class="p-4 text-center text-sm text-neutral-400"
              >
                {{
                  (
                    translations.commandPrompt.noResults ||
                    'No results for "{query}"'
                  ).replace('{query}', state.query)
                }}
              </p>

              <TransitionGroup
                v-else
                ref="listRef"
                name="command-prompt-item"
                tag="ul"
                role="listbox"
                class="py-1"
              >
                <li
                  v-for="(item, index) in items"
                  :key="item.id || `${item.type}-${index}`"
                  :ref="(el) => (itemRefs[index] = el)"
                  role="option"
                  :aria-selected="index === state.selectedIndex"
                  class="command-prompt-item flex gap-3 mx-2 px-3 py-2 rounded-lg cursor-pointer"
                  :class="
                    index === state.selectedIndex
                      ? 'is-selected bg-neutral-100 dark:bg-neutral-800'
                      : 'hover:bg-neutral-50 dark:hover:bg-neutral-800/50'
                  "
                  @click="selectItem(item)"
                  @mouseenter="state.selectedIndex = index"
                >
                  <div class="flex-shrink-0 pt-0.5">
                    <template v-if="item.type === 'folder' && item.icon">
                      <span class="text-base leading-none">{{
                        item.icon
                      }}</span>
                    </template>
                    <v-remixicon
                      v-else
                      :name="getIconName(item)"
                      size="16"
                      :class="getIconClass(item)"
                      :style="
                        item.type === 'folder'
                          ? { color: item.color || '#6366f1' }
                          : {}
                      "
                    />
                  </div>

                  <div class="flex-1 min-w-0">
                    <p
                      class="text-sm font-medium text-neutral-800 dark:text-neutral-100 truncate"
                    >
                      {{
                        item.title ||
                        item.name ||
                        translations.commandPrompt.untitledNote
                      }}
                    </p>
                    <p
                      v-if="item.type === 'note'"
                      class="text-xs text-neutral-400 mt-0.5 truncate"
                    >
                      <span
                        v-if="item._folderName"
                        class="uppercase tracking-wide"
                        >{{ item._folderName }}</span
                      >
                      <span v-if="item._folderName"> · </span>
                      <span>{{
                        formatDate(item.updatedAt || item.createdAt)
                      }}</span>
                    </p>
                    <p
                      v-if="item.type === 'note' && item._snippet"
                      class="text-xs text-neutral-400 dark:text-neutral-500 mt-0.5 line-clamp-1"
                    >
                      {{ item._snippet }}
                    </p>
                    <p
                      v-if="item.type === 'folder'"
                      class="text-xs text-neutral-400 mt-0.5"
                    >
                      {{ item._noteCount || 0 }} notes
                    </p>
                  </div>
                </li>
              </TransitionGroup>
            </div>

            <!-- Preview pane -->
            <div
              v-if="previewItem && previewItem.type === 'note'"
              class="hidden lg:flex flex-col w-80 shrink-0 border-l overflow-hidden"
            >
              <div class="flex-1 overflow-y-auto no-scrollbar px-4 py-3">
                <p
                  v-if="previewItem._folderName"
                  class="text-[10px] font-semibold uppercase tracking-wider text-neutral-400 mb-0.5"
                >
                  {{ previewItem._folderName }}
                </p>
                <h3
                  class="text-sm font-bold text-neutral-800 dark:text-neutral-100 mb-3 leading-snug"
                >
                  {{
                    previewItem.title || translations.commandPrompt.untitledNote
                  }}
                </h3>
                <div
                  v-if="previewNote"
                  data-preview-shell
                  class="relative overflow-hidden rounded-lg"
                >
                  <NotePreviewBlocks
                    v-if="previewBlocks.length"
                    :blocks="previewBlocks"
                    :meta="previewMeta"
                  />
                  <p
                    v-else-if="previewText"
                    class="text-xs text-neutral-500 dark:text-neutral-400 line-clamp-6 leading-relaxed whitespace-pre-wrap"
                  >
                    {{ previewText }}
                  </p>
                </div>
              </div>
            </div>
          </div>

          <!-- Footer -->
          <div
            class="flex items-center justify-between px-4 py-1.5 border-t border-neutral-100 dark:border-neutral-800 text-[11px] text-neutral-400"
          >
            <span class="flex items-center gap-3">
              <span class="flex items-center gap-1">
                <kbd class="font-sans">↑↓</kbd> navigate
              </span>
              <span class="flex items-center gap-1">
                <kbd class="font-sans">↵</kbd> open
              </span>
              <span class="flex items-center gap-1">
                <kbd class="font-sans">⌘↵</kbd> new tab
              </span>
            </span>
            <span v-if="!isCommand" class="tabular-nums">
              {{ items.length }} {{ items.length === 1 ? 'result' : 'results' }}
            </span>
          </div>
        </ui-card>
      </Transition>
    </div>
  </Transition>
</template>

<script setup>
import {
  shallowReactive,
  computed,
  watch,
  ref,
  nextTick,
  onMounted,
} from 'vue';
import { useRouter } from 'vue-router';
import { useTranslations } from '@/composable/useTranslations';
import { useNoteStore } from '@/store/note';
import { useFolderStore } from '@/store/folder';
import { noteSearchText } from '@/utils/note/note-search-text.js';
import { matchNoteIdsByQuery } from '@/utils/note/search-matches.js';
import commands from '@/utils/ui/commands.js';
import { useUiState } from '@/composable/useUiState';
import { useSidebar } from '@/composable/useSidebar';
import { backend } from '@/lib/tauri-bridge';
import NotePreviewBlocks from '@/components/note/NotePreviewBlocks.vue';
import { bindGlobalShortcuts } from '@/utils/ui/globalShortcuts.js';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';

dayjs.extend(relativeTime);

const router = useRouter();
const { translations } = useTranslations();
const noteStore = useNoteStore();
const folderStore = useFolderStore();
const uiState = useUiState();
const { expanded: sidebarExpanded } = useSidebar();

const shellOffsetStyle = computed(() => {
  if (backend.isMobileRuntime() || uiState.inReaderMode) return undefined;
  return { left: `calc(50% + ${sidebarExpanded.value ? '8rem' : '2rem'})` };
});

const onShellEscape = (e) => {
  if (e.defaultPrevented) return;
  clear();
};

const itemRefs = ref([]);
const state = shallowReactive({
  query: '',
  selectedIndex: 0,
  titleOnly: false,
  foldersOnly: false,
  folderScope: '',
});

const prefersReducedMotion = () =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const isCommand = computed(() => state.query.startsWith('>'));
const queryTerm = computed(() =>
  (isCommand.value ? state.query.slice(1) : state.query).toLowerCase().trim(),
);

const folderNameById = (folderId) =>
  folderId
    ? (folderStore.folders || []).find((f) => f.id === folderId)?.name || ''
    : '';

const noteSnippet = (content) => {
  if (!content || typeof content !== 'object') return '';
  const nodes = content.content || (Array.isArray(content) ? content : []);
  for (const node of nodes) {
    if (node.type === 'paragraph') {
      const text = (node.content || [])
        .map((c) => c.text || '')
        .join('')
        .trim();
      if (text) return text.length > 100 ? text.slice(0, 97) + '…' : text;
    }
  }
  return '';
};

const items = computed(() => {
  if (isCommand.value) {
    const allCommands = commands.map((cmd) => ({ ...cmd, type: 'command' }));
    return allCommands.filter((c) =>
      c.title.toLowerCase().includes(queryTerm.value),
    );
  }

  const notes = noteStore.notes.map((n) => ({
    ...n,
    type: 'note',
    content: noteSearchText(n),
    _folderName: folderNameById(n.folderId),
    _snippet: noteSnippet(n.content),
  }));

  const folders = (folderStore.folders || []).map((f) => ({
    ...f,
    type: 'folder',
    title: f.name || f.title,
    _noteCount: noteStore.notes.filter((n) => n.folderId === f.id).length,
  }));

  const matchedNoteIds = matchNoteIdsByQuery(notes, state.query);
  let allItems = [...notes, ...folders];

  if (state.folderScope) {
    allItems = allItems.filter((i) => {
      if (i.type === 'note') return (i.folderId ?? '') === state.folderScope;
      if (i.type === 'folder') return i.id === state.folderScope;
      return true;
    });
  }

  if (state.foldersOnly) {
    allItems = allItems.filter((i) => i.type === 'folder');
  }

  if (state.titleOnly) {
    return allItems.filter((i) => {
      const title = (i.title || i.name || '').toLowerCase();
      return title.includes(queryTerm.value);
    });
  }

  if (matchedNoteIds === null) {
    return allItems.filter((i) => {
      const title = (i.title || i.name || '').toLowerCase();
      const content = (i.content || '').toLowerCase();
      return (
        title.includes(queryTerm.value) || content.includes(queryTerm.value)
      );
    });
  }
  return allItems.filter((i) => {
    if (i.type === 'note') return matchedNoteIds.has(i.id);
    const title = (i.title || i.name || '').toLowerCase();
    return title.includes(queryTerm.value);
  });
});

const folderOptions = computed(() => [
  {
    value: '',
    text: translations.value?.commandPrompt?.allFolders || 'All folders',
  },
  ...(folderStore.folders || []).map((f) => ({
    value: f.id,
    text: f.name || f.title,
  })),
]);

const previewItem = computed(() => items.value[state.selectedIndex] || null);

const previewNote = computed(() => {
  const item = previewItem.value;
  if (!item || item.type !== 'note') return null;
  return noteStore.notes.find((n) => n.id === item.id) || null;
});

const previewBlocks = computed(() => {
  return previewNote.value?.cardPreview?.blocks || [];
});

const previewMeta = computed(() => {
  const cp = previewNote.value?.cardPreview;
  if (!cp) return '';
  return cp.hasMore || cp.mediaCount > 1
    ? `+${(cp.mediaCount || 0) > 1 ? cp.mediaCount - 1 : ''} more`
    : '';
});

const previewText = computed(() => {
  return previewNote.value?.preview || previewNote.value?.searchText || '';
});

const getIconName = (item) => {
  if (item.type === 'folder') return 'riFolder3Line';
  if (item.type === 'command') return item.icon || 'riCodeLine';
  return item.isLocked ? 'riLockLine' : 'riFileTextLine';
};

const getIconClass = (item) => {
  if (item.type === 'command') return 'text-primary';
  if (item.type === 'note' && item.isLocked) return 'text-secondary';
  return 'text-neutral-400';
};

const formatDate = (ts) => {
  if (!ts) return '';
  const d = dayjs(ts);
  return `Edited ${d.format('MMM D')}`;
};

const toggleTitleOnly = () => {
  state.titleOnly = !state.titleOnly;
  resetSelection();
};

const toggleFoldersOnly = () => {
  state.foldersOnly = !state.foldersOnly;
  resetSelection();
};

const resetSelection = () => {
  state.selectedIndex = 0;
  itemRefs.value = [];
};

const clear = () => {
  uiState.showPrompt = false;
  state.query = '';
  state.selectedIndex = 0;
  state.titleOnly = false;
  state.foldersOnly = false;
  state.folderScope = '';
};

const selectItem = (item = items.value[state.selectedIndex]) => {
  if (!item) return;
  if (item.handler) item.handler();
  else if (item.type === 'folder') router.push(`/folder/${item.id}`);
  else if (item.type === 'note' && item.id) router.push(`/note/${item.id}`);
  clear();
};

const openSelectedInNewTab = () => {
  const item = items.value[state.selectedIndex];
  if (!item) return;
  if (item.type === 'note' && item.id) {
    const resolved = router.resolve(`/note/${item.id}`);
    window.open(resolved.href, '_blank');
  } else if (item.type === 'folder') {
    const resolved = router.resolve(`/folder/${item.id}`);
    window.open(resolved.href, '_blank');
  }
  clear();
};

const keydownHandler = (e) => {
  if (items.value.length === 0) return;

  if (e.key === 'ArrowDown') {
    e.preventDefault();
    state.selectedIndex = (state.selectedIndex + 1) % items.value.length;
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    state.selectedIndex =
      (state.selectedIndex - 1 + items.value.length) % items.value.length;
  } else if (e.key === 'Enter') {
    e.preventDefault();
    if (e.metaKey || e.ctrlKey) {
      openSelectedInNewTab();
    } else {
      selectItem();
    }
  }
};

watch(
  () => state.selectedIndex,
  async (idx) => {
    await nextTick();
    const el = itemRefs.value[idx];
    if (el) {
      el.scrollIntoView({
        block: 'nearest',
        behavior: prefersReducedMotion() ? 'auto' : 'smooth',
      });
    }
  },
);

watch(
  () => state.query,
  () => {
    state.selectedIndex = 0;
    itemRefs.value = [];
  },
);

const togglePrompt = (_, combo) => {
  const editorFocused = Boolean(
    document.activeElement?.closest('.ProseMirror'),
  );
  if (combo === 'mod+k' && editorFocused) return false;
  try {
    if (uiState.showPrompt) clear();
    else uiState.showPrompt = true;
  } catch (e) {
    console.error('[togglePrompt]', e);
  }
};

let _unregPromptShortcuts;
onMounted(() => {
  _unregPromptShortcuts = bindGlobalShortcuts({
    'mod+shift+p': togglePrompt,
    'mod+k': togglePrompt,
  });
});
</script>

<style>
.command-prompt-shell-enter-active,
.command-prompt-shell-leave-active {
  transition:
    opacity var(--motion-fast) var(--ease-standard),
    transform var(--motion-fast) var(--ease-standard);
}

.command-prompt-shell-enter-from,
.command-prompt-shell-leave-to {
  opacity: 0;
  transform: translate3d(-50%, -4px, 0);
}

.command-prompt-results-enter-active,
.command-prompt-results-leave-active {
  transition:
    opacity var(--motion-fast) var(--ease-standard),
    transform var(--motion-fast) var(--ease-standard);
}

.command-prompt-results-enter-from,
.command-prompt-results-leave-to {
  opacity: 0;
  transform: translate3d(0, -4px, 0);
}

.command-prompt-panel,
.command-prompt-results {
  will-change: transform, opacity;
}

.command-prompt-item {
  transition: background-color var(--motion-fast) var(--ease-standard);
}

.command-prompt-item-enter-active,
.command-prompt-item-leave-active {
  transition:
    opacity var(--motion-fast) var(--ease-standard),
    transform var(--motion-fast) var(--ease-standard);
}

.command-prompt-item-enter-from,
.command-prompt-item-leave-to {
  opacity: 0;
  transform: translateY(3px);
}

.command-prompt-item-move {
  transition: transform var(--motion-fast) var(--ease-standard);
}

@media (prefers-reduced-motion: reduce) {
  .command-prompt-shell-enter-active,
  .command-prompt-shell-leave-active,
  .command-prompt-results-enter-active,
  .command-prompt-results-leave-active,
  .command-prompt-item,
  .command-prompt-item-enter-active,
  .command-prompt-item-leave-active,
  .command-prompt-item-move {
    transition-duration: 0.01ms;
  }

  .command-prompt-shell-enter-from,
  .command-prompt-shell-leave-to,
  .command-prompt-results-enter-from,
  .command-prompt-results-leave-to,
  .command-prompt-item-enter-from,
  .command-prompt-item-leave-to {
    opacity: 1;
    transform: none;
  }
}
</style>
