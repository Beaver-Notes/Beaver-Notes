// useToolbarConfig.js
import { ref, computed } from 'vue';
import { useAppStore } from '@/store/app';
import { toolbarRegistry } from '@/utils/ui/toolbarRegistry.js';

let _instance = null;

export function useToolbarConfig() {
  if (_instance) return _instance;

  const appStore = useAppStore();

  //  Bootstrap
  function buildDefault() {
    return toolbarRegistry.all().map(({ id, defaultVisible }) => ({
      id,
      visible: defaultVisible !== false,
    }));
  }

  function mergeWithRegistry(saved) {
    if (!saved) return buildDefault();
    const all = toolbarRegistry.all();
    const savedOrder = saved.map((s) => s.id);
    return [
      ...savedOrder
        .filter((id) => toolbarRegistry.has(id))
        .map((id) => ({ id, visible: saved.find((s) => s.id === id).visible })),
      ...all
        .filter(({ id }) => !savedOrder.includes(id))
        .map(({ id }) => ({ id, visible: true })),
    ];
  }

  const config = ref(mergeWithRegistry(appStore.toolbarStorage.get()));

  //  Debounced persist
  let _flushTimer = null;

  function persist(immediate = false) {
    clearTimeout(_flushTimer);
    const write = () => appStore.toolbarStorage.set(config.value);
    if (immediate) {
      write();
    } else {
      _flushTimer = setTimeout(write, 400);
    }
  }

  //  Public API

  const allItems = computed(() =>
    config.value.map((c) => ({ ...c, meta: toolbarRegistry.get(c.id) }))
  );

  const visibleItems = computed(() => allItems.value.filter((c) => c.visible));

  const visibleCount = computed(
    () => allItems.value.filter((c) => c.visible && !c.meta?.isDivider).length
  );

  const totalCount = computed(
    () => toolbarRegistry.all().filter((i) => !i.isDivider).length
  );

  function toggleItem(id) {
    const item = config.value.find((c) => c.id === id);
    if (item) {
      item.visible = !item.visible;
      persist(true);
    }
  }

  function reorder(fromIndex, toIndex) {
    if (fromIndex === toIndex) return;
    const arr = [...config.value];
    const [moved] = arr.splice(fromIndex, 1);
    arr.splice(toIndex, 0, moved);
    config.value = arr;
    persist();
  }

  function reset() {
    config.value = buildDefault();
    persist(true);
  }

  _instance = {
    config,
    allItems,
    visibleItems,
    visibleCount,
    totalCount,
    toggleItem,
    reorder,
    reset,
  };
  return _instance;
}
