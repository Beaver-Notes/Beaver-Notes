<template>
  <div
    v-if="store.showPrompt"
    class="fixed left-1/2 -translate-x-1/2 top-14 z-[60] w-full max-w-lg px-4"
    role="combobox"
    aria-haspopup="listbox"
    :aria-expanded="items.length > 0"
  >
    <div
      class="flex items-center gap-3 px-4 py-3 rounded-lg bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 shadow-xl"
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

    <Transition
      enter-active-class="transition duration-150 ease-out"
      enter-from-class="opacity-0 -translate-y-2"
      enter-to-class="opacity-100 translate-y-0"
      leave-active-class="transition duration-100 ease-in"
      leave-from-class="opacity-100 translate-y-0"
      leave-to-class="opacity-0 -translate-y-1"
    >
      <ui-card
        v-if="state.query.length > 0"
        padding="p-0"
        class="mt-2 overflow-hidden"
      >
        <p
          v-if="items.length === 0"
          class="px-4 py-6 text-center text-sm text-neutral-400"
        >
          {{
            (
              translations.commandPrompt.noResults || 'No results for "{query}"'
            ).replace('{query}', state.query)
          }}
        </p>

        <ul
          v-else
          ref="listRef"
          role="listbox"
          class="max-h-80 overflow-y-auto py-1.5 no-scrollbar scroll-py-1.5"
        >
          <li
            v-for="(item, index) in items"
            :key="item.id || index"
            :ref="(el) => (itemRefs[index] = el)"
            role="option"
            :aria-selected="index === state.selectedIndex"
            class="flex items-center gap-3 mx-2 px-2 py-2 rounded-lg cursor-pointer transition-colors"
            :class="
              index === state.selectedIndex
                ? 'bg-neutral-100 dark:bg-neutral-700'
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
        </ul>

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
</template>

<script setup>
import {
  shallowReactive,
  computed,
  watch,
  onMounted,
  onUnmounted,
  ref,
  nextTick,
} from 'vue';
import { useRouter } from 'vue-router';
import { useTranslations } from '@/composable/useTranslations';
import { useNoteStore } from '@/store/note';
import { useFolderStore } from '@/store/folder';
import { useStore } from '@/store';
import Mousetrap from '@/lib/mousetrap';
import commands from '@/utils/commands';
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
      el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
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

onMounted(() => {
  Mousetrap.bind(['mod+shift+p', 'mod+k'], (e) => {
    e.preventDefault();
    store.showPrompt ? clear() : (store.showPrompt = true);
  });
});

onUnmounted(() => {
  Mousetrap.unbind(['mod+shift+p', 'mod+k']);
});
</script>
