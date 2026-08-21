<template>
  <ui-pill :aria-label="ariaLabel">
    <ui-popover placement="top">
      <template #trigger>
        <button
          class="flex items-center gap-1.5 rounded-full px-1 py-0.5 text-xs font-medium text-neutral-600 transition-colors hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
          :aria-label="ariaLabel"
        >
          <svg
            v-if="limit"
            width="16"
            height="16"
            viewBox="0 0 16 16"
            class="-rotate-90"
            aria-hidden="true"
          >
            <circle
              cx="8"
              cy="8"
              r="6.5"
              fill="none"
              stroke-width="2.5"
              class="stroke-neutral-200 dark:stroke-neutral-700"
            />
            <circle
              cx="8"
              cy="8"
              r="6.5"
              fill="none"
              stroke-width="2.5"
              stroke-linecap="round"
              :stroke-dasharray="circumference"
              :stroke-dashoffset="dashOffset"
              :class="ringClass"
            />
          </svg>
          <span>{{ countLabel }}</span>
        </button>
      </template>

      <div class="w-44 p-1">
        <label
          class="mb-1 block text-xs font-medium dark:text-[color:var(--selected-dark-text)]"
        >
          {{ translations.noteActions?.wordLimit || 'Word limit' }}
        </label>
        <div class="flex items-center gap-1">
          <input
            v-model="limitInput"
            type="number"
            min="1"
            :placeholder="limit ? String(limit) : ''"
            class="h-8 w-full min-w-0 rounded-lg border border-neutral-300 bg-transparent px-2 text-sm outline-none focus:ring-2 focus:ring-primary dark:border-neutral-600"
            @keydown.enter="applyLimit"
          />
          <button
            class="h-8 shrink-0 rounded-lg px-2 text-sm font-medium transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-800"
            @click="applyLimit"
          >
            {{ translations.noteActions?.setLimit || 'Set' }}
          </button>
          <button
            class="h-8 shrink-0 rounded-lg px-2 text-sm font-medium transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-800"
            @click="clearLimit"
          >
            {{ translations.noteActions?.clearLimit || 'Clear' }}
          </button>
        </div>
      </div>
    </ui-popover>
  </ui-pill>
</template>

<script>
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { debounce } from '@/utils/helpers/index.js';
import { useNoteStore } from '@/store/note';
import { useTranslations } from '@/composable/useTranslations';

const RING_RADIUS = 6.5;
// Dasharray/dashoffset are fractions of the ring's perimeter.
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

export default {
  name: 'WordCountPill',
  props: {
    editor: { type: Object, required: true },
    note: { type: Object, required: true },
  },
  setup(props) {
    const noteStore = useNoteStore();
    const { translations } = useTranslations();

    const words = ref(0);
    const limitInput = ref('');

    const limit = computed(() => props.note.wordCountLimit);
    const ratio = computed(() =>
      limit.value ? words.value / limit.value : 0
    );
    const dashOffset = computed(
      () => RING_CIRCUMFERENCE * (1 - Math.min(ratio.value, 1))
    );
    const ringClass = computed(() => {
      if (ratio.value >= 1) return 'stroke-red-500';
      if (ratio.value >= 0.9) return 'stroke-amber-500';
      return 'stroke-neutral-400 dark:stroke-neutral-500';
    });
    const countLabel = computed(() =>
      limit.value
        ? `${words.value} / ${limit.value}`
        : `${words.value} ${translations.value.noteActions?.words || 'words'}`
    );
    const ariaLabel = computed(
      () => translations.value.noteActions?.wordCount || 'Word count'
    );

    function readWords() {
      const count = props.editor?.storage?.characterCount;
      if (count) words.value = count.words();
    }

    // characterCount.words() walks the whole document; debounce so fast
    // typing costs at most one traversal per 200ms instead of per keystroke.
    const debouncedReadWords = debounce(readWords, 200);

    function applyLimit() {
      // NaN fails the > 0 check, so empty/garbage/negative input clears.
      const parsed = parseInt(limitInput.value, 10);
      noteStore.update(props.note.id, {
        wordCountLimit: parsed > 0 ? parsed : null,
      });
      limitInput.value = '';
    }

    function clearLimit() {
      noteStore.update(props.note.id, { wordCountLimit: null });
      limitInput.value = '';
    }

    onMounted(() => {
      readWords();
      props.editor.on('update', debouncedReadWords);
    });

    onUnmounted(() => {
      props.editor.off('update', debouncedReadWords);
    });

    return {
      translations,
      limit,
      limitInput,
      circumference: RING_CIRCUMFERENCE,
      dashOffset,
      ringClass,
      countLabel,
      ariaLabel,
      applyLimit,
      clearLimit,
    };
  },
};
</script>
