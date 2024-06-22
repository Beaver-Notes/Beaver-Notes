<template>
  <NodeViewWrapper>
    <div>
      <MermaidComponent
        :class="{ 'dark:text-purple-400 text-purple-500': selected }"
        :content="mermaidContent"
        @click="openTextarea"
      />
      <div v-if="showTextarea" class="bg-input transition rounded-lg p-2">
        <textarea
          ref="inputRef"
          :value="mermaidContent"
          type="textarea"
          placeholder="Enter Mermaid code here..."
          class="bg-transparent min-h-24 w-full"
          @input="updateContent($event)"
          @keydown.ctrl.enter="closeTextarea"
        ></textarea>
        <div class="border-t-2 p-2">
          <p style="margin: 0">
            <strong>{{ translations._idvue.exit }}</strong>
          </p>
        </div>
      </div>
    </div>
  </NodeViewWrapper>
</template>

<script>
import { ref, watch, onMounted, shallowReactive } from 'vue';
import { NodeViewWrapper, nodeViewProps } from '@tiptap/vue-3';
import MermaidComponent from '../../../../utils/mermaid-renderer.vue'; // Adjust the import path accordingly

export default {
  components: {
    MermaidComponent,
    NodeViewWrapper,
  },
  props: nodeViewProps,
  setup(props) {
    const mermaidContent = ref('');
    const inputRef = ref(null);
    const showTextarea = ref(false);

    function renderContent() {
      mermaidContent.value = props.node.attrs.content || '';
    }

    function updateContent(event) {
      const { value } = event.target;
      props.updateAttributes({ content: value });
      mermaidContent.value = value;
    }

    function openTextarea() {
      showTextarea.value = true;
      if (inputRef.value) {
        inputRef.value.focus();
      }
    }

    function closeTextarea() {
      showTextarea.value = false;
    }

    onMounted(() => {
      renderContent();
    });

    // Watch for changes in node.attrs.content to keep mermaidContent updated
    watch(
      () => props.node.attrs.content,
      (newContent) => {
        mermaidContent.value = newContent;
      }
    );

    const translations = shallowReactive({
      sidebar: {
        exit: '_idvue.exit',
      },
    });

    onMounted(async () => {
      // Load translations
      const loadedTranslations = await loadTranslations();
      if (loadedTranslations) {
        Object.assign(translations, loadedTranslations);
      }
    });

    const loadTranslations = async () => {
      const selectedLanguage = localStorage.getItem('selectedLanguage') || 'en';
      try {
        const translationModule = await import(
          `../../../../pages/settings/locales/${selectedLanguage}.json`
        );
        return translationModule.default;
      } catch (error) {
        console.error('Error loading translations:', error);
        return null;
      }
    };

    return {
      updateContent,
      mermaidContent,
      inputRef,
      showTextarea,
      translations,
      openTextarea,
      closeTextarea,
    };
  },
};
</script>
