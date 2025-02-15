<!-- eslint-disable vue/multi-word-component-names -->
<template>
  <slot></slot>
</template>
<script>
export default {
  setup(props, { slots }) {
    console.log(props, slots.default());
  },
};
</script>
