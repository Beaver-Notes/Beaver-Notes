<template>
  <div
    class="w-full max-w-lg bg-neutral-50 dark:bg-neutral-800 rounded-xl border p-6"
    :style="{ overflow: 'visible' }"
  >
    <div class="flex flex-col items-center gap-2 my-8 text-center">
      <h2 class="text-3xl font-semibold tracking-tight ob-heading-text">
        Your starting defaults
      </h2>
      <p class="ob-body-text">
        These can be changed from Settings at any time.
      </p>
    </div>

    <div class="flex flex-col gap-4">
      <!-- Appearance -->
      <div class="flex flex-col gap-2">
        <p class="text-xs font-bold uppercase tracking-widest ob-label-text">
          Appearance
        </p>
        <div
          class="grid grid-cols-3 gap-3 w-full text-neutral-600 dark:text-neutral-300"
        >
          <button
            v-for="item in themes"
            :key="item.name"
            type="button"
            class="bg-input p-2 rounded-lg transition-all w-full"
            :class="fresh.theme === item.name ? 'ring-1 ring-primary' : ''"
            @click="$emit('select-theme', item.name)"
          >
            <img
              :src="item.img"
              :alt="item.label"
              class="w-full border-2 mb-1 rounded-lg"
            />
            <p class="capitalize text-center text-sm ob-heading-text">
              {{ themeLabels[item.name] || item.label }}
            </p>
          </button>
        </div>
      </div>

      <!-- Language -->
      <div class="flex flex-col gap-2">
        <p class="text-xs font-bold uppercase tracking-widest ob-label-text">
          Language
        </p>
        <ui-select
          :options="languages"
          block
          :model-value="fresh.language"
          @update:model-value="handleLanguageChange"
        />
      </div>

      <!-- Accent color -->
      <div class="flex flex-col gap-2">
        <p class="text-xs font-bold uppercase tracking-widest ob-label-text">
          Accent color
        </p>
        <div class="w-full items-center justify-center flex gap-4">
          <button
            class="bg-red-500 p-2 w-10 h-10 rounded-full focus:ring-primary transition"
            :class="{ 'ring-1 ring-primary': fresh.accentColor === 'red' }"
            @click="$emit('select-accent', 'red')"
          ></button>
          <button
            class="bg-amber-400 p-2 w-10 h-10 rounded-full focus:ring-primary transition"
            :class="{ 'ring-1 ring-primary': fresh.accentColor === 'light' }"
            @click="$emit('select-accent', 'light')"
          ></button>
          <button
            class="bg-emerald-500 p-2 w-10 h-10 rounded-full focus:ring-primary transition"
            :class="{ 'ring-1 ring-primary': fresh.accentColor === 'green' }"
            @click="$emit('select-accent', 'green')"
          ></button>
          <button
            class="bg-blue-400 p-2 w-10 h-10 rounded-full focus:ring-primary transition"
            :class="{ 'ring-1 ring-primary': fresh.accentColor === 'blue' }"
            @click="$emit('select-accent', 'blue')"
          ></button>
          <button
            class="bg-purple-400 p-2 w-10 h-10 rounded-full focus:ring-primary transition"
            :class="{ 'ring-1 ring-primary': fresh.accentColor === 'purple' }"
            @click="$emit('select-accent', 'purple')"
          ></button>
          <button
            class="bg-pink-400 p-2 w-10 h-10 rounded-full focus:ring-primary transition"
            :class="{ 'ring-1 ring-primary': fresh.accentColor === 'pink' }"
            @click="$emit('select-accent', 'pink')"
          ></button>
          <button
            class="bg-neutral-400 p-2 w-10 h-10 rounded-full focus:ring-primary transition"
            :class="{ 'ring-1 ring-primary': fresh.accentColor === 'neutral' }"
            @click="$emit('select-accent', 'neutral')"
          ></button>
        </div>
      </div>

      <!-- App font -->
      <div class="flex flex-col gap-2">
        <p class="text-xs font-bold uppercase tracking-widest ob-label-text">
          App font
        </p>
        <ui-select
          :model-value="fresh.selectedFont"
          @update:model-value="handleFontChange"
          class="w-full ob-font-select"
          :search="true"
        >
          <option
            v-for="font in fonts"
            :key="font.value"
            :value="font.value"
            :class="font.class"
          >
            {{ font.label }}
          </option>
        </ui-select>
      </div>
    </div>

    <!-- Navigation -->
    <div class="mt-5 flex justify-between gap-4">
      <slot name="back" />
      <slot name="next" />
    </div>
  </div>
</template>

<script>
export default {
  name: 'OnboardingSetupStep',

  props: {
    fresh: { type: Object, required: true },
    themes: { type: Array, required: true },
    themeLabels: { type: Object, required: true },
    accentColors: { type: Array, required: true },
    interfaceSizes: { type: Array, required: true },
    fonts: { type: Array, required: true },
    languages: { type: Array, required: true },
  },

  emits: [
    'select-theme',
    'select-accent',
    'select-zoom',
    'update-font',
    'update-language',
  ],

  methods: {
    handleFontChange(event) {
      this.$emit('update-font', event);
    },
    handleLanguageChange(event) {
      this.$emit('update-language', event);
    },
  },
};
</script>
