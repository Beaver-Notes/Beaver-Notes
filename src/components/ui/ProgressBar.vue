<template>
  <div
    class="h-1.5 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-700"
    role="progressbar"
    aria-valuemin="0"
    aria-valuemax="100"
    :aria-valuenow="percent"
  >
    <div
      class="h-full rounded-full transition-all duration-300 ease-out"
      :class="tone === 'warning' ? 'bg-amber-500' : 'bg-primary'"
      :style="{ width: percent + '%' }"
    />
  </div>
</template>

<script>
/**
 * Thin determinate progress bar. `value` is 0–100 and is clamped.
 * tone: 'primary' (default) | 'warning'
 */
export default {
  name: 'ProgressBar',
  props: {
    value: { type: Number, default: 0 },
    tone: { type: String, default: 'primary' },
  },
  computed: {
    percent() {
      const n = Number.isFinite(this.value) ? this.value : 0;
      return Math.max(0, Math.min(100, Math.round(n)));
    },
  },
};
</script>
