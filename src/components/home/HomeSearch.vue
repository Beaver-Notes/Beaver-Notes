<template>
  <div
    class="flex flex-col md:flex-row items-start md:space-x-4 space-y-2 md:space-y-0 mb-6"
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
  <!-- Label filter: single inline row — selected pinned left, rest scrolls -->
  <div
    v-if="visibleLabels.length || label"
    class="flex items-center gap-3 mb-6 min-w-0"
  >
    <!-- Left: pinned selection (All or selected tag) — not scrolling, inline with line -->
    <div class="flex items-center gap-2 shrink-0">
      <button
        v-if="!label"
        class="inline-flex items-center px-2.5 py-0.5 rounded-full text-sm font-medium ring-1 ring-inset bg-primary/10 text-primary shrink-0"
        :style="{ '--tw-ring-color': 'var(--color-primary)' }"
        @click="toggleLabel('')"
      >
        All
      </button>
      <span
        v-else
        class="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-full text-sm font-medium ring-1 ring-inset bg-primary/10 text-primary shrink-0"
        :style="selectedEntry?.color ? { color: selectedEntry.color, backgroundColor: selectedEntry.color + '1a', '--tw-ring-color': selectedEntry.color } : { '--tw-ring-color': 'var(--color-primary)' }"
      >
        #{{ label }}
        <button
          aria-label="Clear label filter"
          class="inline-flex items-center justify-center size-5 rounded-full hover:bg-black/10 dark:hover:bg-white/15 -mr-0.5"
          @click="toggleLabel(label)"
        >
          <v-remixicon name="riCloseLine" size="14" />
        </button>
      </span>
      <!-- subtle divider to scrollable line -->
      <span class="hidden sm:block w-px h-5 bg-neutral-200 dark:bg-neutral-700 shrink-0" aria-hidden="true"></span>
    </div>

    <!-- Right: scrollable remaining labels — selected hidden from main line -->
    <div
      class="flex-1 flex items-center gap-1.5 overflow-x-auto scrollbar-none py-0.5 min-w-0"
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
          class="flex-shrink-0 inline-block px-1.5 py-0.5 rounded-lg text-sm font-medium transition-[opacity,box-shadow] bg-primary/10 text-primary opacity-60 hover:opacity-100 label-chip"
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
     * Labels shown below the input.
     * - When query is empty or doesn't start with #: show all labels
     * - When query starts with #: filter to matching labels (acting as suggestions)
     * Always sorted alphabetically. Selected label is hidden from the scroll line
     * and shown pinned left inline.
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
/* hide scrollbars on label strip — keeps 1:1 drag */
.scrollbar-none {
  scrollbar-width: none;
  -ms-overflow-style: none;
}
.scrollbar-none::-webkit-scrollbar {
  display: none;
}
/* apple-design: label filtering — interruptible FLIP, spring settle */
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
    transform: scale(1.08);
  }
}
</style>
