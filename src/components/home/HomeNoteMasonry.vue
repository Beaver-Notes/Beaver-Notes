<template>
  <div
    ref="containerRef"
    class="note-masonry"
    :class="{ 'filter-pulse': pulse }"
  >
    <div
      class="note-masonry__columns"
      :style="{
        '--note-masonry-gap': `${gapPx}px`,
        gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))`,
      }"
    >
      <div
        v-for="(column, columnIndex) in layout.columns"
        :key="`column-${columnIndex}`"
        class="note-masonry__column"
      >
        <div
          v-for="note in column"
          :key="note.id"
          :ref="setCardRef(note.id)"
          :data-item-id="`note-${note.id}`"
          class="note-masonry__card"
          @click.stop="$emit('item-click', { event: $event, noteId: note.id })"
        >
          <home-note-card
            :note-id="note.id"
            :is-locked="note.isLocked"
            v-bind="{ note }"
            :class="{
              'ring-1 ring-secondary bg-primary/5 transform scale-[1.02] transition-transform duration-200':
                isSelected(note.id),
            }"
            class="w-full"
            draggable="true"
            style="contain: layout style"
            @dragstart="$emit('dragstart', { event: $event, noteId: note.id })"
            @dragend="$emit('dragend', { event: $event, noteId: note.id })"
            @update:label="$emit('update:label', $event)"
            @update="$emit('update', { noteId: note.id, payload: $event })"
          />
        </div>

        <div
          v-if="layout.spacers[columnIndex] > 0"
          aria-hidden="true"
          class="note-masonry__spacer"
          :style="{ height: `${layout.spacers[columnIndex]}px` }"
        ></div>
      </div>
    </div>
  </div>
</template>

<script setup>
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from 'vue';
import HomeNoteCard from './HomeNoteCard.vue';

const props = defineProps({
  notes: {
    type: Array,
    default: () => [],
  },
  selectedItems: {
    type: Object,
    default: null,
  },
  pulse: {
    type: Boolean,
    default: false,
  },
  gapPx: {
    type: Number,
    default: 20,
  },
  breakpoints: {
    type: Array,
    default: () => [
      { min: 0, cols: 1 },
      { min: 640, cols: 2 },
      { min: 768, cols: 2 },
      { min: 1024, cols: 3 },
      { min: 1280, cols: 4 },
    ],
  },
});

defineEmits(['item-click', 'dragstart', 'dragend', 'update:label', 'update']);

const containerRef = ref(null);
const containerWidth = ref(0);
const measuredVersion = ref(0);

const cardElements = new Map();
const cardElementIds = new WeakMap();
const cardHeights = new Map();

let containerResizeObserver = null;
let cardResizeObserver = null;
let measureFrame = null;

function isSelected(noteId) {
  return props.selectedItems?.has?.(`note-${noteId}`) || false;
}

function estimateTextLines(text, charsPerLine, maxLines) {
  const normalized = String(text || '').trim();
  if (!normalized) return 0;
  return Math.min(
    maxLines,
    Math.max(1, Math.ceil(normalized.length / charsPerLine))
  );
}

function estimateNoteHeight(note) {
  const titleLines = estimateTextLines(note.title, 28, 2);
  const labelsLines = note.labels?.length
    ? Math.min(2, Math.ceil(note.labels.join(' ').length / 26))
    : 0;
  const previewWeight = note.isLocked ? 70 : 148;
  const conflictHeight = note.isConflict ? 38 : 0;

  return (
    104 + previewWeight + conflictHeight + titleLines * 22 + labelsLines * 24
  );
}

function getCardHeight(note) {
  measuredVersion.value;
  return cardHeights.get(note.id) || estimateNoteHeight(note);
}

function updateContainerWidth() {
  const width = Math.round(containerRef.value?.clientWidth || 0);
  if (width !== containerWidth.value) {
    containerWidth.value = width;
  }
}

const columnCount = computed(() => {
  const width =
    typeof window !== 'undefined' ? window.innerWidth : containerWidth.value;

  let columns = 1;
  for (const point of props.breakpoints) {
    if (width >= point.min) columns = point.cols;
  }
  return Math.max(1, columns);
});

const layout = computed(() => {
  const columns = Array.from({ length: columnCount.value }, () => []);
  const heights = Array.from({ length: columnCount.value }, () => 0);

  for (const note of props.notes) {
    const height = getCardHeight(note);
    const columnIndex = heights.indexOf(Math.min(...heights));
    columns[columnIndex].push(note);
    heights[columnIndex] +=
      height + (columns[columnIndex].length > 1 ? props.gapPx : 0);
  }

  const tallest = heights.length ? Math.max(...heights) : 0;
  const spacers = heights.map((height, index) => {
    const needsGapBeforeSpacer = columns[index].length > 0 ? props.gapPx : 0;
    return Math.max(0, tallest - height - needsGapBeforeSpacer);
  });

  return { columns, spacers };
});

function updateCardHeight(id, element) {
  const height = Math.round(element.getBoundingClientRect().height);
  if (!height || cardHeights.get(id) === height) return false;

  cardHeights.set(id, height);
  return true;
}

function scheduleMeasure() {
  if (measureFrame !== null) {
    cancelAnimationFrame(measureFrame);
  }

  measureFrame = requestAnimationFrame(() => {
    measureFrame = null;
    let changed = false;

    for (const note of props.notes) {
      const el = cardElements.get(note.id);
      if (!el) continue;

      changed = updateCardHeight(note.id, el) || changed;
    }

    const noteIds = new Set(props.notes.map((note) => note.id));
    for (const id of [...cardHeights.keys()]) {
      if (!noteIds.has(id)) {
        const element = cardElements.get(id);
        if (element && cardResizeObserver) {
          cardResizeObserver.unobserve(element);
        }
        cardHeights.delete(id);
        cardElements.delete(id);
        changed = true;
      }
    }

    if (changed) {
      measuredVersion.value += 1;
    }
  });
}

function setCardRef(id) {
  return (el) => {
    const previous = cardElements.get(id);
    if (previous && previous !== el && cardResizeObserver) {
      cardResizeObserver.unobserve(previous);
    }

    if (el) {
      cardElements.set(id, el);
      cardElementIds.set(el, id);
      if (cardResizeObserver) {
        cardResizeObserver.observe(el);
      }
    } else {
      if (previous && cardResizeObserver) {
        cardResizeObserver.unobserve(previous);
      }
      cardElements.delete(id);
    }
    scheduleMeasure();
  };
}

watch(
  () =>
    props.notes
      .map(
        (note) =>
          `${note.id}:${note.updatedAt}:${note.title}:${
            note.labels?.length || 0
          }:${note.isLocked}:${note.isConflict}`
      )
      .join('|'),
  async () => {
    await nextTick();
    scheduleMeasure();
  },
  { immediate: true }
);

watch(columnCount, async () => {
  await nextTick();
  scheduleMeasure();
});

onMounted(() => {
  updateContainerWidth();

  if (typeof ResizeObserver === 'function' && containerRef.value) {
    containerResizeObserver = new ResizeObserver(() => {
      updateContainerWidth();
      scheduleMeasure();
    });
    containerResizeObserver.observe(containerRef.value);

    cardResizeObserver = new ResizeObserver((entries) => {
      let changed = false;

      for (const entry of entries) {
        const id = cardElementIds.get(entry.target);
        if (id == null) continue;

        changed = updateCardHeight(id, entry.target) || changed;
      }

      if (changed) {
        measuredVersion.value += 1;
      }
    });

    for (const [id, element] of cardElements.entries()) {
      cardElementIds.set(element, id);
      cardResizeObserver.observe(element);
    }
  } else if (typeof window !== 'undefined') {
    window.addEventListener('resize', updateContainerWidth);
  }

  scheduleMeasure();
});

onBeforeUnmount(() => {
  if (containerResizeObserver) {
    containerResizeObserver.disconnect();
    containerResizeObserver = null;
  } else if (typeof window !== 'undefined') {
    window.removeEventListener('resize', updateContainerWidth);
  }

  if (cardResizeObserver) {
    cardResizeObserver.disconnect();
    cardResizeObserver = null;
  }

  if (measureFrame !== null) {
    cancelAnimationFrame(measureFrame);
    measureFrame = null;
  }
});
</script>

<style scoped>
.filter-pulse {
  opacity: 1;
}

.note-masonry__columns {
  display: grid;
  align-items: start;
  gap: var(--note-masonry-gap);
}

.note-masonry__column {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: var(--note-masonry-gap);
}

.note-masonry__card {
  min-width: 0;
}

.note-masonry__spacer {
  width: 100%;
  pointer-events: none;
}

@media (prefers-reduced-motion: no-preference) {
  .filter-pulse {
    animation: noteMasonryFilterPulse 200ms ease forwards;
  }

  @keyframes noteMasonryFilterPulse {
    0% {
      opacity: 1;
    }

    40% {
      opacity: 0.6;
    }

    100% {
      opacity: 1;
    }
  }
}
</style>
