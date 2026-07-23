<template>
  <component :is="tag" ref="btnRef"></component>
</template>
<script setup>

import { ref } from 'vue';

defineProps({
  tag: {
    type: String,
    default: 'button',
  },
});

const btnRef = ref(null);

defineExpose({
  btnRef,
});
</script>
