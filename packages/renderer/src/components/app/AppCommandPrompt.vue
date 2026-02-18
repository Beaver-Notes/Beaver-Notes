<template>
  <div
    v-if="store.showPrompt"
    class="fixed left-1/2 -translate-x-1/2 top-14 z-50 w-full max-w-lg px-4"
  >
    <!-- Search Bar -->
    <div
      class="flex items-center gap-3 px-4 py-3 rounded-xl bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 shadow-lg"
    >
      <v-remixicon
        name="riSearch2Line"
        size="18"
        class="flex-shrink-0 text-neutral-400"
      />

      <input
        v-model="state.query"
        v-autofocus
        class="flex-1 bg-transparent text-sm text-neutral-800 dark:text-neutral-100 placeholder:text-neutral-400 outline-none"
        :placeholder="
          translations.commandPrompt.placeholder ||
          'Search notes, folders, or type › for commands…'
        "
        @keyup.enter="selectItem"
        @keyup.esc="clear"
        @keydown="keydownHandler"
      />
    </div>

    <!-- Results Panel -->
    <Transition
      enter-active-class="transition duration-150 ease-out"
      enter-from-class="opacity-0 -translate-y-2"
      enter-to-class="opacity-100 translate-y-0"
      leave-active-class="transition duration-100 ease-in"
      leave-from-class="opacity-100 translate-y-0"
      leave-to-class="opacity-0 -translate-y-1"
    >
      <div
        v-if="state.query.length > 0"
        class="mt-2 rounded-xl overflow-hidden bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 shadow-lg"
      >
        <!-- Empty state -->
        <p
          v-if="items.length === 0"
          class="px-4 py-6 text-center text-sm text-neutral-400"
        >
          No results for "{{ state.query }}"
        </p>

        <!-- List -->
        <ul v-else class="max-h-80 overflow-y-auto py-1.5 no-scrollbar">
          <li
            v-for="(item, index) in items"
            :key="item.id"
            :class="
              index === state.selectedIndex
                ? 'bg-neutral-100 dark:bg-neutral-700'
                : 'hover:bg-neutral-50 dark:hover:bg-neutral-700/50'
            "
            class="active-command-item flex items-center gap-3 mx-2 px-2 py-2 rounded-lg cursor-pointer"
            @click="selectItem(item, true)"
          >
            <!-- Icon -->
            <div
              class="flex-shrink-0 w-7 h-7 flex items-center justify-center rounded-md bg-neutral-100 dark:bg-neutral-700"
            >
              <template v-if="item.type === 'folder' && item.icon">
                <span class="text-base leading-none">{{ item.icon }}</span>
              </template>
              <v-remixicon
                v-else-if="item.type === 'folder'"
                name="riFolder5Fill"
                size="15"
                :style="{ color: item.color || '#6B7280' }"
              />
              <v-remixicon
                v-else-if="item.type === 'note' && item.isLocked"
                name="riLockLine"
                size="15"
                class="text-secondary"
              />
              <v-remixicon
                v-else-if="item.type === 'note'"
                name="riFile2Line"
                size="15"
                class="text-neutral-500"
              />
              <v-remixicon
                v-else-if="item.type === 'command'"
                :name="item.icon || 'riCodeLine'"
                size="15"
                class="text-primary"
              />
            </div>

            <!-- Text -->
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
                  v-if="!isCommand && item.type !== 'command'"
                  class="flex-shrink-0 text-xs text-neutral-400"
                >
                  {{ formatDate(item.updatedAt || item.createdAt) }}
                </span>
              </div>
              <p
                v-if="!isCommand && !item.isLocked && item.type === 'note'"
                class="text-xs text-neutral-400 truncate mt-0.5"
              >
                {{ item.content }}
              </p>
            </div>
          </li>
        </ul>

        <!-- Footer -->
        <div
          class="flex items-center gap-3 px-4 py-2 border-t border-neutral-100 dark:border-neutral-700 text-xs text-neutral-400"
        >
          <span>↑↓ navigate</span>
          <span>↵ open</span>
          <span class="ml-auto">› for commands</span>
        </div>
      </div>
    </Transition>
  </div>
</template>

<script>
import { shallowReactive, computed, watch, onMounted, onUnmounted } from 'vue';
import { useTranslations } from '@/composable/useTranslations';
import { useRouter } from 'vue-router';
import { useNoteStore } from '@/store/note';
import { useFolderStore } from '@/store/folder';
import { debounce } from '@/utils/helper';
import Mousetrap from '@/lib/mousetrap';
import commands from '@/utils/commands';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { useStore } from '@/store';

dayjs.extend(relativeTime);

export default {
  setup() {
    const { translations } = useTranslations();
    const router = useRouter();
    const noteStore = useNoteStore();
    const folderStore = useFolderStore();
    const store = useStore();

    const formatDate = (timestamp) => {
      if (!timestamp) return '';
      const d = dayjs(timestamp);
      const diffDays = dayjs().diff(d, 'day');
      if (diffDays === 0) return d.fromNow();
      if (diffDays < 7) return d.format('ddd');
      if (diffDays < 365) return d.format('MMM D');
      return d.format('MMM D, YYYY');
    };

    const state = shallowReactive({ query: '', selectedIndex: 0 });

    store.showPrompt = false;

    const mergeContent = (content) => {
      if (typeof content === 'string') return content;
      if (Array.isArray(content))
        return content.map((c) => mergeContent(c)).join('');
      if (content == null) return '';
      if ('content' in content) return mergeContent(content.content);
      if (content.type.toLocaleLowerCase().includes('label'))
        return `#${content.attrs.id}`;
      return content.label ?? content.text ?? '';
    };

    const isCommand = computed(() => state.query.startsWith('>'));
    const queryTerm = computed(() => {
      const q = state.query.toLocaleLowerCase();
      return (isCommand.value ? q.substr(1) : q).trim();
    });

    const items = computed(() => {
      if (isCommand.value) {
        return commands
          .map((item) => ({ ...item, type: 'command' }))
          .filter(({ title }) =>
            title.toLocaleLowerCase().includes(queryTerm.value)
          );
      }

      const notesWithType = noteStore.notes.map((note) => ({
        ...note,
        type: 'note',
        content: mergeContent(note.content),
      }));

      const foldersWithType = (folderStore.folders || []).map((folder) => ({
        ...folder,
        type: 'folder',
        title: folder.name || folder.title,
      }));

      return [...notesWithType, ...foldersWithType].filter(
        ({ title, name, content }) => {
          const t = (title || name || '').toLocaleLowerCase();
          return (
            t.includes(queryTerm.value) ||
            (content && content.toLocaleLowerCase().includes(queryTerm.value))
          );
        }
      );
    });

    function keydownHandler(event) {
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        state.selectedIndex =
          (state.selectedIndex + items.value.length - 1) % items.value.length;
      } else if (event.key === 'ArrowDown') {
        event.preventDefault();
        state.selectedIndex = (state.selectedIndex + 1) % items.value.length;
      }
    }

    function selectItem(item, isItem) {
      const selected = isItem ? item : items.value[state.selectedIndex];
      if (!selected) return;
      if (selected.handler) selected.handler();
      else if (selected.type === 'folder')
        router.push(`/folder/${selected.id}`);
      else if (selected.type === 'note')
        selected.id && router.push(`/note/${selected.id}`);
      clear();
    }

    function clear() {
      store.showPrompt = false;
      state.query = '';
      state.selectedIndex = 0;
    }

    watch(items, () => {
      state.selectedIndex = 0;
    });

    watch(
      () => state.selectedIndex,
      debounce(() => {
        if (items.value.length <= 6) return;
        document
          .querySelector('.active-command-item')
          ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 100)
    );

    onMounted(async () => {
      Mousetrap.bind('mod+shift+p', () => {
        if (store.showPrompt) return clear();
        store.showPrompt = true;
      });
    });

    const escQuit = (e) => {
      if (e.code === 'Escape') clear();
    };
    onMounted(() => document.addEventListener('keyup', escQuit));
    onUnmounted(() => document.removeEventListener('keyup', escQuit));

    return {
      items,
      translations,
      store,
      state,
      isCommand,
      clear,
      selectItem,
      keydownHandler,
      formatDate,
      mergeContent,
    };
  },
};
</script>
