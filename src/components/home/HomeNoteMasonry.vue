<template>
  <div
    ref="containerRef"
    class="note-masonry"
    :class="{ 'filter-pulse': pulse }"
  >
    <div class="note-masonry__stage" :style="{ height: `${stageHeight}px` }">
      <div
        v-for="item in visibleItems"
        :key="item.note.id"
        :ref="setCardRef(item.note.id)"
        :data-item-id="`note-${item.note.id}`"
        class="note-masonry__card"
        :style="{
          transform: `translate3d(${item.x}px,${item.y}px,0)`,
          width: `${item.w}px`,
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
          :is-locked="item.note.isLocked"
          v-bind="{ note: item.note }"
          :disable-open="selectionMode"
          :class="{
            'ring-1 ring-secondary bg-primary/5 transform scale-[1.02] transition-transform duration-200':
              isSelected(item.note.id),
          }"
          class="w-full"
          draggable="true"
          style="contain: layout style"
          @dragstart="
            $emit('dragstart', { event: $event, noteId: item.note.id })
          "
          @dragend="$emit('dragend', { event: $event, noteId: item.note.id })"
          @update:label="$emit('update:label', $event)"
          @update="$emit('update', { noteId: item.note.id, payload: $event })"
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
]);

const containerRef = ref(null);
const containerWidth = ref(0);
const scrollTop = ref(0);
const viewportHeight = ref(
  typeof window !== 'undefined' ? window.innerHeight : 600
);
const containerOffset = ref(0);
const measuredVersion = ref(0);
const isMeasured = ref(false);

const cardElements = new Map();
const cardElementIds = new WeakMap();
const cardHeights = new Map();
const cardRefCbs = new Map();
let scrollEl = null,
  containerRO = null,
  cardRO = null,
  measureRaf = null,
  scrollRaf = null;

const isSelected = (id) => props.selectedItems?.has?.(`note-${id}`) ?? false;

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

const layoutResult = computed(() => {
  const cols = columnCount.value,
    gap = resolvedGap.value,
    width = containerWidth.value;
  if (!width || !props.notes.length) return { items: [], stageHeight: 0 };

  const colW = Math.floor((width - gap * (cols - 1)) / cols);
  const colH = new Array(cols).fill(0);
  const items = [];

  for (const note of props.notes) {
    let s = 0;
    for (let c = 1; c < cols; c++) if (colH[c] < colH[s]) s = c;
    const x = s * (colW + gap),
      y = colH[s],
      h = getCardHeight(note.id, note);
    items.push({ note, x, y, w: colW, h });
    colH[s] += h + gap;
  }

  return { items, stageHeight: Math.max(0, Math.max(...colH) - gap) };
});

const stageHeight = computed(() => layoutResult.value.stageHeight);

const visibleItems = computed(() => {
  const { items } = layoutResult.value;
  if (!items.length) return [];

  if (!isMeasured.value) {
    const maxInitial = Math.min(items.length, 30);
    return items.slice(0, maxInitial);
  }

  const over =
    containerWidth.value < 480
      ? Math.round(props.overscanPx / 2)
      : props.overscanPx;
  const local = scrollTop.value - containerOffset.value;
  const lo = local - over;
  const hi = local + viewportHeight.value + over;

  return items.filter((item) => {
    const h = cardHeights.get(item.note.id) ?? item.h;
    return item.y + h > lo && item.y < hi;
  });
});

const onScroll = () => {
  if (scrollRaf) return;
  scrollRaf = requestAnimationFrame(() => {
    scrollRaf = null;
    scrollTop.value =
      scrollEl === window ? window.scrollY : scrollEl?.scrollTop ?? 0;
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
  if (!containerRef.value) return;
  if (scrollEl === window) {
    let top = 0,
      el = containerRef.value;
    while (el) {
      top += el.offsetTop ?? 0;
      el = el.offsetParent;
    }
    containerOffset.value = top;
  } else {
    const cr = containerRef.value.getBoundingClientRect();
    const sr = scrollEl.getBoundingClientRect();
    containerOffset.value = cr.top - sr.top + scrollEl.scrollTop;
  }
}

function updateCardHeight(id, el) {
  const h = Math.round(el.getBoundingClientRect().height);
  if (!h || cardHeights.get(id) === h) return false;
  cardHeights.set(id, h);
  return true;
}

function scheduleMeasure() {
  if (measureRaf) cancelAnimationFrame(measureRaf);
  measureRaf = requestAnimationFrame(() => {
    measureRaf = null;
    let changed = false;
    for (const note of props.notes) {
      const el = cardElements.get(note.id);
      if (el && updateCardHeight(note.id, el)) changed = true;
    }
    const ids = new Set(props.notes.map((n) => n.id));
    for (const id of [...cardHeights.keys()]) {
      if (!ids.has(id)) {
        const el = cardElements.get(id);
        if (el && cardRO) cardRO.unobserve(el);
        cardHeights.delete(id);
        cardElements.delete(id);
        changed = true;
      }
    }
    if (changed) {
      measuredVersion.value++;
      if (!isMeasured.value && props.notes.length > 0) {
        isMeasured.value = true;
      }
    }
  });
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
      scheduleMeasure();
    });
  }
  return cardRefCbs.get(id);
}

watch(
  () =>
    props.notes
      .map(
        (n) =>
          `${n.id}:${n.updatedAt ?? ''}:${n.title ?? ''}:${
            n.labels?.length ?? 0
          }:${n.isLocked}:${n.isConflict}`
      )
      .join('|'),
  async () => {
    await nextTick();
    scheduleMeasure();
  },
  { immediate: true }
);

watch(columnCount, async () => {
  cardHeights.clear();
  measuredVersion.value++;
  await nextTick();
  scheduleMeasure();
});

onMounted(() => {
  scrollEl = findScrollParent(containerRef.value);
  updateWidth();
  updateViewport();
  updateOffset();
  scrollTop.value =
    scrollEl === window ? window.scrollY : scrollEl?.scrollTop ?? 0;
  scrollEl.addEventListener('scroll', onScroll, { passive: true });

  if (typeof ResizeObserver === 'function') {
    containerRO = new ResizeObserver(() => {
      updateWidth();
      updateViewport();
      updateOffset();
      scheduleMeasure();
    });
    containerRO.observe(containerRef.value);
    if (scrollEl !== window) containerRO.observe(scrollEl);

    cardRO = new ResizeObserver((entries) => {
      let changed = false;
      for (const e of entries) {
        const id = cardElementIds.get(e.target);
        if (id != null && updateCardHeight(id, e.target)) changed = true;
      }
      if (changed) {
        measuredVersion.value++;
        if (!isMeasured.value && props.notes.length > 0) {
          isMeasured.value = true;
        }
      }
    });
    for (const [id, el] of cardElements) {
      cardElementIds.set(el, id);
      cardRO.observe(el);
    }
  } else {
    window.addEventListener(
      'resize',
      () => {
        updateWidth();
        updateViewport();
        updateOffset();
      },
      { passive: true }
    );
  }

  scheduleMeasure();
});

onBeforeUnmount(() => {
  scrollEl?.removeEventListener('scroll', onScroll);
  containerRO?.disconnect();
  cardRO?.disconnect();
  if (measureRaf) cancelAnimationFrame(measureRaf);
  if (scrollRaf) cancelAnimationFrame(scrollRaf);
  cardRefCbs.clear();
  scrollEl = containerRO = cardRO = null;
});
</script>

<style scoped>
.note-masonry {
  position: relative;
  width: 100%;
}

.note-masonry__stage {
  position: relative;
  width: 100%;
}

.note-masonry__card {
  position: absolute;
  top: 0;
  left: 0;
  contain: style;
}

.filter-pulse {
  opacity: 1;
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
