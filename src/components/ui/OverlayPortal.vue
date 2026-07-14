<template>
  <div
    ref="trapRef"
    class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
    role="dialog"
    aria-modal="true"
    @click.self="$emit('close')"
  >
    <div class="bg-white dark:bg-neutral-900 overflow-auto h-full w-full">
      <slot></slot>
    </div>
  </div>
</template>

<script>
import { ref, onMounted, onBeforeUnmount } from 'vue';
import { useFocusTrap } from '@/composable/useFocusTrap';

export default {
  name: 'OverlayPortal',
  emits: { close: null },
  setup() {
    const trapRef = ref(null);
    const { activate, deactivate } = useFocusTrap(trapRef);
    return { trapRef, activate, deactivate };
  },
  mounted() {
    document.addEventListener('keydown', this.onKeydown);
    document.body.style.overflow = 'hidden';
    this.$nextTick(() => this.activate());
  },
  beforeUnmount() {
    document.removeEventListener('keydown', this.onKeydown);
    document.body.style.overflow = '';
    this.deactivate();
  },
  methods: {
    onKeydown(event) {
      if (event.key === 'Escape') {
        this.$emit('close');
      }
    },
  },
};
</script>
