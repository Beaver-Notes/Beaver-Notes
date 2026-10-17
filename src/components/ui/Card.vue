<template>
  <component
    :is="tag"
    v-bind="$attrs"
    class="transform transition-[transform,box-shadow,border-color] ui-card overflow-hidden border"
    :class="[bg, radius, padding, { 'ui-card-hoverable': hover }]"
  >
    <slot></slot>
  </component>
</template>
<script>
export default {
  props: {
    bg: {
      type: String,
      default: 'bg-neutral-50 dark:bg-neutral-900',
    },
    radius: {
      type: String,
      default: 'rounded-2xl',
    },
    hover: {
      type: Boolean,
      default: false,
    },
    padding: {
      type: String,
      default: 'p-3',
    },
    tag: {
      type: String,
      default: 'div',
    },
  },
};
</script>

<style scoped>
.ui-card-hoverable {
  transition:
    transform var(--motion-fast) var(--ease-standard),
    box-shadow var(--motion-fast) var(--ease-standard),
    border-color var(--motion-fast) var(--ease-standard);
}
@media (hover: hover) and (pointer: fine) {
  .ui-card-hoverable:hover {
    transform: scale(1.002);
    box-shadow: var(--shadow-md);
    @apply border-neutral-300 dark:border-neutral-700;
  }
}
@media (prefers-reduced-motion: reduce) {
  .ui-card-hoverable {
    transition: none;
  }
  .ui-card-hoverable:hover {
    transform: none;
  }
}
</style>
