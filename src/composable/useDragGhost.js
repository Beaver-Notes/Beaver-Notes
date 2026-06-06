import { ref, shallowRef, onUnmounted } from 'vue';

const isVisible = ref(false);
const items = ref([]);
const kind = ref('note');
const position = ref({ x: 0, y: 0 });
const offset = ref({ x: 14, y: 14 });
const scale = ref(0.94);
const componentRef = shallowRef(null);

let animationFrame = null;

function showDragGhost(payload) {
  const { items: dragItems, kind: dragKind, clientX, clientY } = payload;
  
  items.value = dragItems;
  kind.value = dragKind;
  position.value = { x: clientX, y: clientY };
  isVisible.value = true;
  
  if (animationFrame) {
    cancelAnimationFrame(animationFrame);
  }
  
  animationFrame = requestAnimationFrame(() => {
    if (componentRef.value) {
      componentRef.value.$forceUpdate();
    }
  });
}

function updateDragGhost(clientX, clientY) {
  position.value = { x: clientX, y: clientY };
}

function hideDragGhost() {
  isVisible.value = false;
  items.value = [];
  
  if (animationFrame) {
    cancelAnimationFrame(animationFrame);
    animationFrame = null;
  }
}

function setComponentRef(ref) {
  componentRef.value = ref;
}

function setOffset(newOffset) {
  offset.value = newOffset;
}

function setScale(newScale) {
  scale.value = newScale;
}

onUnmounted(() => {
  if (animationFrame) {
    cancelAnimationFrame(animationFrame);
  }
});

export function useDragGhost() {
  return {
    isVisible,
    items,
    kind,
    position,
    offset,
    scale,
    componentRef,
    showDragGhost,
    updateDragGhost,
    hideDragGhost,
    setComponentRef,
    setOffset,
    setScale,
  };
}