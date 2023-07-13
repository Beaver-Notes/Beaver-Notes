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
