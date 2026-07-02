<template>
  <Transition name="ghost-fade">
    <div
      v-if="isVisible"
      class="drag-ghost-overlay"
      :style="overlayStyle"
      @pointerdown.prevent
      @pointermove.prevent
    >
      <div
        v-if="items.length === 1"
        class="drag-ghost-single"
        :style="singleStyle"
      >
        <component :is="itemComponent" :data="items[0]" :is-ghost="true" />
      </div>

      <div v-else class="drag-ghost-stack" :style="stackContainerStyle">
        <div
          v-for="(item, index) in visibleItems"
          :key="item.id"
          class="drag-ghost-stack-card"
          :style="getStackCardStyle(index)"
        >
          <component :is="itemComponent" :data="item" :is-ghost="true" />
        </div>
      </div>
    </div>
  </Transition>
</template>

<script setup>
import { computed } from 'vue';
import HomeNoteCard from '@/components/home/HomeNoteCard.vue';
import HomeFolderCard from '@/components/home/HomeFolderCard.vue';

const props = defineProps({
  isVisible: Boolean,
  items: Array,
  kind: String,
  position: { type: Object, default: () => ({ x: 0, y: 0 }) },
  offset: { type: Object, default: () => ({ x: 14, y: 14 }) },
  scale: { type: Number, default: 0.94 },
});

const MAX_VISIBLE = 2;
const PEEK_OFFSET = 10;
const BASE_WIDTH = 320;
const BASE_HEIGHT = 260;

const itemComponent = computed(() =>
  props.kind === 'note' ? HomeNoteCard : HomeFolderCard
);

const visibleItems = computed(() => props.items.slice(0, MAX_VISIBLE));

const extra = computed(() =>
  Math.max(0, Math.min(props.items.length - 1, MAX_VISIBLE - 1) * PEEK_OFFSET)
);

const overlayStyle = computed(() => ({
  position: 'fixed',
  top: '0',
  left: '0',
  pointerEvents: 'none',
  zIndex: 2147483647,
  transform: `translate(${props.position.x + props.offset.x}px, ${
    props.position.y + props.offset.y
  }px) scale(${props.scale})`,
  transition: 'transform 0.05s linear',
  willChange: 'transform',
}));

const singleStyle = computed(() => ({
  transformOrigin: 'top left',
  width: `${BASE_WIDTH}px`,
  aspectRatio: '16/13',
}));

const stackContainerStyle = computed(() => ({
  position: 'relative',
  width: `${BASE_WIDTH + extra.value}px`,
  height: `${BASE_HEIGHT + extra.value}px`,
  transformOrigin: 'top left',
}));

function getStackCardStyle(index) {
  if (index === 0) {
    return {
      position: 'absolute',
      top: '0',
      left: '0',
      transform: 'scale(0.98)',
      transformOrigin: 'center center',
      zIndex: 1000 + MAX_VISIBLE,
      width: '100%',
      height: '100%',
    };
  }
  const rot = index % 2 === 0 ? -1.8 : 1.8;
  const offset = index * PEEK_OFFSET;
  return {
    position: 'absolute',
    top: `${offset}px`,
    left: `${offset}px`,
    transform: `rotate(${rot}deg) scale(0.97)`,
    transformOrigin: 'center center',
    zIndex: 1000 + (MAX_VISIBLE - index),
    width: '100%',
    height: '100%',
  };
}
</script>

<style scoped>
.drag-ghost-overlay {
  contain: layout paint style;
}

.drag-ghost-single {
  filter: drop-shadow(0 8px 24px rgba(0, 0, 0, 0.15));
}

.drag-ghost-stack-card {
  filter: drop-shadow(0 4px 12px rgba(0, 0, 0, 0.1));
}

.drag-ghost-stack-card:first-child {
  filter: drop-shadow(0 8px 24px rgba(0, 0, 0, 0.15));
}

.ghost-fade-enter-active,
.ghost-fade-leave-active {
  transition: opacity 0.1s ease, transform 0.1s ease;
}

.ghost-fade-enter-from,
.ghost-fade-leave-to {
  opacity: 0;
  transform: scale(0.9);
}
</style>
