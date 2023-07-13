<template>
  <ui-card
    v-if="state.show"
    padding="p-4"
    class="command-prompt w-full max-w-lg mx-auto shadow-xl m-4"
  >
    <div class="flex items-center border-b pb-4 mb-4">
      <v-remixicon
        name="riSearch2Line"
        class="mr-3 text-gray-600 dark:text-gray-200"
      />
      <input
        v-model="state.query"
        v-autofocus
        class="w-full bg-transparent command-input"
        placeholder="Search file or type '>' to search commands"
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
        class="cursor-pointer"
        @click="selectItem(item, true)"
      >
        <p class="text-overflow flex-1">{{ item.title || 'Untitled note' }}</p>
        <template v-if="item.shortcut">
          <kbd v-for="key in item.shortcut" :key="key">
            {{ key }}
          </kbd>
        </template>
      </ui-list-item>
    </ui-list>
  </ui-card>
</template>
<script>
import { shallowReactive, computed, watch } from 'vue';
import { useRouter } from 'vue-router';
import { useNoteStore } from '@/store/note';
import { debounce } from '@/utils/helper';
import Mousetrap from '@/lib/mousetrap';
import commands from '@/utils/commands';

export default {
  setup() {
    const router = useRouter();
    const noteStore = useNoteStore();

    const state = shallowReactive({
      show: false,
      query: '',
      selectedIndex: 0,
    });

    const items = computed(() => {
      const searchQuery = state.query.toLocaleLowerCase();
      const isCommand = searchQuery.startsWith('>');
      const filterItems = isCommand ? commands : noteStore.notes;

      return filterItems.filter(({ title }) =>
        title
          .toLocaleLowerCase()
          .includes(isCommand ? searchQuery.substr(1) : searchQuery)
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
      let selectedItem = items.value[state.selectedIndex];

      if (isItem) selectedItem = item;

      if (selectedItem.handler) {
        selectedItem.handler();
      } else {
        selectedItem.id && router.push(`/note/${selectedItem.id}`);
      }

      clear();
    }
    function clear() {
      state.show = false;
      state.query = '';
      state.selectedIndex = 0;
    }

    Mousetrap.bind(['mod+p', 'mod+shift+p'], (event, combo) => {
      if (state.show) return clear();

      if (combo === 'mod+shift+p') state.query = '>';

      document.querySelector('.command-input')?.focus();
      state.show = true;
    });

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

    return {
      items,
      state,
      clear,
      selectItem,
      keydownHandler,
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
