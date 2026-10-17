import { ref } from 'vue';
import { defineStore } from 'pinia';

const DURATION = 5000;
const MAX_TOASTS = 3;

export const useToastStore = defineStore('uiToast', () => {
  const toasts = ref([]);
  let nextId = 1;

  const timers = new Map();

  function schedule(id) {
    const previous = timers.get(id);
    if (previous) clearTimeout(previous);
    timers.set(
      id,
      setTimeout(() => dismiss(id), DURATION),
    );
  }

  function dismiss(id) {
    const timer = timers.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.delete(id);
    }
    const index = toasts.value.findIndex((toast) => toast.id === id);
    if (index !== -1) toasts.value.splice(index, 1);
  }

  function push({ title, kind = 'info', undo = null }) {
    while (toasts.value.length >= MAX_TOASTS) {
      dismiss(toasts.value[0].id);
    }

    const id = nextId++;
    const toast = { id, title, kind, undo: undo || null };
    toasts.value.push(toast);
    schedule(id);
    return id;
  }

  return { toasts, push, dismiss };
});
