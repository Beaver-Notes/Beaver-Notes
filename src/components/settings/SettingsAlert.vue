<template>
  <div
    role="status"
    class="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border px-4 py-3.5"
    :class="tones[tone]"
  >
    <v-remixicon
      v-if="icon"
      :name="icon"
      size="20"
      class="shrink-0"
      :class="iconTones[tone]"
    />
    <p class="min-w-0 flex-1 basis-64 text-sm leading-relaxed">
      {{ content }}
    </p>
    <div class="flex shrink-0 items-center gap-2">
      <ui-button @click="$emit('button-1')">{{ primaryText }}</ui-button>
      <ui-button variant="secondary" @click="$emit('button-2')">
        {{ secondaryText }}
      </ui-button>
    </div>
  </div>
</template>

<script setup>
defineProps({
  icon: { type: String, default: '' },
  content: { type: String, required: true },
  primaryText: { type: String, default: 'Primary' },
  secondaryText: { type: String, default: 'Secondary' },
  tone: { type: String, default: 'primary' },
});
defineEmits(['button-1', 'button-2']);

// Flat maps so an unknown tone degrades to no class instead of throwing.
const tones = {
  primary: 'border-primary/30 bg-primary/5',
  warning:
    'border-amber-200 bg-amber-50 dark:border-amber-900/70 dark:bg-amber-950/30',
};
const iconTones = {
  primary: 'text-primary',
  warning: 'text-amber-600 dark:text-amber-400',
};
</script>
