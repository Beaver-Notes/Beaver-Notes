<template>
  <div
    class="flex flex-col gap-3 md:flex-row md:items-center md:shrink-0 md:gap-1"
  >
    <div
      class="flex w-full items-center rounded-full bg-neutral-100 p-0.5 dark:bg-neutral-800 md:w-auto"
    >
      <button
        data-testid="theme-light"
        class="min-h-[44px] flex-1 rounded-full px-2.5 py-3 text-sm font-medium transition-colors md:min-h-0 md:flex-none md:py-1 md:text-xs"
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
        class="min-h-[44px] flex-1 rounded-full px-2.5 py-3 text-sm font-medium transition-colors md:min-h-0 md:flex-none md:py-1 md:text-xs"
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
        class="min-h-[44px] flex-1 rounded-full px-2.5 py-3 text-sm font-medium transition-colors md:min-h-0 md:flex-none md:py-1 md:text-xs"
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

    <div
      class="mx-0.5 hidden h-5 w-px shrink-0 bg-neutral-200 dark:bg-neutral-700 md:block"
    />

    <div
      class="flex w-full items-center rounded-full bg-neutral-100 p-0.5 dark:bg-neutral-800 md:w-auto"
    >
      <button
        data-testid="size-compact"
        aria-label="Compact"
        class="flex h-11 w-11 flex-1 items-center justify-center rounded-full transition-colors md:h-7 md:w-7 md:flex-none"
        :class="
          prefs.size === 14
            ? 'bg-white dark:bg-neutral-700 shadow-sm text-neutral-900 dark:text-neutral-100'
            : 'text-neutral-500 dark:text-neutral-400'
        "
        @click="onSizePreset(14)"
      >
        <span class="font-semibold leading-none" style="font-size: 9px">A</span>
      </button>
      <button
        data-testid="size-default"
        aria-label="Default"
        class="flex h-11 w-11 flex-1 items-center justify-center rounded-full transition-colors md:h-7 md:w-7 md:flex-none"
        :class="
          prefs.size === 18
            ? 'bg-white dark:bg-neutral-700 shadow-sm text-neutral-900 dark:text-neutral-100'
            : 'text-neutral-500 dark:text-neutral-400'
        "
        @click="onSizePreset(18)"
      >
        <span class="font-semibold leading-none" style="font-size: 11px">A</span>
      </button>
      <button
        data-testid="size-big"
        aria-label="Big"
        class="flex h-11 w-11 flex-1 items-center justify-center rounded-full transition-colors md:h-7 md:w-7 md:flex-none"
        :class="
          prefs.size === 21
            ? 'bg-white dark:bg-neutral-700 shadow-sm text-neutral-900 dark:text-neutral-100'
            : 'text-neutral-500 dark:text-neutral-400'
        "
        @click="onSizePreset(21)"
      >
        <span class="font-semibold leading-none" style="font-size: 13px">A</span>
      </button>
      <button
        data-testid="size-huge"
        aria-label="Huge"
        class="flex h-11 w-11 flex-1 items-center justify-center rounded-full transition-colors md:h-7 md:w-7 md:flex-none"
        :class="
          prefs.size === 26
            ? 'bg-white dark:bg-neutral-700 shadow-sm text-neutral-900 dark:text-neutral-100'
            : 'text-neutral-500 dark:text-neutral-400'
        "
        @click="onSizePreset(26)"
      >
        <span class="font-semibold leading-none" style="font-size: 15px">A</span>
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
      <span data-testid="size-value" class="hidden" aria-hidden="true">{{
        prefs.size
      }}</span>
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

    <div
      class="mx-0.5 hidden h-5 w-px shrink-0 bg-neutral-200 dark:bg-neutral-700 md:block"
    />

    <div
      class="flex w-full items-center rounded-full bg-neutral-100 p-0.5 dark:bg-neutral-800 md:w-auto"
    >
      <button
        data-testid="family-default"
        class="min-h-[44px] flex-1 rounded-full px-2.5 py-3 text-sm font-medium transition-colors md:min-h-0 md:flex-none md:px-2 md:py-1 md:text-xs"
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
        class="min-h-[44px] flex-1 rounded-full px-2.5 py-3 font-serif text-sm font-medium transition-colors md:min-h-0 md:flex-none md:px-2 md:py-1 md:text-xs"
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
        class="min-h-[44px] flex-1 rounded-full px-2.5 py-3 text-sm font-medium transition-colors md:min-h-0 md:flex-none md:px-2 md:py-1 md:text-xs"
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
</template>

<script setup>
import { useReaderPrefs } from '@/composable/useReaderPrefs';

const emit = defineEmits(['change']);
const { prefs, setTheme, setSize, setFamily } = useReaderPrefs();

function report(next) {
  emit('change', next);
}

function onTheme(t) {
  setTheme(t);
  report({ theme: t });
}

function onSize(delta) {
  const next = Math.min(32, Math.max(12, prefs.value.size + delta));
  setSize(next);
  report({ size: next });
}

function onSizePreset(size) {
  setSize(size);
  report({ size });
}

function onSizeSlider(e) {
  const v = Number(e.target.value);
  setSize(v);
  report({ size: v });
}

function onFamily(f) {
  setFamily(f);
  report({ family: f });
}
</script>
