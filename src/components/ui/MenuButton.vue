<template>
  <component :is="tag" ref="btnRef"></component>
</template>
<script setup>
/* eslint-disable no-undef */

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
