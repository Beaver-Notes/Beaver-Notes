<!-- eslint-disable vue/multi-word-component-names -->
<template>
  <label class="relative inline-flex items-center">
    <input
      :id="id"
      :checked="modelValue"
      type="checkbox"
      class="peer sr-only"
      @change="handleChange"
    />
    <div
      class="peer h-6 w-11 rounded-full border bg-neutral-200 dark:bg-[#353333] transition-colors after:absolute after:left-[2px] rtl:after:right-[22px] after:top-0.5 after:h-5 after:w-5 after:rounded-full after:border after:border-neutral-300 after:bg-white after:transition-transform after:content-[''] peer-checked:bg-primary peer-checked:after:translate-x-full rtl:peer-checked:after:border-white peer-focus:ring-1 peer-focus:ring-secondary"
    ></div>
  </label>
</template>

<script setup>
defineProps({
  modelValue: {
    type: Boolean,
    required: true,
  },
  id: {
    type: String,
    default: 'switch',
  },
});

const emits = defineEmits(['update:modelValue', 'change']);

function handleChange(event) {
  emits('update:modelValue', event.target.checked);
  emits('change', event.target.checked);
}
</script>
