<template>
  <ui-card
    v-if="store.showPrompt"
    padding="p-4"
    class="command-prompt w-full max-w-lg mx-auto shadow-xl m-4"
  >
    <div class="flex items-center border-b pb-4 mb-4">
      <v-remixicon
        name="riSearch2Line"
        class="mr-3 text-neutral-600 dark:text-[color:var(--selected-dark-text)]"
      />
      <input
        v-model="state.query"
        v-autofocus
        class="w-full bg-transparent command-input"
        :placeholder="translations.commandPrompt.placeholder || '-'"
        @keyup.enter="selectItem"
        @keyup.esc="clear"
        @keydown="keydownHandler"
      />
    </div>
    <ui-list class="max-h-80 overflow-auto space-y-1 scroll command-scroll">
      <ui-list-item
        v-for="(item, index) in items"
        :key="item.id"
        :active="index === state.selectedIndex"
        :class="{ 'active-command-item': index === state.selectedIndex }"
        class="cursor-pointer flex items-center justify-between"
        @click="selectItem(item, true)"
      >
        <div class="w-full">
          <p class="text-overflow w-full flex flex-1 justify-between">
            <span class="flex items-center">
              <template v-if="item.type === 'folder' && item.icon">
                <span
                  class="text-neutral-600 dark:text-[color:var(--selected-dark-text)] mr-2 w-4"
                >
                  {{ item.icon }}
                </span>
              </template>

              <v-remixicon
                v-else-if="item.type === 'folder'"
                name="riFolder5Fill"
                class="text-neutral-600 dark:text-[color:var(--selected-dark-text)] mr-2 w-4"
                :style="{ color: item.color || '#6B7280' }"
              />

              <v-remixicon
                v-else-if="item.type === 'note' && item.isLocked"
                name="riLockLine"
                class="text-neutral-600 dark:text-[color:var(--selected-dark-text)] mr-2 w-4"
              />

              <v-remixicon
                v-else-if="item.type === 'note'"
                name="riFile2Line"
                class="text-neutral-600 dark:text-[color:var(--selected-dark-text)] mr-2 w-4"
              />
              <template v-else-if="item.type === 'command'">
                <v-remixicon
                  v-if="item.icon"
                  :name="item.icon"
                  class="text-neutral-600 dark:text-[color:var(--selected-dark-text)] mr-2 w-4"
                />
                <v-remixicon
                  v-else
                  name="riCodeLine"
                  class="text-neutral-600 dark:text-[color:var(--selected-dark-text)] mr-2 w-4"
                />
              </template>
              {{
                item.title ||
                item.name ||
                translations.commandPrompt.untitledNote
              }}
            </span>

            <span v-if="!isCommand && item.type !== 'command'">
              {{ formatDate(item.updatedAt || item.createdAt) }}
            </span>
          </p>
          <p
            v-if="!isCommand && !item.isLocked && item.type === 'note'"
            class="text-overflow text-xs"
          >
            {{ item.content }}
          </p>
        </div>
      </ui-list-item>
    </ui-list>
  </ui-card>
</template>

<script>
import {
  shallowReactive,
  computed,
  watch,
  onMounted,
  onUnmounted,
  ref,
} from 'vue';
import { useTranslation } from '@/composable/translations';
import { useRouter } from 'vue-router';
import { useNoteStore } from '@/store/note';
import { useFolderStore } from '@/store/folder';
import { debounce } from '@/utils/helper';
import Mousetrap from '@/lib/mousetrap';
import commands from '@/utils/commands';
import dayjs from 'dayjs';
import { useStore } from '@/store';

export default {
  setup() {
    const router = useRouter();
    const noteStore = useNoteStore();
    const folderStore = useFolderStore();
    const store = useStore();

    const formatDate = (timestamp) =>
      dayjs(timestamp).format('YYYY-MM-DD hh:mm');

    const state = shallowReactive({
      query: '',
      selectedIndex: 0,
    });

    store.showPrompt = false;

    const mergeContent = (content) => {
      if (typeof content === 'string') {
        return content;
      }
      if (Array.isArray(content)) {
        return content.map((c) => mergeContent(c)).join('');
      }
      if (content == null) {
        return '';
      }
      if ('content' in content) {
        return mergeContent(content.content);
      }
      if (content.type.toLocaleLowerCase().includes('label')) {
        return `#${content.attrs.id}`;
      }
      return content.label ?? content.text ?? '';
    };

    const isCommand = computed(() => state.query.startsWith('>'));
    const queryTerm = computed(() => {
      const searchQuery = state.query.toLocaleLowerCase();
      return (isCommand.value ? searchQuery.substr(1) : searchQuery).trim();
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

      const allItems = [...notesWithType, ...foldersWithType];

      return allItems.filter(({ title, name, content }) => {
        const itemTitle = title || name || '';
        const isInTitle = itemTitle
          .toLocaleLowerCase()
          .includes(queryTerm.value);
        const isInContent =
          content && content.toLocaleLowerCase().includes(queryTerm.value);

        return isInTitle || isInContent;
      });
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
      let selectedItem = items.value[state.selectedIndex];

      if (isItem) selectedItem = item;

      if (selectedItem.handler) {
        selectedItem.handler();
      } else if (selectedItem.type === 'folder') {
        router.push(`/folder/${selectedItem.id}`);
      } else if (selectedItem.type === 'note') {
        selectedItem.id && router.push(`/note/${selectedItem.id}`);
      }

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

        const activeCommandItem = document.querySelector(
          '.active-command-item'
        );

        activeCommandItem &&
          activeCommandItem.scrollIntoView({
            behavior: 'smooth',
            block: 'center',
          });
      }, 100)
    );

    const translations = ref({
      commandPrompt: {},
    });

    onMounted(async () => {
      Mousetrap.bind('mod+shift+p', () => {
        if (store.showPrompt) return clear();

        document.querySelector('.command-input')?.focus();
        store.showPrompt = true;
      });
      await useTranslation().then((trans) => {
        if (trans) {
          translations.value = trans;
        }
      });
    });

    const escQuit = (event) => {
      if (event.code === 'Escape') {
        clear();
      }
    };

    onMounted(() => {
      document.addEventListener('keyup', escQuit);
    });

    onUnmounted(() => {
      document.removeEventListener('keyup', escQuit);
    });

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

<style scoped>
.command-prompt {
  position: fixed;
  transform: translateX(-50%);
  left: 50%;
  z-index: 99999;
}
</style>
