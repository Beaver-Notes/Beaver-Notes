<template>
  <div class="w-64">
    <ui-input
      v-model.lowercase="query"
      prepend-icon="riSearchLine"
      :placeholder="translations.menu.searchHeadings || '-'"
      autofocus
      class="mb-4"
      @keydown="keydownHandler"
    />
    <ui-list
      class="space-y-1 overflow-auto scroll"
      style="max-height: calc(100vh - 10rem)"
    >
      <ui-list-item
        v-for="(heading, index) in filteredHeadings"
        :key="heading.text"
        :class="paddings[heading.tag]"
        :active="index === selectedIndex"
        class="cursor-pointer"
        @click="scrollIntoView(heading.el)"
      >
        <p class="text-overflow">{{ heading.text }}</p>
      </ui-list-item>
    </ui-list>
  </div>
</template>
<script>
import { shallowRef, computed, ref, onMounted } from 'vue';
import { useTranslation } from '@/composable/translations';

export default {
  props: {
    headings: {
      type: Array,
      default: () => [],
    },
    editor: {
      type: Object,
      default: () => ({}),
    },
  },
  emits: ['close'],
  setup(props, { emit }) {
    const paddings = {
      H1: 'pl-4',
      H2: 'pl-8',
      H3: 'pl-12',
      H4: 'pl-16',
    };

    const query = shallowRef('');
    const selectedIndex = shallowRef(0);

    const filteredHeadings = computed(() =>
      props.headings.filter(({ text }) =>
        text.toLocaleLowerCase().includes(query.value)
      )
    );

    function keydownHandler({ key }) {
      switch (key) {
        case 'ArrowUp':
          event.preventDefault();
          upHandler();
          break;
        case 'ArrowDown':
          event.preventDefault();
          downHandler();
          break;
        case 'Enter': {
          const heading = filteredHeadings.value[selectedIndex.value];
          if (!heading || heading.pos == null) return;

          props.editor.commands.setTextSelection(heading.pos);
          scrollIntoView(heading.el);
          break;
        }
        case 'Escape':
          emit('close');
          break;
        default:
          selectedIndex.value = 0;
      }
    }
    function scrollIntoView(el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    function upHandler() {
      selectedIndex.value =
        (selectedIndex.value + filteredHeadings.value.length - 1) %
        filteredHeadings.value.length;
    }
    function downHandler() {
      selectedIndex.value =
        (selectedIndex.value + 1) % filteredHeadings.value.length;
    }

    // Translations

    const translations = ref({
      menu: {},
    });

    onMounted(async () => {
      await useTranslation().then((trans) => {
        if (trans) {
          translations.value = trans;
        }
      });
    });
    return {
      query,
      paddings,
      selectedIndex,
      keydownHandler,
      scrollIntoView,
      filteredHeadings,
      translations,
    };
  },
};
</script>
