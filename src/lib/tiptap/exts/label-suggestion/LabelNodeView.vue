<template>
  <span
    class="mention note-label-chip"
    :style="chipStyle"
  >#{{ label }}</span>
</template>

<script setup>
import { computed } from 'vue';
import { useLabelStore } from '@/store/label';

const props = defineProps({
  node: { type: Object, required: true },
});

const labelStore = useLabelStore();
const label = computed(() => props.node.attrs.label ?? props.node.attrs.id ?? '');
const color = computed(() => labelStore.getColor(label.value) || null);
const chipStyle = computed(() =>
  color.value ? { color: color.value, backgroundColor: color.value + '1a' } : undefined
);
</script>

<style scoped>
.note-label-chip {
  border-radius: 0.375rem;
  padding: 0 0.375rem;
  margin: 0 0.125rem;
  white-space: nowrap;
}
</style>
