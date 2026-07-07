<template>
  <div
    class="w-full max-w-lg bg-neutral-50 dark:bg-neutral-900 rounded-xl mobile:rounded-b-none border mobile:border-b-0 max-h-[80dvh] flex flex-col"
  >
    <div
      class="flex flex-col items-center gap-2 my-8 text-center shrink-0 px-6"
    >
      <h2
        class="text-3xl font-semibold tracking-tight text-neutral-800 dark:text-neutral-200"
      >
        Your starting defaults
      </h2>
      <p class="text-neutral-600 dark:text-neutral-400">
        Changed your mind? You can change these from Settings at any time.
      </p>
    </div>

    <div class="flex flex-col gap-4 overflow-y-auto flex-1 min-h-0 px-6 pb-4">
      <!-- Appearance -->
      <div class="flex flex-col gap-2">
        <p class="text-sm font-medium text-neutral-800 dark:text-neutral-200">
          Appearance
        </p>
        <div
          class="grid grid-cols-3 gap-3 w-full text-neutral-600 dark:text-neutral-300"
        >
          <button
            v-for="item in themes"
            :key="item.name"
            type="button"
            class="bg-input p-2 transition-all w-full rounded-lg"
            :class="fresh.theme === item.name ? 'ring-1 ring-primary' : ''"
            @click="$emit('select-theme', item.name)"
          >
            <img
              :src="item.img"
              :alt="item.label"
              class="w-full border-2 mb-1 rounded-lg"
            />
            <p
              class="capitalize text-center text-sm text-neutral-800 dark:text-neutral-200"
            >
              {{ themeLabels[item.name] || item.label }}
            </p>
          </button>
        </div>
      </div>

      <!-- Accent color -->
      <div class="flex flex-row items-center justify-center gap-4">
        <p
          class="text-sm font-medium text-neutral-800 dark:text-neutral-200 w-full justify-center"
        >
          Accent color
        </p>
        <div class="w-full justify-center flex gap-2 right-0">
          <button
            class="bg-red-500 p-2 w-8 h-8 rounded-full focus:ring-primary transition"
            :class="{
              'ring-2 ring-primary border': fresh.accentColor === 'red',
            }"
            @click="$emit('select-accent', 'red')"
          ></button>
          <button
            class="bg-amber-400 p-2 w-8 h-8 rounded-full focus:ring-primary transition"
            :class="{
              'ring-2 ring-primary border': fresh.accentColor === 'light',
            }"
            @click="$emit('select-accent', 'light')"
          ></button>
          <button
            class="bg-emerald-500 p-2 w-8 h-8 rounded-full focus:ring-primary transition"
            :class="{
              'ring-2 ring-primary border': fresh.accentColor === 'green',
            }"
            @click="$emit('select-accent', 'green')"
          ></button>
          <button
            class="bg-blue-400 p-2 w-8 h-8 rounded-full focus:ring-primary transition"
            :class="{
              'ring-2 ring-primary border': fresh.accentColor === 'blue',
            }"
            @click="$emit('select-accent', 'blue')"
          ></button>
          <button
            class="bg-purple-400 p-2 w-8 h-8 rounded-full focus:ring-primary transition"
            :class="{
              'ring-2 ring-primary border': fresh.accentColor === 'purple',
            }"
            @click="$emit('select-accent', 'purple')"
          ></button>
          <button
            class="bg-pink-400 p-2 w-8 h-8 rounded-full focus:ring-primary transition"
            :class="{
              'ring-2 ring-primary border': fresh.accentColor === 'pink',
            }"
            @click="$emit('select-accent', 'pink')"
          ></button>
          <button
            class="bg-neutral-400 p-2 w-8 h-8 rounded-full focus:ring-primary transition"
            :class="{
              'ring-2 ring-primary border': fresh.accentColor === 'neutral',
            }"
            @click="$emit('select-accent', 'neutral')"
          ></button>
        </div>
      </div>

      <!-- Language -->
      <div class="flex flex-col gap-2">
        <p class="text-sm font-medium text-neutral-800 dark:text-neutral-200">
          Language
        </p>
        <ui-select
          :options="languages"
          block
          :model-value="fresh.language"
          @update:model-value="handleLanguageChange"
        />
      </div>

      <!-- App font -->
      <div class="flex flex-col gap-2">
        <p class="text-sm font-medium text-neutral-800 dark:text-neutral-200">
          App font
        </p>
        <ui-select
          :model-value="fresh.selectedFont"
          class="w-full ob-font-select"
          :search="true"
          @update:model-value="handleFontChange"
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
      <div class="space-y-1 bg-neutral-50 dark:bg-neutral-900">
        <div class="flex flex-row gap-3 items-center justify-between">
          <div class="min-w-0 flex-1">
            <p
              class="text-sm font-medium text-neutral-800 dark:text-neutral-200"
            >
              Enable sounds
            </p>
            <p
              class="mt-0.5 text-xs leading-relaxed text-neutral-500 dark:text-neutral-400"
            >
              Enable sounds for interactions around the app.
            </p>
          </div>
          <ui-switch
            :model-value="soundsEnabled"
            @update:model-value="handleSoundsChange"
          />
        </div>
        <div
          v-if="isMobileRuntime"
          class="flex flex-row gap-3 items-center justify-between"
        >
          <div class="min-w-0 flex-1">
            <p
              class="text-sm font-medium text-neutral-800 dark:text-neutral-200"
            >
              Spotlight indexing
            </p>
            <p
              class="mt-0.5 text-xs leading-relaxed text-neutral-500 dark:text-neutral-400"
            >
              Let iOS / macOS Spotlight index your notes so they can be found
              via system search.
            </p>
          </div>
          <ui-switch
            :model-value="spotlightEnabled"
            @update:model-value="handleSpotlightChange"
          />
        </div>
      </div>
    </div>

    <!-- Navigation -->
    <div
      class="mt-5 flex mobile:flex-col mobile:items-stretch mobile:w-full justify-between gap-3 shrink-0 px-6 pb-6 mobile:pb-4"
    >
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
    fonts: { type: Array, required: true },
    languages: { type: Array, required: true },
    soundsEnabled: { type: Boolean, required: true },
    spotlightEnabled: { type: Boolean, required: false },
    isMobileRuntime: { type: Boolean, required: false },
  },

  emits: [
    'select-theme',
    'select-accent',
    'select-zoom',
    'update-font',
    'update-language',
    'update-sounds',
    'update-spotlight',
  ],

  methods: {
    handleFontChange(event) {
      this.$emit('update-font', event);
    },
    handleLanguageChange(event) {
      this.$emit('update-language', event);
    },
    handleSoundsChange(event) {
      this.$emit('update-sounds', event);
    },
    handleSpotlightChange(event) {
      this.$emit('update-spotlight', event);
    },
  },
};
</script>
