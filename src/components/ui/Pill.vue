<template>
  <div
    v-if="show"
    :class="[fixed ? 'fixed z-[70]' : '', fixed ? position : '']"
    role="region"
    :aria-label="ariaLabel"
  >
    <div
      class="flex items-center gap-0.5 rounded-full border border-neutral-200 dark:border-neutral-800 bg-white/95 dark:bg-neutral-900/95 py-1 pl-1.5 pr-1.5 shadow-xl backdrop-blur-sm"
    >
      <slot />
    </div>
  </div>
</template>

<script>
export default {
  name: 'Pill',
  props: {
    show: { type: Boolean, default: true },
    ariaLabel: { type: String, default: '' },
    fixed: { type: Boolean, default: true },
    position: {
      type: String,
      default:
        'bottom-6 left-1/2 -translate-x-1/2 mobile:bottom-[calc(var(--app-keyboard-inset-bottom)+4.25rem)]',
    },
  },
};
</script>
