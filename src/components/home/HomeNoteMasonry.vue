<template>
  <div
    ref="containerRef"
    class="note-masonry"
    :class="{ 'filter-pulse': pulse }"
  >
    <div
      v-if="containerWidth === 0"
      class="note-masonry__skeleton"
      aria-hidden="true"
    >
      <div
        v-for="i in skeletonCount"
        :key="`skel-${i}`"
        class="note-masonry__skeleton-card animate-pulse"
      />
    </div>

    <div
      v-else
      class="note-masonry__stage"
      :style="{ height: `${stageHeight}px` }"
    >
      <div
        v-for="item in visibleItems"
        :key="item.note.id"
        :ref="setCardRef(item.note.id)"
        :data-item-id="`note-${item.note.id}`"
        class="note-masonry__card"
        :class="{
          leaving: isItemLeaving(item.note.id),
          entering: isItemEntering(item.note.id),
        }"
        :style="{
          transform: `translate3d(${item.x}px,${item.y}px,0)`,
          width: `${item.w}px`,
          '--x': `${item.x}px`,
          '--y': `${item.y}px`,
        }"
        @click.stop="
          $emit('item-click', { event: $event, noteId: item.note.id })
        "
        @touchstart="
          $emit('item-touchstart', { event: $event, noteId: item.note.id })
        "
        @touchmove="
          $emit('item-touchmove', { event: $event, noteId: item.note.id })
        "
        @touchend="
          $emit('item-touchend', { event: $event, noteId: item.note.id })
        "
        @touchcancel="
          $emit('item-touchcancel', { event: $event, noteId: item.note.id })
        "
      >
        <home-note-card
          :note-id="item.note.id"
          :note="item.note"
          :is-locked="item.note.isLocked"
          :disable-open="selectionMode"
          :class="{
            'ring-1 ring-secondary bg-primary/5 transform scale-[1.02] transition-transform duration-200':
              isSelected(item.note.id),
          }"
          class="w-full [contain:layout_style]"
          draggable="true"
          @dragstart="
            $emit('dragstart', { event: $event, noteId: item.note.id })
          "
          @dragend="$emit('dragend', { event: $event, noteId: item.note.id })"
          @update:label="$emit('update:label', $event)"
          @update="$emit('update', { noteId: item.note.id, payload: $event })"
          @move="$emit('move', $event)"
        />
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

const CARD_LEAVE_DURATION_MS = 250;
const CARD_ENTER_DURATION_MS = 300;
const CARD_LEAVE_CLEANUP_MS = CARD_LEAVE_DURATION_MS + 50;
const CARD_ENTER_CLEANUP_MS = CARD_ENTER_DURATION_MS + 50;

const props = defineProps({
  notes: { type: Array, default: () => [] },
  selectedItems: { type: Object, default: null },
  pulse: { type: Boolean, default: false },
  selectionMode: { type: Boolean, default: false },
  gapPx: { type: Number, default: 20 },
  breakpoints: {
    type: Array,
    default: () => [
      { min: 0, cols: 2 },
      { min: 640, cols: 2 },
      { min: 768, cols: 2 },
      { min: 1024, cols: 3 },
      { min: 1280, cols: 4 },
    ],
  },
  overscanPx: { type: Number, default: 800 },
});

defineEmits([
  'item-click',
  'item-touchstart',
  'item-touchmove',
  'item-touchend',
  'item-touchcancel',
  'dragstart',
  'dragend',
  'update:label',
  'update',
  'move',
]);

const containerRef = ref(null);
const containerWidth = ref(0);
const scrollTop = ref(0);
const viewportHeight = ref(
  typeof window !== 'undefined' ? window.innerHeight : 600
);
const containerOffset = ref(0);
const measuredVersion = ref(0);

const cardElements = new Map();
const cardElementIds = new WeakMap();
const cardHeights = new Map();
const cardRefCbs = new Map();
let scrollEl = null,
  containerRO = null,
  cardRO = null,
  scrollRaf = null,
  cardResizeRaf = null;
let pendingCardEntries = [];

const leavingItems = new Map();
const enteringItems = new Map();

const isSelected = (id) => props.selectedItems?.has?.(`note-${id}`) ?? false;
const isItemLeaving = (id) => leavingItems.has(id);
const isItemEntering = (id) => enteringItems.has(id);

function estimateNoteHeight(note) {
  const tLines = Math.min(
    2,
    Math.max(1, Math.ceil(String(note.title ?? '').trim().length / 28))
  );
  const lLines = note.labels?.length
    ? Math.min(2, Math.ceil(note.labels.join(' ').length / 26))
    : 0;
  return (
    104 +
    (note.isLocked ? 70 : 148) +
    (note.isConflict ? 38 : 0) +
    tLines * 22 +
    lLines * 24
  );
}

function getCardHeight(id, note) {
  void measuredVersion.value;
  return cardHeights.get(id) ?? estimateNoteHeight(note);
}

const columnCount = computed(() => {
  const w = containerWidth.value || window?.innerWidth || 0;
  let cols = 2;
  for (const bp of props.breakpoints) if (w >= bp.min) cols = bp.cols;
  return Math.max(1, cols);
});

const resolvedGap = computed(() =>
  containerWidth.value > 0 && containerWidth.value < 640
    ? Math.round(props.gapPx / 2)
    : props.gapPx
);

const columnWidth = computed(() => {
  const cols = columnCount.value;
  const gap = resolvedGap.value;
  const width = containerWidth.value;
  if (!width) return 0;
  return Math.floor((width - gap * (cols - 1)) / cols);
});

const layoutResult = computed(() => {
  void measuredVersion.value;
  const cols = columnCount.value,
    gap = resolvedGap.value,
    width = containerWidth.value;
  if (!width || !props.notes.length) return { items: [], stageHeight: 0 };

  const colW = Math.floor((width - gap * (cols - 1)) / cols);
  const remainder = width - gap * (cols - 1) - colW * cols;
  const colH = Array.from({ length: cols }).fill(0);
  const items = [];

  for (const [index, note] of props.notes.entries()) {
    const col = index % cols;
    const h = getCardHeight(note.id, note);
    const x = col * (colW + gap) + Math.min(col, remainder);
    const y = colH[col];
    items.push({ note, x, y, w: colW, h });
    colH[col] += h + gap;
  }

  return { items, stageHeight: Math.max(0, Math.max(...colH) - gap) };
});

const stageHeight = computed(() => layoutResult.value.stageHeight);

const visibleItems = computed(() => {
  const { items } = layoutResult.value;
  if (!items.length) return [];

  const over =
    containerWidth.value < 480
      ? Math.round(props.overscanPx / 2)
      : props.overscanPx;
  const local = scrollTop.value - containerOffset.value;
  const lo = local - over;
  const hi = local + viewportHeight.value + over;

  const cols = columnCount.value;
  const result = [];
  for (let col = 0; col < cols && col < items.length; col++) {
    const count = Math.ceil((items.length - col) / cols);

    let a = 0;
    let b = count;
    while (a < b) {
      const mid = (a + b) >> 1;
      const it = items[col + mid * cols];
      const h = cardHeights.get(it.note.id) ?? it.h;
      if (it.y + h > lo) b = mid;
      else a = mid + 1;
    }
    const startIdx = a;

    a = 0;
    b = count;
    while (a < b) {
      const mid = (a + b) >> 1;
      const it = items[col + mid * cols];
      if (it.y >= hi) b = mid;
      else a = mid + 1;
    }
    const endIdx = a;

    for (let k = startIdx; k < endIdx; k++) {
      result.push(items[col + k * cols]);
    }
  }
  return result;
});

const skeletonCount = computed(() => columnCount.value * 3);

const onScroll = () => {
  if (scrollRaf) return;
  scrollRaf = requestAnimationFrame(() => {
    scrollRaf = null;
    scrollTop.value =
      scrollEl === window ? window.scrollY : scrollEl?.scrollTop ?? 0;
    updateOffset();
  });
};

function findScrollParent(el) {
  let node = el?.parentElement;
  while (node && node !== document.body) {
    const ov = window.getComputedStyle(node).overflowY;
    if (
      (ov === 'auto' || ov === 'scroll') &&
      node.scrollHeight > node.clientHeight
    )
      return node;
    node = node.parentElement;
  }
  return window;
}

function updateWidth() {
  const w = Math.round(containerRef.value?.clientWidth ?? 0);
  if (w !== containerWidth.value) containerWidth.value = w;
}

function updateViewport() {
  const h =
    scrollEl === window ? window.innerHeight : scrollEl?.clientHeight ?? 0;
  if (h !== viewportHeight.value) viewportHeight.value = h;
}

function updateOffset() {
  if (!containerRef.value || !scrollEl) return;
  const cr = containerRef.value.getBoundingClientRect();
  if (scrollEl === window) {
    containerOffset.value = cr.top + window.scrollY;
  } else {
    const sr = scrollEl.getBoundingClientRect();
    containerOffset.value = cr.top - sr.top + scrollEl.scrollTop;
  }
}

function onWindowResize() {
  updateWidth();
  updateViewport();
  updateOffset();
}

function setCardRef(id) {
  if (!cardRefCbs.has(id)) {
    cardRefCbs.set(id, (el) => {
      const prev = cardElements.get(id);
      if (prev && prev !== el && cardRO) cardRO.unobserve(prev);
      if (el) {
        cardElements.set(id, el);
        cardElementIds.set(el, id);
        if (cardRO) cardRO.observe(el);
      } else {
        if (prev && cardRO) cardRO.unobserve(prev);
        cardElements.delete(id);
        cardRefCbs.delete(id);
      }
    });
  }
  return cardRefCbs.get(id);
}

function onCardObserved(entries) {
  pendingCardEntries.push(...entries);
  if (cardResizeRaf) return;
  cardResizeRaf = requestAnimationFrame(() => {
    cardResizeRaf = null;
    const batch = pendingCardEntries;
    pendingCardEntries = [];
    let changed = false;
    for (const entry of batch) {
      const el = entry.target;
      const id = cardElementIds.get(el);
      if (!id) continue;
      const h = Math.round(
        entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height
      );
      const prev = cardHeights.get(id);
      if (h > 0 && (prev === undefined || Math.abs(prev - h) >= 2)) {
        cardHeights.set(id, h);
        changed = true;
      }
    }
    if (changed) measuredVersion.value++;
  });
}

// On container resize the column count changes, which means cards reflow to a
// new width and their heights change. Clear the cache and re-measure mounted
// cards; the per-card ResizeObserver corrects the rest.
watch(columnCount, () => {
  cardHeights.clear();
  measuredVersion.value++;
  updateOffset();
  requestAnimationFrame(() => {
    let changed = false;
    for (const [id, el] of cardElements) {
      const h = Math.round(el.offsetHeight);
      if (h > 0 && Math.abs(h - (cardHeights.get(id) ?? 0)) >= 2) {
        cardHeights.set(id, h);
        changed = true;
      }
    }
    if (changed) measuredVersion.value++;
  });
});

let _prevNoteIds = new Set();

watch(
  () => props.notes.map((n) => n.id).join(','),
  () => {
    const newIds = new Set(props.notes.map((n) => n.id));

    for (const id of _prevNoteIds) {
      if (!newIds.has(id) && !leavingItems.has(id)) {
        leavingItems.set(id, { timestamp: Date.now() });
        setTimeout(() => leavingItems.delete(id), CARD_LEAVE_CLEANUP_MS);
      }
    }

    for (const id of newIds) {
      if (!_prevNoteIds.has(id) && !enteringItems.has(id)) {
        enteringItems.set(id, { timestamp: Date.now() });
        setTimeout(() => enteringItems.delete(id), CARD_ENTER_CLEANUP_MS);
      }
    }

    _prevNoteIds = newIds;
  },
  { immediate: true }
);

onMounted(async () => {
  scrollEl = findScrollParent(containerRef.value);
  updateWidth();

  await nextTick();
  updateWidth();

  const fixedScrollEl = findScrollParent(containerRef.value);
  if (fixedScrollEl !== scrollEl) {
    scrollEl?.removeEventListener?.('scroll', onScroll);
    scrollEl = fixedScrollEl;
  }
  updateViewport();
  updateOffset();
  scrollTop.value =
    scrollEl === window ? window.scrollY : scrollEl?.scrollTop ?? 0;
  scrollEl.addEventListener('scroll', onScroll, { passive: true });

  if (typeof ResizeObserver === 'function') {
    let resizeRaf = null;
    containerRO = new ResizeObserver(() => {
      if (resizeRaf) return;
      resizeRaf = requestAnimationFrame(() => {
        resizeRaf = null;
        updateWidth();
        updateViewport();
        updateOffset();
      });
    });
    containerRO.observe(containerRef.value);
    if (scrollEl !== window) containerRO.observe(scrollEl);

    cardRO = new ResizeObserver(onCardObserved);
  } else {
    window.addEventListener('resize', onWindowResize, { passive: true });
  }
});

onBeforeUnmount(() => {
  scrollEl?.removeEventListener('scroll', onScroll);
  window.removeEventListener('resize', onWindowResize);
  containerRO?.disconnect();
  cardRO?.disconnect();
  if (scrollRaf) cancelAnimationFrame(scrollRaf);
  if (cardResizeRaf) cancelAnimationFrame(cardResizeRaf);
  cardRefCbs.clear();
  scrollEl = containerRO = cardRO = null;
});
</script>

<style scoped>
.note-masonry {
  position: relative;
  width: 100%;
}

.note-masonry__skeleton {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 20px;
}

@media (min-width: 1024px) {
  .note-masonry__skeleton {
    grid-template-columns: repeat(3, 1fr);
  }
}

@media (min-width: 1280px) {
  .note-masonry__skeleton {
    grid-template-columns: repeat(4, 1fr);
  }
}

.note-masonry__skeleton-card {
  height: 200px;
  background: rgba(0, 0, 0, 0.05);
  border-radius: 8px;
}

.note-masonry__stage {
  position: relative;
  width: 100%;
}

.note-masonry__card {
  position: absolute;
  top: 0;
  left: 0;
  contain: layout style;
  transition: transform 200ms ease;
}

.filter-pulse {
  opacity: 1;
}

.note-masonry__card.leaving {
  animation: cardLeave 250ms ease-out forwards;
  pointer-events: none;
  z-index: 1;
  transition: none;
}

.note-masonry__card.entering {
  animation: cardEnter 300ms ease-out forwards;
  transition: none;
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

  @keyframes cardLeave {
    0% {
      opacity: 1;
      transform: translate3d(var(--x), var(--y), 0) scale(1);
    }

    100% {
      opacity: 0;
      transform: translate3d(var(--x), var(--y), 0) scale(0.95);
    }
  }

  @keyframes cardEnter {
    0% {
      opacity: 0;
      transform: translate3d(var(--x), var(--y), 0) scale(0.96);
    }

    100% {
      opacity: 1;
      transform: translate3d(var(--x), var(--y), 0) scale(1);
    }
  }
}

@media (prefers-reduced-motion: reduce) {
  .note-masonry__card.leaving,
  .note-masonry__card.entering {
    animation: none;
    opacity: 1;
  }
}

/* The masonry windows the DOM itself, so the card's own
   content-visibility:auto (HomeNoteCard.vue) is redundant here and causes
   320px placeholder flashes on scroll. Force it off for cards in the grid. */
.note-masonry :deep(.note-card) {
  content-visibility: visible;
}
</style>
