<template>
  <div
    v-if="show"
    class="max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-full border border-neutral-200 bg-white py-1 px-1.5 shadow-xl backdrop-blur-xl dark:border-neutral-800 dark:bg-neutral-900"
    :class="fixed ? `fixed z-[70] ${position}` : ''"
    :role="ariaLabel ? 'region' : undefined"
    :aria-label="ariaLabel || undefined"
  >
    <div
      class="flex items-center gap-0.5 overflow-x-auto whitespace-nowrap [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden [&>*]:shrink-0"
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
