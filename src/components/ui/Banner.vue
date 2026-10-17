<template>
  <ui-pill :fixed="false" class="pointer-events-auto max-w-[calc(100vw-2rem)]">
    <div class="flex items-center gap-1.5 py-1 pl-1.5 pr-1">
      <v-remixicon :name="icon" class="text-lg text-primary shrink-0" />

      <p class="flex-grow min-w-0 text-sm text-gray-800 dark:text-gray-100">
        {{ content }}
      </p>

      <button
        class="shrink-0 rounded-full px-3 py-1.5 text-sm font-medium bg-neutral-900 text-white dark:bg-white dark:text-neutral-900 hover:opacity-90 transition-opacity"
        :aria-label="primaryText"
        @click="onPrimaryClick"
      >
        {{ primaryText }}
      </button>

      <button
        class="shrink-0 rounded-full px-2.5 py-1.5 text-sm font-medium text-neutral-500 dark:text-neutral-400 hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
        :aria-label="secondaryText"
        @click="onSecondaryClick"
      >
        {{ secondaryText }}
      </button>
    </div>
  </ui-pill>
</template>

<script>
export default {
  name: 'Banner',
  props: {
    icon: { type: String, default: 'riDownloadLine' },
    content: { type: String, required: true },
    primaryText: { type: String, default: 'Primary' },
    secondaryText: { type: String, default: 'Secondary' },
  },
  emits: ['button-1', 'button-2'],
  methods: {
    onPrimaryClick() {
      this.$emit('button-1');
    },
    onSecondaryClick() {
      this.$emit('button-2');
    },
  },
};
</script>
