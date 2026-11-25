<template>
  <div class="flex-1 flex items-center justify-center p-10 antialiased">
    <div class="flex flex-col items-center text-center max-w-sm w-full">
      <!-- mascot stage -->
      <div class="relative mb-6 flex items-end justify-center w-full h-60">
        <div class="relative z-10 w-64">
          <beaver-mascot
            ref="mascot"
            class="w-full"
            :state="mood"
            @start="onMascotStart"
            @end="onMascotEnd"
          />

          <!-- little greeting while he waves -->
          <Transition name="bubble">
            <div
              v-if="greeting"
              class="bubble absolute top-0 left-[78%] px-3 py-1.5 rounded-2xl rounded-bl-sm bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 shadow-sm text-xs font-medium text-neutral-700 dark:text-neutral-200 whitespace-nowrap"
              aria-hidden="true"
            >
              {{ translations.emptyState?.greeting || 'Hi there!' }}
            </div>
          </Transition>
        </div>
      </div>

      <h1
        class="es-rise text-2xl font-bold text-neutral-800 dark:text-neutral-100 mb-2 leading-snug"
        style="--d: 1.1s"
      >
        {{ translations.emptyState?.heading || 'Ready to capture your ideas?' }}
      </h1>
      <p
        class="es-rise text-sm text-neutral-500 dark:text-neutral-400 mb-7 leading-relaxed"
        style="--d: 1.25s"
      >
        {{
          translations.emptyState?.subheading ||
          'Start a new note, organize your thoughts, or just jot something down.'
        }}
      </p>

      <ui-button
        class="es-rise"
        style="--d: 1.4s"
        variant="primary"
        data-testid="empty-state-create-note"
        @mouseenter="onCtaEnter"
        @mouseleave="onCtaLeave"
        @focus="onCtaEnter"
        @blur="onCtaLeave"
        @click="onCreate"
      >
        {{ translations.emptyState?.cta || 'Create your first note' }}
      </ui-button>

      <div
        class="es-rise flex items-center justify-center mt-6 gap-4 flex-wrap"
        style="--d: 1.55s"
      >
        <div
          v-for="sc in shortcuts"
          :key="sc.id"
          class="flex items-center gap-1.5 text-xs text-neutral-500 dark:text-neutral-400"
        >
          <span
            v-for="k in sc.keys"
            :key="k"
            class="inline-flex items-center justify-center min-w-[24px] px-1.5 py-0.5 bg-neutral-100 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded text-xs font-semibold text-neutral-500 dark:text-neutral-400 shadow-[0_1px_0_theme(colors.neutral.200)] dark:shadow-[0_1px_0_theme(colors.neutral.700)]"
            >{{ k }}</span
          >
          <span>{{ sc.label }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onBeforeUnmount } from 'vue';
import emitter from 'tiny-emitter/instance';
import { useTranslations } from '@/composable/useTranslations';
import { isMacOSRuntime } from '@/lib/tauri/runtime';
// adjust the path to wherever you put the component (or register it globally
// like ui-beaver-character and drop this import)
import BeaverMascot from '@/components/ui/BeaverMascot.vue';

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

/* ---- mascot behaviour ---- */
const mascot = ref(null);
const IDLE = ['idle', 'cursorTrack'];
const mood = ref(IDLE);
const greeting = ref(false);
let hideTimer = 0;

function onMascotStart(name) {
  clearTimeout(hideTimer);
  greeting.value = name === 'wave';
}
function onMascotEnd(name) {
  if (name === 'wave') hideTimer = setTimeout(() => (greeting.value = false), 700);
}

// he gets excited when you go for the button (eyes keep following the cursor)
function onCtaEnter() {
  mood.value = ['happy', 'cursorTrack'];
  mascot.value?.play('nod');
}
function onCtaLeave() {
  mood.value = IDLE;
}
function onCreate() {
  mascot.value?.cheer();
  emitter.emit('new-note');
}

onBeforeUnmount(() => clearTimeout(hideTimer));
</script>

<style scoped>
/* text appears after the mascot has popped up */
.es-rise {
  animation: es-rise 0.6s cubic-bezier(0.2, 0.7, 0.3, 1) both;
  animation-delay: var(--d, 0s);
}
@keyframes es-rise {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

.bubble {
  transform-origin: 0 100%;
}
.bubble-enter-active {
  transition: transform 0.35s cubic-bezier(0.3, 1.5, 0.5, 1), opacity 0.2s;
}
.bubble-leave-active {
  transition: transform 0.2s ease, opacity 0.2s;
}
.bubble-enter-from,
.bubble-leave-to {
  opacity: 0;
  transform: scale(0.6) translateY(6px);
}

@media (prefers-reduced-motion: reduce) {
  .es-rise {
    animation: none;
  }
}
</style>
