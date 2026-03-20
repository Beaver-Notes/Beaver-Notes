<!-- eslint-disable vue/multi-word-component-names -->
<template>
  <component
    :is="tag"
    v-bind="$attrs"
    class="bg-neutral-50 dark:bg-neutral-800 transform rounded-xl transition-transform ui-card overflow-hidden border"
    :class="[padding, { 'hover:shadow-xl hover:-translate-y-1': hover }]"
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
