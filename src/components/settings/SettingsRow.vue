<template>
  <div
    class="settings-row flex gap-x-3 gap-y-1 px-4 py-3.5"
    :class="stacked ? 'mobile:flex-col mobile:items-start flex-row items-center' : 'flex-row flex-wrap items-center'"
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
        class="mobile:hidden mt-0.5 text-xs leading-relaxed text-neutral-500 dark:text-neutral-400"
      >
        <slot name="description">{{ description }}</slot>
      </p>
    </div>
    <div class="w-auto shrink-0 flex items-center justify-end gap-2" :class="[controlClass, stacked ? 'mobile:w-full mobile:justify-start' : '']">
      <slot />
    </div>
    <p
      v-if="description || $slots.description"
      class="hidden mobile:block w-full text-xs leading-relaxed text-neutral-500 dark:text-neutral-400"
    >
      <slot name="description">{{ description }}</slot>
    </p>
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
  stacked: {
    type: Boolean,
    default: false,
  },
});
</script>

<style scoped>
.settings-row + .settings-row {
  @apply border-t border-neutral-200 dark:border-neutral-800;
}
</style>
