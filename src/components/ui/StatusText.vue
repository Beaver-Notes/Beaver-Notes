<template>
  <p
    class="flex items-start gap-2"
    :class="[sizeClass, toneClass]"
  >
    <v-remixicon
      v-if="icon"
      :name="icon"
      :size="size === 'xs' ? 16 : 18"
      class="mt-px shrink-0"
    />
    <span class="min-w-0 break-words">
      <slot>{{ text }}</slot>
    </span>
  </p>
</template>

<script>
/**
 * Inline status message (success / error / warning / neutral).
 * Attributes such as role="status" or role="alert" fall through to the <p>.
 */
const TONES = {
  success: 'text-green-700 dark:text-green-300',
  error: 'text-red-600 dark:text-red-400',
  warning: 'text-amber-700 dark:text-amber-300',
  neutral: 'text-neutral-500 dark:text-neutral-400',
};

export default {
  name: 'StatusText',
  props: {
    text: { type: String, default: '' },
    tone: { type: String, default: 'neutral' },
    size: { type: String, default: 'sm' },
    icon: { type: String, default: '' },
  },
  computed: {
    toneClass() {
      return TONES[this.tone] || TONES.neutral;
    },
    sizeClass() {
      return this.size === 'xs' ? 'text-xs leading-relaxed' : 'text-sm font-medium';
    },
  },
};
</script>
