<template>
  <div class="flex-1 flex items-center justify-center p-10 antialiased">
    <div class="flex flex-col items-center text-center max-w-sm w-full">
      <!-- Mascot -->
      <div class="relative mb-8 flex items-center justify-center w-full h-56">
        <!-- Floating chips -->
        <div
          v-for="chip in chips"
          :key="chip.id"
          class="chip absolute flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 text-xs font-medium text-neutral-500 dark:text-neutral-400 whitespace-nowrap shadow-sm transition-opacity duration-500"
          :class="[chip.cls, chipsVisible ? 'opacity-100' : 'opacity-0']"
        >
          <span>{{ chip.emoji }}</span
          >{{ chip.text }}
        </div>

        <!-- Mascot -->
        <div class="mascot-float relative z-10">
          <ui-beaver-character
            class="w-44 drop-shadow-[0_12px_24px_rgba(0,0,0,0.08)]"
          />
        </div>

        <!-- Ground shadow -->
        <div
          class="mascot-shadow absolute bottom-1 left-1/2 w-20 h-2.5 rounded-full bg-black/[0.06] dark:bg-white/[0.04]"
        />
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

      <!-- CTA -->
      <ui-button variant="primary" @click="handleCreate">
        <span>{{
          translations.emptyState?.createCta || 'Create Your First Note'
        }}</span>
      </ui-button>

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

const chipsVisible = ref(false);
const { translations } = useTranslations();

const isMac = /Mac|iPhone/i.test(navigator.platform);
const cmdKey = isMac ? '⌘' : 'Ctrl';

const chips = computed(() => [
  {
    id: 1,
    cls: 'chip-1',
    emoji: '✍️',
    text: translations.value.emptyState?.chipWrite || 'Write something',
  },
  {
    id: 2,
    cls: 'chip-2',
    emoji: '💡',
    text: translations.value.emptyState?.chipCapture || 'Capture ideas',
  },
  {
    id: 3,
    cls: 'chip-3',
    emoji: '📋',
    text: translations.value.emptyState?.chipMeeting || 'Meeting notes',
  },
]);

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

onMounted(() => {
  setTimeout(() => (chipsVisible.value = true), 400);
});

const emit = defineEmits(['new-note']);
const handleCreate = () => emit('new-note');
</script>

<style scoped>
/* Mascot float */
.mascot-float {
  animation: mascotFloat 5s ease infinite;
}

/* Ground shadow synced to float */
.mascot-shadow {
  animation: shadowPulse 5s ease infinite;
}

/* Waving arm */
.animate-wave {
  animation: wave 2s ease infinite;
}

/* Chip positions + floats */
.chip-1 {
  top: 12px;
  right: 24px;
  animation: chipFloat1 4s ease infinite;
  transition-delay: 0s;
}
.chip-2 {
  top: 48px;
  left: 12px;
  animation: chipFloat2 4.5s ease infinite;
  transition-delay: 0.25s;
}
.chip-3 {
  bottom: 40px;
  right: 8px;
  animation: chipFloat3 3.8s ease infinite;
  transition-delay: 0.5s;
}

@keyframes mascotFloat {
  0%,
  100% {
    transform: translateY(0);
  }
  50% {
    transform: translateY(-10px);
  }
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
@keyframes wave {
  0%,
  100% {
    transform: rotate(0deg);
  }
  25% {
    transform: rotate(-15deg);
  }
  50% {
    transform: rotate(-5deg);
  }
  75% {
    transform: rotate(-15deg);
  }
}
@keyframes chipFloat1 {
  0%,
  100% {
    transform: translate(0, 0);
  }
  50% {
    transform: translate(-3px, -7px);
  }
}
@keyframes chipFloat2 {
  0%,
  100% {
    transform: translate(0, 0);
  }
  50% {
    transform: translate(4px, -6px);
  }
}
@keyframes chipFloat3 {
  0%,
  100% {
    transform: translate(0, 0);
  }
  50% {
    transform: translate(-4px, -8px);
  }
}
@media (prefers-reduced-motion: reduce) {
  .mascot-float,
  .mascot-shadow,
  .animate-wave,
  .chip-1,
  .chip-2,
  .chip-3 {
    animation: none;
  }
  .mascot-float {
    animation: mascotFloatReduced 5s ease infinite;
  }
}
@keyframes mascotFloatReduced {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.7; }
}
</style>
