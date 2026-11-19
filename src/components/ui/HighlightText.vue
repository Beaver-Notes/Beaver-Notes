<script setup>
import { computed } from 'vue';
import { highlightSegments } from '@/utils/highlight.js';

const props = defineProps({
  text: { type: String, default: '' },
  query: { type: String, default: '' },
});

const segments = computed(() => highlightSegments(props.text, props.query));
</script>

<template>
  <template v-for="(segment, index) in segments" :key="index">
    <mark v-if="segment.match" class="search-highlight">{{ segment.text }}</mark>
    <template v-else>{{ segment.text }}</template>
  </template>
</template>

<style>
mark.search-highlight {
  background-color: rgb(254 240 138 / 0.9);
  color: inherit;
  border-radius: 0.2em;
  padding: 0 0.05em;
}

.dark mark.search-highlight {
  background-color: rgb(202 138 4 / 0.5);
}
</style>
