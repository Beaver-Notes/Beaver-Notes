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
  background-color: hsl(var(--twc-primary) / 0.2);
  color: inherit;
  border-radius: 0.2em;
  padding: 0 0.05em;
}
</style>
