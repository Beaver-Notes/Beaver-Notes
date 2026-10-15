<template>
  <teleport to="#pill-dock" :disabled="!dockTarget">
    <ui-pill
      ref="pillRef"
      :fixed="false"
      aria-label="Reader controls"
      class="transition-opacity duration-300 ease-[var(--ease-snappy)] motion-reduce:transition-none max-w-[calc(100vw-2rem)]"
      :class="{
        // The sheet teleports over the dock (z-50 vs z-[70]); the pill must not
        // float on top of its content. The sheet closes via overlay/Escape/swipe.
        'opacity-0 pointer-events-none':
          (!visible && !showAa) || (isMobile && showAa),
      }"
    >
      <div class="flex items-center py-1 pl-1.5 pr-1.5">
        <button
          data-testid="reader-done"
          class="shrink-0 rounded-full px-3 py-1.5 text-sm font-medium bg-neutral-900 text-white dark:bg-white dark:text-neutral-900 hover:opacity-90 transition-opacity"
          @click="emit('exit')"
        >
          Done
        </button>
        <div
          class="mx-2 h-5 w-px shrink-0 bg-neutral-200 dark:bg-neutral-700"
        />
        <button
          data-testid="reader-aa"
          class="flex h-9 shrink-0 items-center justify-center rounded-full px-3 text-sm font-semibold tracking-tight hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
          :class="
            showAa
              ? 'bg-black/5 dark:bg-white/10 text-neutral-900 dark:text-neutral-100'
              : 'text-neutral-600 dark:text-neutral-300'
          "
          :aria-expanded="showAa ? 'true' : 'false'"
          aria-label="Text appearance"
          @click="toggleAa"
        >
          Aa
        </button>
        <div
          v-if="!isMobile"
          class="min-w-0 transition-[max-width,opacity] duration-300 ease-[var(--ease-snappy)] motion-reduce:transition-none"
          :class="
            showAa
              ? 'max-w-[28rem] opacity-100 ml-1 overflow-x-auto overscroll-x-contain'
              : 'max-w-0 opacity-0 overflow-hidden'
          "
          :inert="!showAa"
        >
          <reader-controls @change="forward" />
        </div>
      </div>
    </ui-pill>
  </teleport>

  <ui-modal
    v-if="isMobile"
    v-model="showAa"
    title="Text appearance"
    blur
  >
    <reader-controls @change="forward" />
  </ui-modal>
</template>

<script setup>
import { ref, watch, onMounted, onUnmounted } from 'vue';
import { backend } from '@/lib/tauri-bridge';
import ReaderControls from '@/components/note/ReaderControls.vue';
import { usePillDock } from '@/composable/usePillDock';

const emit = defineEmits(['exit', 'change']);
const { expandedPill } = usePillDock();
const isMobile = backend.isMobileRuntime();

const visible = ref(true);
const showAa = ref(false);
const pillRef = ref(null);
let timer = null;

const dockTarget =
  typeof document !== 'undefined' && !!document.getElementById('pill-dock');

function clearTimer() {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
}

function startTimer() {
  if (
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  )
    return;
  if (showAa.value) return;
  clearTimer();
  timer = setTimeout(() => {
    visible.value = false;
  }, 3000);
}

function reset() {
  visible.value = true;
  startTimer();
}

function forward(next) {
  emit('change', next);
}

function toggleAa() {
  showAa.value = !showAa.value;
}

// The pill stays alive while controls are open (inline panel or modal sheet);
// closing in either mode restarts the idle hide.
watch(showAa, (open) => {
  visible.value = true;
  clearTimer();
  if (!open) startTimer();
});

function onDocumentClick(e) {
  if (!showAa.value) return;
  const el = pillRef.value?.$el || pillRef.value;
  if (el && el.contains(e.target)) return;
  showAa.value = false;
}

onMounted(() => {
  // Claim the pill dock so recording/word-count collapse to their bare
  // toggles while reading. Only take an unclaimed dock, and only release
  // what we claimed, so an explicit mid-read toggle is never clobbered.
  if (expandedPill.value === null) expandedPill.value = 'reader';
  startTimer();
  window.addEventListener('mousemove', reset);
  window.addEventListener('scroll', reset);
  window.addEventListener('touchstart', reset);
  // Mobile dismisses via the modal's own overlay/Escape/swipe, which live
  // outside the pill — a document click there would close the sheet instantly.
  if (!isMobile) document.addEventListener('click', onDocumentClick);
});

onUnmounted(() => {
  if (expandedPill.value === 'reader') expandedPill.value = null;
  clearTimer();
  window.removeEventListener('mousemove', reset);
  window.removeEventListener('scroll', reset);
  window.removeEventListener('touchstart', reset);
  document.removeEventListener('click', onDocumentClick);
});

defineExpose({ visible });
</script>

<style scoped>
@media (prefers-reduced-motion: reduce) {
  .reader-chrome--hidden {
    opacity: 1 !important;
    pointer-events: auto !important;
  }
}
</style>
