<template>
  <section class="space-y-2">
    <div v-if="title" class="flex items-center justify-between px-1">
      <p class="text-sm font-semibold text-neutral-600 dark:text-neutral-300">
        {{ title }}
      </p>
      <span v-if="badge" class="text-[10px] font-medium text-neutral-400 bg-neutral-100 dark:bg-neutral-900 px-2 py-0.5 rounded-full">
        {{ badge }}
      </span>
    </div>
    <div
      class="settings-group divide-y divide-neutral-200 dark:divide-neutral-800 bg-neutral-50 dark:bg-neutral-900 rounded-xl border"
      :class="danger ? 'border-red-200 dark:border-red-900/70 bg-red-50/80 dark:bg-red-950/30' : ''"
    >
      <slot />
    </div>
  </section>
</template>

<script setup>
defineProps({
  title: {
    type: String,
    default: '',
  },
  badge: {
    type: [String, Number],
    default: '',
  },
  danger: {
    type: Boolean,
    default: false,
  },
});
</script>
