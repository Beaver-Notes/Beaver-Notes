<template>
  <div
    class="flex flex-col md:flex-row items-start ltr:md:space-x-4 rtl:md:space-x-4 rtl:md:space-x-reverse space-y-2 md:space-y-0 mb-6"
  >
    <!-- Search input -->
    <div class="w-full md:flex-1">
      <div class="flex items-center btn-group">
        <ui-input
          :model-value="query"
          class="w-full note-search-input border rounded-xl"
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
    <div class="flex flex-row w-full md:w-auto ltr:space-x-2 rtl:space-x-2 rtl:space-x-reverse border rounded-xl">
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
  <div
    v-if="visibleLabels.length || label"
    class="flex items-center gap-3 mb-6 min-w-0"
  >
    <div class="flex items-center gap-2 shrink-0">
      <button
        v-if="!label"
        class="inline-flex items-center px-2.5 py-1 rounded-lg text-sm font-medium bg-primary/10 text-primary shrink-0"
        @click="toggleLabel('')"
      >
        All
      </button>
      <button
        v-else
        class="inline-flex items-center gap-1 ltr:pl-2 rtl:pr-2 ltr:pr-1 rtl:pl-1 py-1 rounded-lg text-sm font-medium bg-primary/10 text-primary shrink-0 hover:opacity-80 transition-opacity"
        :style="selectedEntry?.color ? { color: selectedEntry.color, backgroundColor: selectedEntry.color + '1a' } : {}"
        aria-label="Clear label filter"
        @click="toggleLabel(label)"
      >
        #{{ label }}
        <span class="inline-flex items-center justify-center size-5 ltr:-mr-0.5 rtl:-ml-0.5 pointer-events-none">
          <v-remixicon name="riCloseLine" size="14" />
        </span>
      </button>
      <span class="hidden sm:block w-px h-5 bg-neutral-200 dark:bg-neutral-700 shrink-0" aria-hidden="true"></span>
    </div>

    <div
      class="flex-1 flex items-center gap-1.5 overflow-x-auto scrollbar-none py-1 px-1 -mx-1 min-w-0 scroll-pb-1"
      ref="scrollEl"
    >
      <TransitionGroup
        name="chip-filter"
        tag="div"
        class="flex items-center gap-1.5"
      >
        <button
          v-for="(entry, i) in filteredLabels"
          :key="entry.name"
          :data-label="entry.name"
          class="flex-shrink-0 inline-block px-2 py-1 rounded-lg text-sm font-medium transition-[opacity,box-shadow,transform] bg-primary/10 text-primary opacity-60 hover:opacity-100 label-chip relative hover:z-10"
          :class="[
            i === activeSuggestionIndex ? 'opacity-100 ring-1 ring-inset' : '',
          ]"
          :style="
            entry.color
              ? {
                  color: entry.color,
                  backgroundColor: entry.color + '1a',
                  '--tw-ring-color': entry.color,
                }
              : i === activeSuggestionIndex
              ? {
                  '--tw-ring-color': 'var(--color-primary)',
                }
              : {}
          "
          @click="toggleLabel(entry.name)"
        >
          #{{ entry.name }}
        </button>
      </TransitionGroup>
    </div>
  </div>
</template>

<script>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import emitter from 'tiny-emitter/instance';
import { useTranslations } from '@/composable/useTranslations';
import Mousetrap from '@/lib/mousetrap';
import { useLabelStore } from '@/store/label';
import { isMacOSRuntime } from '@/lib/tauri/runtime';
import { debounce } from '@/utils/helpers/index.js';

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
    const isMacOS = isMacOSRuntime();

    const activeSuggestionIndex = ref(-1);
    const scrollEl = ref(null);
    const selectedEntry = computed(() =>
      props.label
        ? { name: props.label, color: labelStore.getColor(props.label) }
        : null
    );

    const sorts = computed(() => ({
      title: translations.value.filter.alphabetical,
      createdAt: translations.value.filter.createdDate,
      updatedAt: translations.value.filter.lastUpdated,
    }));

    /**
     * Labels below the input: all labels unless the query starts with '#'
     * (then matching suggestions), always alphabetical. The selected label is
     * pinned left, hidden from the scroll line.
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
    const filteredLabels = computed(() =>
      visibleLabels.value.filter((e) => e.name !== props.label)
    );

    const emitQuery = debounce((val) => {
      emit('update:query', val.toLocaleLowerCase());
    }, 150);

    function handleQueryChange(val) {
      activeSuggestionIndex.value = -1;
      emitQuery(val);
    }

    function moveSuggestion(dir) {
      if (!filteredLabels.value.length) return;
      const len = filteredLabels.value.length;
      activeSuggestionIndex.value =
        (activeSuggestionIndex.value + dir + len) % len;
    }

    function confirmSuggestion() {
      const entry = filteredLabels.value[activeSuggestionIndex.value];
      if (entry) {
        toggleLabel(entry.name);
        emit('update:query', '');
        activeSuggestionIndex.value = -1;
      }
    }

    function toggleLabel(name) {
      emit('update:label', props.label === name ? '' : name);
    }

    watch(filteredLabels, () => {
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
      filteredLabels,
      activeSuggestionIndex,
      selectedEntry,
      scrollEl,
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
/* hide scrollbars on label strip: keeps 1:1 drag */
.scrollbar-none {
  scrollbar-width: none;
  -ms-overflow-style: none;
}
.scrollbar-none::-webkit-scrollbar {
  display: none;
}
/* label filtering: interruptible FLIP, spring settle */
.chip-filter-move {
  transition: transform 320ms var(--ease-spring);
  will-change: transform;
}
.chip-filter-enter-active {
  transition: opacity 220ms var(--ease-emphasized), transform 220ms var(--ease-spring);
  will-change: transform, opacity;
}
.chip-filter-leave-active {
  transition: opacity 160ms var(--ease-standard), transform 160ms var(--ease-standard);
  will-change: transform, opacity;
}
.chip-filter-enter-from {
  opacity: 0;
  transform: scale(0.92) translateY(2px);
}
.chip-filter-leave-to {
  opacity: 0;
  transform: scale(0.96);
}
@media (prefers-reduced-motion: reduce) {
  .chip-filter-move,
  .chip-filter-enter-active,
  .chip-filter-leave-active {
    transition: opacity 150ms ease;
    transform: none !important;
  }
}
@media (hover: hover) and (pointer: fine) {
  .label-chip:hover {
    transform: scale(1.04);
  }
}
</style>
