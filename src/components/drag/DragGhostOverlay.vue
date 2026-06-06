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
        <component
          :is="itemComponent"
          :data="items[0]"
          :is-ghost="true"
        />
      </div>
      
      <div
        v-else
        class="drag-ghost-stack"
        :style="stackContainerStyle"
      >
        <div
          v-for="(item, index) in items"
          :key="item.id"
          class="drag-ghost-stack-card"
          :style="getStackCardStyle(index)"
        >
          <component
            :is="itemComponent"
            :data="item"
            :is-ghost="true"
          />
        </div>
        
        <div
          class="drag-ghost-badge"
          :style="badgeStyle"
        >
          {{ items.length }}
        </div>
      </div>
    </div>
  </Transition>
</template>

<script setup>
import { computed, shallowRef } from 'vue';
import HomeNoteCard from '@/components/home/HomeNoteCard.vue';
import HomeFolderCard from '@/components/home/HomeFolderCard.vue';

const props = defineProps({
  isVisible: Boolean,
  items: Array,
  kind: String, // 'note' | 'folder'
  position: { type: Object, default: () => ({ x: 0, y: 0 }) },
  offset: { type: Object, default: () => ({ x: 14, y: 14 }) },
  scale: { type: Number, default: 0.94 },
});

const itemComponent = computed(() => 
  props.kind === 'note' ? HomeNoteCard : HomeFolderCard
);

const STACK_ROT_STEP = 0.9;
const STACK_ROT_MAX = 4;
const STACK_SCALE_MIN = 0.9;
const STACK_OFFSET = 8;

const overlayStyle = computed(() => ({
  position: 'fixed',
  top: '0',
  left: '0',
  pointerEvents: 'none',
  zIndex: 2147483647,
  transform: `translate(${props.position.x + props.offset.x}px, ${props.position.y + props.offset.y}px) scale(${props.scale})`,
  transition: 'transform 0.05s linear',
  willChange: 'transform',
}));

const singleStyle = computed(() => ({
  transformOrigin: 'top left',
  width: '320px',
  aspectRatio: '16/13',
}));

const stackContainerStyle = computed(() => ({
  position: 'relative',
  width: '320px',
  aspectRatio: '16/13',
  transformOrigin: 'top left',
}));

function getStackCardStyle(index) {
  const count = props.items.length;
  const reverseIndex = count - 1 - index;
  
  let rot = 0;
  let scale = 1;
  
  if (reverseIndex > 0) {
    rot = Math.min(reverseIndex * STACK_ROT_STEP, STACK_ROT_MAX) * (reverseIndex % 2 === 0 ? 1 : -1);
    scale = Math.max(1 - reverseIndex * 0.015, STACK_SCALE_MIN);
  }
  
  const offsetX = reverseIndex * STACK_OFFSET;
  const offsetY = reverseIndex * STACK_OFFSET;
  
  return {
    position: 'absolute',
    top: `${offsetY}px`,
    left: `${offsetX}px`,
    transform: `rotate(${rot}deg) scale(${scale})`,
    transformOrigin: 'center center',
    zIndex: 1000 + index,
    width: '100%',
    height: '100%',
  };
}

const badgeStyle = computed(() => ({
  position: 'absolute',
  top: '8px',
  right: '8px',
  backgroundColor: '#3b82f6',
  color: 'white',
  borderRadius: '50%',
  width: '24px',
  height: '24px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: '12px',
  fontWeight: 'bold',
  border: '2px solid white',
  boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
  zIndex: 10000,
}));
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