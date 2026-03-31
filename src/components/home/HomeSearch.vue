<template>
  <div
    class="flex flex-col md:flex-row items-start md:space-x-4 space-y-2 md:space-y-0"
  >
    <!-- Search input -->
    <div class="w-full md:flex-1 rtl:ml-4">
      <div class="flex items-center btn-group">
        <ui-input
          :model-value="query"
          class="w-full note-search-input"
          prepend-icon="riSearch2Line"
          :clearable="true"
          :placeholder="translations.filter.searchPlaceholder || '-'"
          @keydown.esc="$event.target.blur()"
          @keydown.down.prevent="moveSuggestion(1)"
          @keydown.up.prevent="moveSuggestion(-1)"
          @keydown.enter.prevent="confirmSuggestion"
          @change="handleQueryChange"
        />
      </div>
    </div>

    <!-- Sort filter -->
    <div class="flex flex-row w-full md:w-auto space-x-2 border rounded-lg">
      <div class="flex items-center divide-x btn-group flex-1">
        <ui-button
          v-tooltip="
            sortOrder === 'asc'
              ? translations.filter.ascending
              : translations.filter.descending
          "
          icon
          class="ltr:rounded-r-none rtl:rounded-l-none"
          @click="
            $emit('update:sortOrder', sortOrder === 'asc' ? 'desc' : 'asc')
          "
        >
          <v-remixicon
            :name="sortOrder === 'asc' ? 'riSortAsc' : 'riSortDesc'"
          />
        </ui-button>
        <ui-select
          :model-value="sortBy"
          class="w-full"
          @change="$emit('update:sortBy', $event)"
        >
          <option v-for="(name, id) in sorts" :key="id" :value="String(id)">
            {{ name }}
          </option>
        </ui-select>
      </div>
    </div>
  </div>
  <div>
    <div
      v-if="visibleLabels.length"
      class="flex items-center gap-1.5 mt-2 overflow-x-auto scrollbar-none mb-6"
      style="scrollbar-width: none"
    >
      <button
        v-for="(entry, i) in visibleLabels"
        :key="entry.name"
        class="flex-shrink-0 inline-block px-1.5 py-0.5 rounded-lg text-sm font-medium transition-all bg-primary/10 text-primary"
        :class="[
          label === entry.name
            ? 'ring-1 ring-inset'
            : 'opacity-60 hover:opacity-100 hover:scale-110',
          i === activeSuggestionIndex ? 'opacity-100 ring-1 ring-inset' : '',
        ]"
        :style="
          entry.color
            ? {
                color: entry.color,
                backgroundColor: entry.color + '1a',
                '--tw-ring-color': entry.color,
              }
            : label === entry.name || i === activeSuggestionIndex
            ? {
                '--tw-ring-color': 'var(--color-primary)',
              }
            : {}
        "
        @click="toggleLabel(entry.name)"
      >
        #{{ entry.name }}
      </button>
    </div>
  </div>
</template>

<script>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import emitter from 'tiny-emitter/instance';
import { useTranslations } from '@/composable/useTranslations';
import Mousetrap from '@/lib/mousetrap';
import { useLabelStore } from '@/store/label';

function debounce(fn, delay) {
  let timer;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}

export default {
  props: {
    sortOrder: { type: String, default: 'asc' },
    sortBy: { type: String, default: 'createdAt' },
    query: { type: String, default: '' },
    label: { type: String, default: '' },
  },
  emits: ['update:query', 'update:label', 'update:sortOrder', 'update:sortBy'],
  setup(props, { emit }) {
    const { translations } = useTranslations();
    const labelStore = useLabelStore();
    const isMacOS = navigator.platform.toUpperCase().includes('MAC');

    const activeSuggestionIndex = ref(-1);

    const sorts = computed(() => ({
      title: translations.value.filter.alphabetical,
      createdAt: translations.value.filter.createdDate,
      updatedAt: translations.value.filter.lastUpdated,
    }));

    /**
     * Labels shown below the input.
     * - When query is empty or doesn't start with #: show all labels
     * - When query starts with #: filter to matching labels (acting as suggestions)
     * Always sorted alphabetically.
     */
    const visibleLabels = computed(() => {
      const term = props.query.startsWith('#')
        ? props.query.slice(1).toLowerCase()
        : props.query.toLowerCase();

      return [...labelStore.data]
        .filter((name) => !term || name.toLowerCase().startsWith(term))
        .sort((a, b) => a.localeCompare(b))
        .map((name) => ({ name, color: labelStore.getColor(name) }));
    });

    const emitQuery = debounce((val) => {
      emit('update:query', val.toLocaleLowerCase());
    }, 150);

    function handleQueryChange(val) {
      activeSuggestionIndex.value = -1;
      emitQuery(val);
    }

    function moveSuggestion(dir) {
      if (!visibleLabels.value.length) return;
      const len = visibleLabels.value.length;
      activeSuggestionIndex.value =
        (activeSuggestionIndex.value + dir + len) % len;
    }

    function confirmSuggestion() {
      const entry = visibleLabels.value[activeSuggestionIndex.value];
      if (entry) {
        toggleLabel(entry.name);
        emit('update:query', '');
        activeSuggestionIndex.value = -1;
      }
    }

    function toggleLabel(name) {
      emit('update:label', props.label === name ? '' : name);
    }

    watch(visibleLabels, () => {
      activeSuggestionIndex.value = -1;
    });

    onMounted(() => {
      const combo = isMacOS ? 'mod+f' : 'ctrl+f';
      Mousetrap.bind(combo, (e) => {
        e.preventDefault();
        document.querySelector('.note-search-input input')?.focus();
      });

      emitter.on('clear-label', () => {
        emit('update:label', '');
        emit('update:query', '');
      });
    });

    onUnmounted(() => {
      Mousetrap.unbind(isMacOS ? 'mod+f' : 'ctrl+f');
    });

    return {
      sorts,
      translations,
      visibleLabels,
      activeSuggestionIndex,
      handleQueryChange,
      moveSuggestion,
      confirmSuggestion,
      toggleLabel,
    };
  },
};
</script>

<style>
.btn-group .ui-select__content {
  @apply rounded-l-none;
}
</style>
