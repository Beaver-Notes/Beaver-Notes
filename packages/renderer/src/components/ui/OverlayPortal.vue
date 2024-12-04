<template>
  <div
    class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
    @click.self="$emit('close')"
  >
    <div class="bg-white dark:bg-neutral-800 rounded-lg p-4">
      <slot></slot>
    </div>
  </div>
</template>

<script>
export default {
  name: 'OverlayPortal',
  emits: { close: null },
};
</script>
