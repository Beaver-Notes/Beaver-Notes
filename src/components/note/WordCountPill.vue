<template>
  <teleport to="#pill-dock" :disabled="!dockTarget">
    <ui-pill :fixed="false" :aria-label="ariaLabel">
      <!-- Collapsed (docked default): the popover must not open; the tap
           expands the pill first. -->
      <ui-popover placement="top" :disabled="!isExpanded">
        <template #trigger>
          <button
            class="flex items-center rounded-full px-1 py-0.5 text-xs font-medium text-neutral-600 transition-[background-color,transform] duration-200 ease-[var(--ease-snappy)] hover:bg-neutral-100 active:scale-95 dark:text-neutral-300 dark:hover:bg-neutral-800"
            :class="isExpanded ? 'gap-1.5' : 'gap-0'"
            :aria-expanded="docked ? String(isExpanded) : undefined"
            :aria-label="ariaLabel"
            @click="onTriggerClick"
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
            <!-- Neutral affordance for a collapsed pill without a limit. -->
            <svg
              v-else-if="!isExpanded"
              width="16"
              height="16"
              viewBox="0 0 16 16"
              aria-hidden="true"
            >
              <circle
                cx="8"
                cy="8"
                r="6.5"
                fill="none"
                stroke-width="2.5"
                class="stroke-neutral-300 dark:stroke-neutral-600"
              />
            </svg>
            <span
              class="overflow-hidden whitespace-nowrap transition-[max-width,opacity] duration-300 ease-[var(--ease-snappy)] motion-reduce:transition-none"
              :class="
                isExpanded ? 'max-w-[8rem] opacity-100' : 'max-w-0 opacity-0'
              "
              >{{ countLabel }}</span
            >
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
  </teleport>
</template>

<script>
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { debounce } from '@/utils/helpers/index.js';
import { useNoteStore } from '@/store/note';
import { useTranslations } from '@/composable/useTranslations';
import { useAudioRecorder } from '@/composable/useAudioRecorder';
import { usePillDock } from '@/composable/usePillDock';

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
    const recorder = useAudioRecorder();
    const { expandedPill, toggle } = usePillDock();

    // The dock target is rendered by App.vue before any pill mounts; fall
    // back to inline rendering when it is absent (isolated unit tests).
    const dockTarget =
      typeof document !== 'undefined' &&
      !!document.getElementById('pill-dock');

    // Docked while a recording is visible next to us; solo means always
    // expanded with today's tap behavior.
    const docked = computed(() => recorder.isRecording.value);
    const isExpanded = computed(
      () => !docked.value || (expandedPill.value ?? 'recording') === 'word-count'
    );

    function onTriggerClick() {
      if (docked.value && !isExpanded.value) toggle('word-count');
    }

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
      dockTarget,
      docked,
      isExpanded,
      onTriggerClick,
      applyLimit,
      clearLimit,
    };
  },
};
</script>
