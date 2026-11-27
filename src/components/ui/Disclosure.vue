<template>
  <div>
    <button
      type="button"
      class="flex w-full cursor-pointer select-none items-center justify-between gap-2 rounded-lg text-left text-xs font-semibold tracking-wide text-neutral-500 transition-colors hover:text-neutral-700 focus-visible:outline-none focus-visible:ring-2 ring-secondary dark:text-neutral-400 dark:hover:text-neutral-200"
      :aria-expanded="modelValue"
      @click="$emit('update:modelValue', !modelValue)"
    >
      <span><slot name="title">{{ title }}</slot></span>
      <v-remixicon
        name="riArrowDownSLine"
        size="18"
        class="shrink-0 transition-transform"
        :class="{ 'rotate-180': modelValue }"
      />
    </button>
    <ui-expand-collapse
      :open="modelValue"
      :max-open="maxOpen"
      :inert="modelValue ? null : true"
    >
      <slot />
    </ui-expand-collapse>
  </div>
</template>

<script>
/**
 * Collapsible section: a text-style toggle header plus an animated body.
 * Usage: <ui-disclosure v-model="open" title="Advanced" max-open="max-h-80">…</ui-disclosure>
 */
export default {
  name: 'Disclosure',
  props: {
    modelValue: { type: Boolean, default: false },
    title: { type: String, default: '' },
    maxOpen: { type: String, default: 'max-h-96' },
  },
  emits: ['update:modelValue'],
};
</script>
