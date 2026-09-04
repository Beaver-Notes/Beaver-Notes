<template>
  <teleport to="#pill-dock" :disabled="!dockTarget">
    <ui-pill
      ref="pillRef"
      :fixed="false"
      aria-label="Reader controls"
      class="transition-opacity duration-300 ease-[var(--ease-snappy)] motion-reduce:transition-none"
      :class="{ 'opacity-0 pointer-events-none': !visible && !showAa }"
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
          class="flex items-center gap-0.5 overflow-hidden transition-[max-width,opacity] duration-300 ease-[var(--ease-snappy)] motion-reduce:transition-none"
          :class="
            showAa ? 'max-w-[28rem] opacity-100 ml-1' : 'max-w-0 opacity-0'
          "
          :inert="!showAa"
        >
          <div class="flex items-center gap-1 shrink-0">
            <div
              class="flex items-center rounded-full bg-neutral-100 dark:bg-neutral-800 p-0.5"
            >
              <button
                data-testid="theme-light"
                class="rounded-full px-2.5 py-1 text-xs font-medium transition-colors"
                :class="
                  prefs.theme === 'light'
                    ? 'bg-white dark:bg-neutral-700 shadow-sm text-neutral-900 dark:text-neutral-100'
                    : 'text-neutral-500 dark:text-neutral-400 hover:text-neutral-700'
                "
                @click="onTheme('light')"
              >
                Light
              </button>
              <button
                data-testid="theme-sepia"
                class="rounded-full px-2.5 py-1 text-xs font-medium transition-colors"
                :class="
                  prefs.theme === 'sepia'
                    ? 'bg-white dark:bg-neutral-700 shadow-sm text-neutral-900 dark:text-neutral-100'
                    : 'text-neutral-500 dark:text-neutral-400 hover:text-neutral-700'
                "
                @click="onTheme('sepia')"
              >
                Sepia
              </button>
              <button
                data-testid="theme-dark"
                class="rounded-full px-2.5 py-1 text-xs font-medium transition-colors"
                :class="
                  prefs.theme === 'dark'
                    ? 'bg-white dark:bg-neutral-700 shadow-sm text-neutral-900 dark:text-neutral-100'
                    : 'text-neutral-500 dark:text-neutral-400 hover:text-neutral-700'
                "
                @click="onTheme('dark')"
              >
                Dark
              </button>
            </div>
            <div class="h-5 w-px bg-neutral-200 dark:bg-neutral-700 mx-0.5" />
            <div
              class="flex items-center rounded-full bg-neutral-100 dark:bg-neutral-800 p-0.5"
            >
              <button
                data-testid="size-compact"
                aria-label="Compact"
                class="flex items-center justify-center rounded-full w-7 h-7 transition-colors"
                :class="
                  prefs.size === 14
                    ? 'bg-white dark:bg-neutral-700 shadow-sm text-neutral-900 dark:text-neutral-100'
                    : 'text-neutral-500 dark:text-neutral-400'
                "
                @click="onSizePreset(14)"
              >
                <span class="font-semibold leading-none" style="font-size: 9px"
                  >A</span
                >
              </button>
              <button
                data-testid="size-default"
                aria-label="Default"
                class="flex items-center justify-center rounded-full w-7 h-7 transition-colors"
                :class="
                  prefs.size === 18
                    ? 'bg-white dark:bg-neutral-700 shadow-sm text-neutral-900 dark:text-neutral-100'
                    : 'text-neutral-500 dark:text-neutral-400'
                "
                @click="onSizePreset(18)"
              >
                <span class="font-semibold leading-none" style="font-size: 11px"
                  >A</span
                >
              </button>
              <button
                data-testid="size-big"
                aria-label="Big"
                class="flex items-center justify-center rounded-full w-7 h-7 transition-colors"
                :class="
                  prefs.size === 21
                    ? 'bg-white dark:bg-neutral-700 shadow-sm text-neutral-900 dark:text-neutral-100'
                    : 'text-neutral-500 dark:text-neutral-400'
                "
                @click="onSizePreset(21)"
              >
                <span class="font-semibold leading-none" style="font-size: 13px"
                  >A</span
                >
              </button>
              <button
                data-testid="size-huge"
                aria-label="Huge"
                class="flex items-center justify-center rounded-full w-7 h-7 transition-colors"
                :class="
                  prefs.size === 26
                    ? 'bg-white dark:bg-neutral-700 shadow-sm text-neutral-900 dark:text-neutral-100'
                    : 'text-neutral-500 dark:text-neutral-400'
                "
                @click="onSizePreset(26)"
              >
                <span class="font-semibold leading-none" style="font-size: 15px"
                  >A</span
                >
              </button>
              <input
                data-testid="size-slider"
                type="range"
                min="12"
                max="32"
                :value="prefs.size"
                class="hidden"
                aria-hidden="true"
                @input="onSizeSlider"
              />
              <span
                data-testid="size-value"
                class="hidden"
                aria-hidden="true"
                >{{ prefs.size }}</span
              >
              <button
                data-testid="size-minus"
                class="hidden"
                aria-hidden="true"
                @click="onSize(-1)"
              ></button>
              <button
                data-testid="size-plus"
                class="hidden"
                aria-hidden="true"
                @click="onSize(1)"
              ></button>
            </div>
            <div class="h-5 w-px bg-neutral-200 dark:bg-neutral-700 mx-0.5" />
            <div
              class="flex items-center rounded-full bg-neutral-100 dark:bg-neutral-800 p-0.5"
            >
              <button
                data-testid="family-default"
                class="rounded-full px-2 py-1 text-xs font-medium transition-colors"
                :class="
                  prefs.family === 'default'
                    ? 'bg-white dark:bg-neutral-700 shadow-sm text-neutral-900 dark:text-neutral-100'
                    : 'text-neutral-500 dark:text-neutral-400'
                "
                @click="onFamily('default')"
              >
                Aa
              </button>
              <button
                data-testid="family-serif"
                class="rounded-full px-2 py-1 text-xs font-medium transition-colors font-serif"
                :class="
                  prefs.family === 'serif'
                    ? 'bg-white dark:bg-neutral-700 shadow-sm text-neutral-900 dark:text-neutral-100'
                    : 'text-neutral-500 dark:text-neutral-400'
                "
                @click="onFamily('serif')"
              >
                Serif
              </button>
              <button
                data-testid="family-sans"
                class="rounded-full px-2 py-1 text-xs font-medium transition-colors"
                :class="
                  prefs.family === 'sans'
                    ? 'bg-white dark:bg-neutral-700 shadow-sm text-neutral-900 dark:text-neutral-100'
                    : 'text-neutral-500 dark:text-neutral-400'
                "
                @click="onFamily('sans')"
              >
                Sans
              </button>
            </div>
          </div>
        </div>
      </div>
    </ui-pill>
  </teleport>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue';
import { useReaderPrefs } from '@/composable/useReaderPrefs';

const emit = defineEmits(['exit', 'change', 'update:prefs']);
const { prefs, setTheme, setSize, setLine, setFamily } = useReaderPrefs();

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

function onTheme(t) {
  setTheme(t);
  emit('change', { theme: t });
  emit('update:prefs', prefs.value);
}

function onSize(delta) {
  const next = Math.min(32, Math.max(12, prefs.value.size + delta));
  setSize(next);
  emit('change', { size: next });
  emit('update:prefs', prefs.value);
}
function onSizePreset(size) {
  setSize(size);
  emit('change', { size });
  emit('update:prefs', prefs.value);
}
function onSizeSlider(e) {
  const v = Number(e.target.value);
  setSize(v);
  emit('change', { size: v });
  emit('update:prefs', prefs.value);
}

function onLine(delta) {
  const next = Math.min(
    2.4,
    Math.max(1.2, Math.round((prefs.value.line + delta) * 10) / 10),
  );
  setLine(next);
  emit('change', { line: next });
  emit('update:prefs', prefs.value);
}

function onFamily(f) {
  setFamily(f);
  emit('change', { family: f });
  emit('update:prefs', prefs.value);
}

function toggleAa() {
  showAa.value = !showAa.value;
  visible.value = true;
  clearTimer();
  if (!showAa.value) startTimer();
}

function onDocumentClick(e) {
  if (!showAa.value) return;
  const el = pillRef.value?.$el || pillRef.value;
  if (el && el.contains(e.target)) return;
  showAa.value = false;
  startTimer();
}

onMounted(() => {
  startTimer();
  window.addEventListener('mousemove', reset);
  window.addEventListener('scroll', reset);
  window.addEventListener('touchstart', reset);
  document.addEventListener('click', onDocumentClick);
});

onUnmounted(() => {
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
