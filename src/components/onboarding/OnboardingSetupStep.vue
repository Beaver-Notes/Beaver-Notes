<template>
  <ui-card class="w-full max-w-lg">
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
        <ui-select v-model="fresh.language" :options="languages" block />
      </div>

      <!-- Behaviour -->
      <div class="flex flex-col gap-2">
        <p class="text-xs font-bold uppercase tracking-widest ob-label-text">
          Behaviour
        </p>
        <ui-card>
          <button
            class="flex items-center justify-between w-full px-4 py-3 text-left"
            @click="fresh.spellcheckEnabled = !fresh.spellcheckEnabled"
          >
            <div>
              <span class="block text-sm font-semibold ob-heading-text"
                >Spell check</span
              >
              <span class="block text-xs ob-body-text mt-0.5"
                >Underline mistakes as you type.</span
              >
            </div>
            <ui-switch v-model="fresh.spellcheckEnabled" />
          </button>
          <button
            class="flex items-center justify-between w-full px-4 py-3 text-left border-t border-neutral-100 dark:border-neutral-800"
            @click="fresh.openLastEdited = !fresh.openLastEdited"
          >
            <div>
              <span class="block text-sm font-semibold ob-heading-text"
                >Open last edited note</span
              >
              <span class="block text-xs ob-body-text mt-0.5"
                >Resume where you left off.</span
              >
            </div>
            <ui-switch v-model="fresh.openLastEdited" />
          </button>
          <button
            class="flex items-center justify-between w-full px-4 py-3 text-left border-t border-neutral-100 dark:border-neutral-800"
            @click="fresh.openAfterCreation = !fresh.openAfterCreation"
          >
            <div>
              <span class="block text-sm font-semibold ob-heading-text"
                >Open note after creation</span
              >
              <span class="block text-xs ob-body-text mt-0.5"
                >Jump into a new note instantly.</span
              >
            </div>
            <ui-switch v-model="fresh.openAfterCreation" />
          </button>
        </ui-card>
      </div>

      <!-- Accent color -->
      <div class="flex flex-col gap-2">
        <p class="text-xs font-bold uppercase tracking-widest ob-label-text">
          Accent color
        </p>
        <div class="grid grid-cols-4 gap-2">
          <button
            v-for="item in accentColors"
            :key="item.name"
            type="button"
            class="bg-input flex items-center gap-2 rounded-lg px-3 py-2 text-left transition-all"
            :class="
              fresh.accentColor === item.name ? 'ring-1 ring-primary' : ''
            "
            @click="$emit('select-accent', item.name)"
          >
            <span
              class="h-3 w-3 rounded-full"
              :style="{ backgroundColor: item.preview }"
            ></span>
            <span class="text-sm ob-heading-text">{{ item.label }}</span>
          </button>
        </div>
      </div>

      <!-- Interface size -->
      <div class="flex flex-col gap-2">
        <p class="text-xs font-bold uppercase tracking-widest ob-label-text">
          Interface size
        </p>
        <div class="grid grid-cols-3 gap-2">
          <button
            v-for="item in interfaceSizes"
            :key="item.value"
            type="button"
            class="bg-input rounded-lg px-3 py-2 text-sm transition-all"
            :class="fresh.zoomLevel === item.value ? 'ring-1 ring-primary' : ''"
            @click="$emit('select-zoom', item.value)"
          >
            {{ item.label }}
          </button>
        </div>
      </div>

      <!-- App font -->
      <div class="flex flex-col gap-2">
        <p class="text-xs font-bold uppercase tracking-widest ob-label-text">
          App font
        </p>
        <ui-select v-model="fresh.selectedFont" :options="fonts" block />
      </div>
    </div>

    <!-- Navigation -->
    <div class="mt-5 flex justify-between gap-4">
      <slot name="back" />
      <slot name="next" />
    </div>
  </ui-card>
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

  emits: ['select-theme', 'select-accent', 'select-zoom'],
};
</script>
