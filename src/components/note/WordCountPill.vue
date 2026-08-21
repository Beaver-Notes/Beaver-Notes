<template>
  <teleport to="#pill-dock" :disabled="!dockTarget">
    <ui-pill :fixed="false" :aria-label="ariaLabel">
      <div class="flex items-center py-1 pl-1.5 pr-1.5">
        <!-- Toggle: ring when a limit exists, neutral dot-ring otherwise -->
        <button
          type="button"
          class="flex h-9 shrink-0 items-center rounded-full px-2 transition-transform duration-200 ease-[var(--ease-snappy)] active:scale-95 motion-reduce:transition-none"
          :aria-expanded="docked ? String(isExpanded) : undefined"
          :aria-label="ariaLabel"
          @click="onTriggerClick"
        >
          <svg v-if="limit" width="16" height="16" viewBox="0 0 16 16" class="-rotate-90" aria-hidden="true">
            <circle cx="8" cy="8" r="6.5" fill="none" stroke-width="2.5" class="stroke-neutral-200 dark:stroke-neutral-700" />
            <circle cx="8" cy="8" r="6.5" fill="none" stroke-width="2.5" stroke-linecap="round"
              :stroke-dasharray="circumference" :stroke-dashoffset="dashOffset" :class="ringClass" />
          </svg>
          <svg v-else width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
            <circle cx="8" cy="8" r="6.5" fill="none" stroke-width="2.5" class="stroke-neutral-300 dark:stroke-neutral-600" />
          </svg>
        </button>

        <!-- Expandable body: count + inline limit editor -->
        <div
          class="flex items-center gap-0.5 overflow-hidden transition-[max-width,opacity] duration-300 ease-[var(--ease-snappy)] motion-reduce:transition-none"
          :class="isExpanded ? 'max-w-[26rem] opacity-100' : 'max-w-0 opacity-0'"
          :inert="!isExpanded"
        >
          <span class="shrink-0 whitespace-nowrap pl-1 text-sm font-semibold tabular-nums text-neutral-900 dark:text-neutral-100">{{ countLabel }}</span>
          <input
            v-model="limitInput"
            type="number"
            min="1"
            :placeholder="limit ? String(limit) : ''"
            :aria-label="translations.noteActions?.wordLimit || 'Word limit'"
            class="h-7 w-16 shrink-0 rounded-full border border-neutral-300 bg-transparent px-2.5 text-sm tabular-nums outline-none focus:border-primary dark:border-neutral-600"
            @keydown.enter="applyLimit"
          />
          <button
            type="button"
            class="flex shrink-0 items-center justify-center rounded-full size-9 hover:bg-black/5 dark:hover:bg-white/10 transition-colors text-neutral-500 dark:text-neutral-400"
            :aria-label="translations.noteActions?.setLimit || 'Set'"
            @click="applyLimit"
          >
            <v-remixicon name="riCheckLine" class="size-4" />
          </button>
          <button
            type="button"
            class="flex shrink-0 items-center justify-center rounded-full size-9 hover:bg-black/5 dark:hover:bg-white/10 transition-colors text-neutral-500 dark:text-neutral-400"
            :aria-label="translations.noteActions?.clearLimit || 'Clear'"
            @click="clearLimit"
          >
            <v-remixicon name="riCloseLine" class="size-4" />
          </button>
        </div>
      </div>
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
    // expanded.
    const docked = computed(() => recorder.isRecording.value);
    const isExpanded = computed(
      () => !docked.value || (expandedPill.value ?? 'recording') === 'word-count'
    );

    function onTriggerClick() {
      if (docked.value) toggle('word-count');
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
