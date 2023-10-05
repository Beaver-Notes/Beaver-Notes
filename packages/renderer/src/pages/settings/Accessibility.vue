<template>
  <div class="w-full max-w-xl">
    <p class="mb-2">{{ currentTranslations.selectFont }}</p>
    <ui-select
      id="fontSelect"
      v-model="selectedFont"
      class="w-full"
      @change="updateFont"
    >
      <option value="Arimo">Arimo</option>
      <option value="open-dyslexic">Open Dyslexic</option>
    </ui-select>
  </div>
</template>

<script>
import currentTranslations from './Index.vue'; // Import your translations module

export default {
  data() {
    return {
      selectedFont: localStorage.getItem('selected-font') || 'Arimo',
    };
  },
  computed: {
    currentTranslations() {
      return currentTranslations;
    },
  },
  mounted() {
    document.documentElement.style.setProperty(
      '--selected-font',
      this.selectedFont
    );
  },
  methods: {
    updateFont() {
      localStorage.setItem('selected-font', this.selectedFont);

      document.documentElement.style.setProperty(
        '--selected-font',
        this.selectedFont
      );
    },
  },
};
</script>
