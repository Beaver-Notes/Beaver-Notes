<template>
  <Transition name="command-prompt-shell">
    <div
      v-if="store.showPrompt"
      class="command-prompt-shell fixed left-1/2 -translate-x-1/2 top-14 z-[60] w-full max-w-lg px-4"
      role="combobox"
      aria-haspopup="listbox"
      :aria-expanded="items.length > 0"
    >
      <div
        class="command-prompt-panel flex items-center gap-3 px-4 py-3 rounded-lg bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 shadow-xl"
      >
        <v-remixicon
          name="riSearch2Line"
          size="18"
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

      <Transition name="command-prompt-results">
        <ui-card
          v-if="state.query.length > 0"
          padding="p-0"
          class="command-prompt-results mt-2 overflow-hidden"
        >
          <p
            v-if="items.length === 0"
            class="px-4 py-6 text-center text-sm text-neutral-400"
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
            class="max-h-80 overflow-y-auto py-1.5 no-scrollbar scroll-py-1.5"
          >
            <li
              v-for="(item, index) in items"
              :key="item.id || `${item.type}-${index}`"
              :ref="(el) => (itemRefs[index] = el)"
              role="option"
              :aria-selected="index === state.selectedIndex"
              class="command-prompt-item flex items-center gap-3 mx-2 px-2 py-2 rounded-lg cursor-pointer"
              :class="
                index === state.selectedIndex
                  ? 'is-selected bg-neutral-100 dark:bg-neutral-700'
                  : 'hover:bg-neutral-50 dark:hover:bg-neutral-700/50'
              "
              @click="selectItem(item)"
              @mouseenter="state.selectedIndex = index"
            >
              <div
                class="flex-shrink-0 w-7 h-7 flex items-center justify-center rounded-lg bg-neutral-100 dark:bg-neutral-700"
              >
                <template v-if="item.type === 'folder' && item.icon">
                  <span class="text-base leading-none">{{ item.icon }}</span>
                </template>
                <v-remixicon
                  v-else
                  :name="getIconName(item)"
                  size="15"
                  :class="getIconClass(item)"
                  :style="
                    item.type === 'folder'
                      ? { color: item.color || '#6B7280' }
                      : {}
                  "
                />
              </div>

              <div class="flex-1 min-w-0">
                <div class="flex items-center justify-between gap-2">
                  <span
                    class="text-sm font-medium truncate text-neutral-800 dark:text-neutral-100"
                  >
                    {{
                      item.title ||
                      item.name ||
                      translations.commandPrompt.untitledNote
                    }}
                  </span>
                  <span
                    v-if="item.type !== 'command'"
                    class="flex-shrink-0 text-xs text-neutral-400"
                  >
                    {{ formatDate(item.updatedAt || item.createdAt) }}
                  </span>
                </div>
                <p
                  v-if="item.type === 'note' && !item.isLocked"
                  class="text-xs text-neutral-400 truncate mt-0.5"
                >
                  {{ item.content }}
                </p>
              </div>
            </li>
          </TransitionGroup>

          <div
            class="flex items-center gap-4 px-4 py-2 border-t border-neutral-100 dark:border-neutral-700 text-[10px] uppercase tracking-wider font-semibold text-neutral-400"
          >
            <span class="flex items-center gap-1.5"
              ><kbd class="font-sans">↑↓</kbd>
              {{ translations.commandPrompt.navigateHint || 'navigate' }}</span
            >
            <span class="flex items-center gap-1.5"
              ><kbd class="font-sans">↵</kbd>
              {{ translations.commandPrompt.openHint || 'open' }}</span
            >
            <span class="ml-auto flex items-center gap-1.5"
              >{{ translations.commandPrompt.commandsHintPrefix || 'Type' }}
              <kbd class="font-sans">›</kbd>
              {{
                translations.commandPrompt.commandsHintSuffix || 'for commands'
              }}</span
            >
          </div>
        </ui-card>
      </Transition>
    </div>
  </Transition>
</template>

<script setup>
import { shallowReactive, computed, watch, ref, nextTick } from 'vue';
import { useRouter } from 'vue-router';
import { useTranslations } from '@/composable/useTranslations';
import { useNoteStore } from '@/store/note';
import { useFolderStore } from '@/store/folder';
import { useStore } from '@/store';
import commands from '@/utils/commands';
import { useGlobalShortcuts } from '@/composable/useGlobalShortcuts';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';

dayjs.extend(relativeTime);

const router = useRouter();
const { translations } = useTranslations();
const noteStore = useNoteStore();
const folderStore = useFolderStore();
const store = useStore();

const listRef = ref(null);
const itemRefs = ref([]);
const state = shallowReactive({
  query: '',
  selectedIndex: 0,
});

const prefersReducedMotion = () =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Helper: Extract plain text from complex content structures
const mergeContent = (content) => {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map(mergeContent).join('');
  if (!content) return '';
  if (content.content) return mergeContent(content.content);
  return content.label ?? content.text ?? '';
};

const isCommand = computed(() => state.query.startsWith('>'));
const queryTerm = computed(() =>
  (isCommand.value ? state.query.slice(1) : state.query).toLowerCase().trim()
);

const items = computed(() => {
  if (isCommand.value) {
    return commands
      .map((cmd) => ({ ...cmd, type: 'command' }))
      .filter((c) => c.title.toLowerCase().includes(queryTerm.value));
  }

  const notes = noteStore.notes.map((n) => ({
    ...n,
    type: 'note',
    content: mergeContent(n.content),
  }));

  const folders = (folderStore.folders || []).map((f) => ({
    ...f,
    type: 'folder',
    title: f.name || f.title,
  }));

  return [...notes, ...folders].filter((i) => {
    const title = (i.title || i.name || '').toLowerCase();
    const content = (i.content || '').toLowerCase();
    return title.includes(queryTerm.value) || content.includes(queryTerm.value);
  });
});

// Icon Mapping Logic
const getIconName = (item) => {
  if (item.type === 'folder') return 'riFolder5Fill';
  if (item.type === 'command') return item.icon || 'riCodeLine';
  return item.isLocked ? 'riLockLine' : 'riFile2Line';
};

const getIconClass = (item) => {
  if (item.type === 'command') return 'text-primary';
  if (item.type === 'note' && item.isLocked) return 'text-secondary';
  return 'text-neutral-500';
};

const formatDate = (ts) => {
  if (!ts) return '';
  const d = dayjs(ts);
  const diff = dayjs().diff(d, 'day');
  if (diff === 0) return d.fromNow();
  if (diff < 7) return d.format('ddd');
  return d.format(diff < 365 ? 'MMM D' : 'MMM D, YYYY');
};

const clear = () => {
  store.showPrompt = false;
  state.query = '';
  state.selectedIndex = 0;
};

const selectItem = (item = items.value[state.selectedIndex]) => {
  if (!item) return;
  if (item.handler) item.handler();
  else if (item.type === 'folder') router.push(`/folder/${item.id}`);
  else if (item.type === 'note' && item.id) router.push(`/note/${item.id}`);
  clear();
};

const keydownHandler = (e) => {
  if (e.key === 'Escape') clear();
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
    selectItem();
  }
};

// Scroll active item into view
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
  }
);

// Reset index on search
watch(
  () => state.query,
  () => {
    state.selectedIndex = 0;
    itemRefs.value = []; // Clear refs cache
  }
);

useGlobalShortcuts(() => {
  const togglePrompt = (_, combo) => {
    const editorFocused = Boolean(
      document.activeElement?.closest('.ProseMirror')
    );
    if (combo === 'mod+k' && editorFocused) return false;
    store.showPrompt ? clear() : (store.showPrompt = true);
  };

  return {
    'mod+shift+p': togglePrompt,
    'mod+k': togglePrompt,
  };
});
</script>

<style>
.command-prompt-shell-enter-active,
.command-prompt-shell-leave-active {
  transition: opacity var(--motion-fast) var(--ease-standard),
    transform var(--motion-fast) var(--ease-standard);
}

.command-prompt-shell-enter-from,
.command-prompt-shell-leave-to {
  opacity: 0;
  transform: translate3d(-50%, -4px, 0);
}

.command-prompt-results-enter-active,
.command-prompt-results-leave-active {
  transition: opacity var(--motion-fast) var(--ease-standard),
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
  transition: background-color var(--motion-fast) var(--ease-standard),
    transform var(--motion-fast) var(--ease-standard);
  transform: translate3d(0, 0, 0);
}

.command-prompt-item.is-selected {
  transform: translate3d(1px, 0, 0);
}

.command-prompt-item-enter-active,
.command-prompt-item-leave-active {
  transition: opacity var(--motion-fast) var(--ease-standard),
    transform var(--motion-fast) var(--ease-standard);
}

.command-prompt-item-enter-from,
.command-prompt-item-leave-to {
  opacity: 0;
  transform: translate3d(0, 3px, 0);
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
  .command-prompt-item-leave-to,
  .command-prompt-item.is-selected {
    opacity: 1;
    transform: none;
  }
}
</style>
