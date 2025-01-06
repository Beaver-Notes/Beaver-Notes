<template>
  <div
    class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
    role="dialog"
    aria-modal="true"
    @click.self="$emit('close')"
  >
    <div
      class="bg-white dark:bg-neutral-800 rounded-lg overflow-auto h-full w-full"
    >
      <slot></slot>
    </div>
  </div>
</template>

<script>
export default {
  name: 'OverlayPortal',
  emits: { close: null },
  mounted() {
    document.addEventListener('keydown', this.onKeydown);
  },
  beforeUnmount() {
    document.removeEventListener('keydown', this.onKeydown);
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
