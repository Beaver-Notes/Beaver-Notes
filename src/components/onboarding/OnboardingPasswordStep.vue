<template>
  <div
    class="ob-screen flex flex-col items-center justify-center mobile:justify-end w-full"
  >
    <ui-card
      class="w-full max-w-lg mobile:max-w-full max-h-[80dvh] flex flex-col mobile:rounded-b-none mobile:border-b-0"
    >
      <div class="flex flex-col items-center gap-2 my-8 text-center shrink-0">
        <h2
          class="text-3xl font-semibold tracking-tight text-neutral-800 dark:text-neutral-200"
        >
          Protect your notes
        </h2>
        <p class="text-neutral-600 dark:text-neutral-400">
          Set an encryption password to protect your notes and keep them private,
          even in the sync folder. The passphrase is saved in your device secure
          storage, so the app unlocks automatically on launch. Use the same
          password on every device to share encrypted data.
        </p>
      </div>

      <div class="flex flex-col gap-3 overflow-y-auto flex-1 min-h-0 px-1">
        <ui-input
          type="password"
          placeholder="Encryption password"
          :model-value="modelValue"
          @update:model-value="$emit('update:modelValue', $event)"
        />
        <ui-input
          type="password"
          placeholder="Confirm password"
          :model-value="confirmValue"
          @update:model-value="$emit('update:confirmValue', $event)"
        />
        <p
          v-if="error"
          class="text-xs text-red-500 dark:text-red-400 text-center"
        >
          {{ error }}
        </p>
      </div>

      <div
        class="mt-5 flex mobile:flex-col-reverse justify-between gap-4 shrink-0"
      >
        <slot name="back" />
        <slot name="next" />
      </div>
    </ui-card>
  </div>
</template>

<script>
export default {
  props: {
    modelValue: { type: String, default: '' },
    confirmValue: { type: String, default: '' },
    error: { type: String, default: '' },
    loading: { type: Boolean, default: false },
  },
  emits: ['update:modelValue', 'update:confirmValue'],
};
</script>
