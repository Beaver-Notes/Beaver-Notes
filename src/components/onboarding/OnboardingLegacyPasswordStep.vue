<template>
  <div
    class="ob-screen flex flex-col items-center justify-center mobile:justify-end w-full"
  >
    <ui-card class="w-full max-w-lg max-h-[80dvh] flex flex-col">
      <div class="flex flex-col items-center gap-2 my-8 text-center shrink-0">
        <h2
          class="text-3xl font-semibold tracking-tight text-neutral-800 dark:text-neutral-200"
        >
          Enter your old password
        </h2>
        <p class="text-neutral-600 dark:text-neutral-400 max-w-sm">
          Your imported notes are locked. Enter your old Beaver Notes password
          to decrypt and re-encrypt them with the new system.
        </p>
      </div>

      <div class="flex flex-col gap-3 px-4 overflow-y-auto flex-1 min-h-0">
        <ui-input
          v-model="passwordValue"
          type="password"
          placeholder="Old password"
          class="w-full"
          @keyup.enter="submit"
        />
        <p v-if="error" class="text-xs text-red-500 dark:text-red-400">
          {{ error }}
        </p>
      </div>

      <div class="mt-2 flex justify-between gap-4 px-4 pb-4 shrink-0">
        <ui-button variant="secondary" @click="$emit('skip')">
          Skip for now
        </ui-button>
        <ui-button variant="primary" :loading="loading" @click="submit">
          Decrypt notes
        </ui-button>
      </div>

      <div class="mt-5 px-4 pb-4 shrink-0">
        <ui-button @click="$emit('back')">
          <v-remixicon name="riArrowLeftLine" /> Back
        </ui-button>
      </div>
    </ui-card>
  </div>
</template>

<script>
export default {
  props: {
    modelValue: { type: String, default: '' },
    error: { type: String, default: '' },
    loading: { type: Boolean, default: false },
  },
  emits: ['update:modelValue', 'submit', 'skip', 'back'],
  computed: {
    passwordValue: {
      get() {
        return this.modelValue;
      },
      set(val) {
        this.$emit('update:modelValue', val);
      },
    },
  },
  methods: {
    submit() {
      if (this.modelValue) this.$emit('submit');
    },
  },
};
</script>
