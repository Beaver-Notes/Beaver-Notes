<template>
  <div
    v-if="show"
    class="flex items-center gap-0.5 rounded-full border border-neutral-200 py-1 px-1.5 shadow-xl dark:border-neutral-800 bg-white/[0.97] dark:bg-neutral-900/[0.97]"
    :class="fixed ? `fixed z-[70] ${position}` : ''"
    :role="ariaLabel ? 'region' : undefined"
    :aria-label="ariaLabel || undefined"
  >
    <slot />
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
