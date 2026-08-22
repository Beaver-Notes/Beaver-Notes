<template>
  <div class="flex-1 flex items-center justify-center p-10 antialiased">
    <div class="flex flex-col items-center text-center max-w-sm w-full">
      <!-- Mascot -->
      <div class="relative mb-8 flex items-center justify-center w-full h-56">
        <div class="relative z-10">
          <ui-beaver-character
            class="w-64 drop-shadow-[0_12px_24px_rgba(0,0,0,0.08)]"
            :state="['idle', 'cursorTrack']"
            :auto="false"
          />
        </div>
      </div>

      <!-- Text -->
      <h1
        class="text-2xl font-bold text-neutral-800 dark:text-neutral-100 mb-2 leading-snug"
      >
        {{ translations.emptyState?.heading || 'Ready to capture your ideas?' }}
      </h1>
      <p
        class="text-sm text-neutral-500 dark:text-neutral-400 mb-7 leading-relaxed"
      >
        {{
          translations.emptyState?.subheading ||
          'Start a new note, organize your thoughts, or just jot something down.'
        }}
      </p>

      <!-- Shortcuts -->
      <div class="flex items-center justify-center mt-4 gap-4 flex-wrap">
        <div
          v-for="sc in shortcuts"
          :key="sc.id"
          class="flex items-center gap-1.5 text-xs text-neutral-400 dark:text-neutral-500"
        >
          <span
            v-for="k in sc.keys"
            :key="k"
            class="inline-flex items-center justify-center min-w-[24px] px-1.5 py-0.5 bg-neutral-100 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded text-[11px] font-semibold text-neutral-500 dark:text-neutral-400 shadow-[0_1px_0_theme(colors.neutral.200)] dark:shadow-[0_1px_0_theme(colors.neutral.700)]"
            >{{ k }}</span
          >
          <span>{{ sc.label }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, ref, onMounted } from 'vue';
import { useTranslations } from '@/composable/useTranslations';
import { isMacOSRuntime } from '@/lib/tauri/runtime';

const { translations } = useTranslations();

const isMac = isMacOSRuntime();
const cmdKey = isMac ? '⌘' : 'Ctrl';

const shortcuts = computed(() => [
  {
    id: 1,
    keys: [cmdKey, 'N'],
    label: translations.value.emptyState?.shortcutNewNote || 'New note',
  },
  {
    id: 2,
    keys: [cmdKey, '⇧', 'F'],
    label: translations.value.emptyState?.shortcutNewFolder || 'New folder',
  },
]);
</script>

<style scoped>
.mascot-shadow {
  animation: shadowPulse 5s ease infinite;
}
@keyframes shadowPulse {
  0%,
  100% {
    transform: translateX(-50%) scaleX(1);
    opacity: 1;
  }
  50% {
    transform: translateX(-50%) scaleX(0.6);
    opacity: 0.4;
  }
}
</style>
