<!-- eslint-disable vue/multi-word-component-names -->
<template>
  <component
    :is="tag"
    v-bind="$attrs"
    class="bg-neutral-50 dark:bg-neutral-900 transform rounded-xl transition-transform ui-card overflow-hidden border"
    :class="[padding, { 'ui-card-hoverable': hover }]"
  >
    <slot></slot>
  </component>
</template>
<script>
export default {
  props: {
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
@media (hover: hover) and (pointer: fine) {
  .ui-card-hoverable:hover {
    transform: translateY(-0.25rem);
    box-shadow: 0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1);
  }
}
</style>
