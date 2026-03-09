<template>
  <div
    class="flex items-center space-x-4 bg-[#F8F8F7] dark:bg-[#353333] rounded-lg py-3 px-4 max-w-md mx-auto shadow-md mb-4"
  >
    <v-remixicon name="riDownloadLine" class="text-lg text-primary" />

    <p class="flex-grow text-gray-800 dark:text-gray-100">
      {{ content }}
    </p>

    <button
      class="p-1 text-sm text-primary hover:text-opacity-80 transition-colors"
      @click="onPrimaryClick"
    >
      {{ primaryText }}
    </button>

    <button
      class="p-1 text-sm text-primary hover:text-opacity-80 transition-colors"
      @click="onSecondaryClick"
    >
      {{ secondaryText }}
    </button>
  </div>
</template>

<script>
export default {
  // eslint-disable-next-line vue/multi-word-component-names
  name: 'Banner',
  props: {
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
