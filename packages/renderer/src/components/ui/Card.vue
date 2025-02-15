<!-- eslint-disable vue/multi-word-component-names -->
<template>
  <component
    :is="tag"
    v-bind="$attrs"
    class="bg-[#F8F8F7] dark:bg-[#353333] transform rounded-lg transition-transform ui-card overflow-hidden"
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
      default: 'p-4',
    },
    tag: {
      type: String,
      default: 'div',
    },
  },
};
</script>
