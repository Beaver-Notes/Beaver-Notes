<template>
  <div
    class="settings-row flex flex-col sm:flex-row gap-3 px-4 py-3.5 sm:items-center items-start justify-between"
  >
    <div class="min-w-0 flex-1">
      <label
        :for="controlId"
        class="text-sm font-medium text-neutral-800 dark:text-neutral-200"
        :class="{ 'cursor-pointer': controlId }"
      >
        {{ label }}
      </label>
      <p
        v-if="description || $slots.description"
        class="mt-0.5 text-xs leading-relaxed text-neutral-500 dark:text-neutral-400"
      >
        <slot name="description">{{ description }}</slot>
      </p>
    </div>
    <div class="w-full sm:w-auto shrink-0 flex items-center gap-2" :class="controlClass">
      <slot />
    </div>
  </div>
</template>

<script setup>
defineProps({
  label: {
    type: String,
    default: '',
  },
  description: {
    type: String,
    default: '',
  },
  controlId: {
    type: String,
    default: '',
  },
  controlClass: {
    type: String,
    default: '',
  },
});
</script>

<style scoped>
.settings-row + .settings-row {
  @apply border-t border-neutral-200 dark:border-neutral-800;
}
</style>
