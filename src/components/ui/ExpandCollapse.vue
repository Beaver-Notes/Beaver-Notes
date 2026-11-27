<template>
  <div
    class="overflow-hidden transition-[max-height] ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none"
    :class="open ? `${maxOpen} duration-500` : 'max-h-0 duration-200'"
  >
    <div
      class="transition-[opacity,transform] ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none"
      :class="
        open
          ? 'opacity-100 translate-y-0 duration-300 delay-75'
          : 'opacity-0 -translate-y-1 duration-150'
      "
    >
      <slot />
    </div>
  </div>
</template>

<script setup>
defineProps({
  open: {
    type: Boolean,
    required: true,
  },
  maxOpen: {
    type: String,
    default: 'max-h-96',
  },
});
</script>
