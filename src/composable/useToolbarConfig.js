/**
 * useToolbarConfig.js
 *
 * Owns all toolbar config logic: ordering, visibility, persistence.
 * Reads/writes through appStore.toolbarStorage so storage stays consistent
 * with the rest of the app — but all toolbar-specific code stays here,
 * not in the store.
 *
 * Writes are debounced: during a drag the in-memory state updates
 * immediately (reactive, zero latency) but localStorage only flushes
 * once the user stops moving for 400ms. Toggle and reset write instantly
 * since they fire at most once per user action.
 */

import { ref, computed } from 'vue';
import { useAppStore } from '@/store/app';
import { toolbarRegistry } from '@/utils/ui/toolbarRegistry.js';

// ─── Shared singleton ─────────────────────────────────────────────────────────
// One instance is created and reused across NoteMenu + ToolbarCustomizer
// so they always see the same reactive state.

let _instance = null;

export function useToolbarConfig() {
  if (_instance) return _instance;

  const appStore = useAppStore();

  // ── Bootstrap: merge saved config with live registry ────────────────────────
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

  // Bumped whenever the registry mutates so reactive computeds below re-derive.
  const registryVersion = ref(0);
  toolbarRegistry.subscribe(() => {
    registryVersion.value++;
    rebuildConfigPreservingUserChoices();
  });

  function rebuildConfigPreservingUserChoices() {
    const current = config.value;
    const fresh = mergeWithRegistry(appStore.toolbarStorage.get());

    const next = [];
    const seen = new Set();
    for (const old of current) {
      const freshItem = fresh.find((f) => f.id === old.id);
      if (freshItem) {
        next.push({ id: old.id, visible: old.visible });
        seen.add(old.id);
      }
    }
    for (const item of fresh) {
      if (!seen.has(item.id)) next.push(item);
    }
    config.value = next;
  }

  // ── Debounced persist ────────────────────────────────────────────────────────
  // Only the minimal { id, visible } shape is persisted — no metadata.
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

  // ── Public API ───────────────────────────────────────────────────────────────

  /** All items in user order, with registry metadata attached. Used by customizer. */
  const allItems = computed(() => {
    registryVersion.value;
    return config.value.map((c) => ({ ...c, meta: toolbarRegistry.get(c.id) }));
  });

  /** Visible items only, with metadata. Used by NoteMenu to render toolbar. */
  const visibleItems = computed(() => allItems.value.filter((c) => c.visible));

  const visibleCount = computed(
    () => allItems.value.filter((c) => c.visible && !c.meta?.isDivider).length
  );

  const totalCount = computed(() => {
    registryVersion.value;
    return toolbarRegistry.all().filter((i) => !i.isDivider).length;
  });

  function toggleItem(id) {
    const item = config.value.find((c) => c.id === id);
    if (item) {
      item.visible = !item.visible;
      persist(true); // immediate — single deliberate action
    }
  }

  function reorder(fromIndex, toIndex) {
    if (fromIndex === toIndex) return;
    const arr = [...config.value];
    const [moved] = arr.splice(fromIndex, 1);
    arr.splice(toIndex, 0, moved);
    config.value = arr;
    persist(); // debounced — may fire many times during a drag
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
