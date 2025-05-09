<template>
  <NodeViewWrapper>
    <div>
      <div v-if="showTextarea" class="bg-input transition rounded-lg">
        <div class="flex">
          <!-- Line numbers -->
          <div
            class="line-numbers pr-2 select-none text-neutral-500 rounded-tl-lg bg-neutral-100 text-right"
          >
            <div v-for="i in lineCount" :key="i" class="leading-tight">
              {{ i }}
            </div>
          </div>

          <!-- Textarea -->
          <textarea
            ref="inputRef"
            :value="mermaidContent"
            type="textarea"
            :placeholder="translations._idvue.MermaidPlaceholder || '-'"
            class="bg-transparent min-h-24 w-full resize-y leading-tight p-2"
            @input="updateContent($event)"
            @keydown.ctrl.enter="closeTextarea"
            @keydown.exact="handleKeydown"
            @scroll="syncScroll"
          ></textarea>
        </div>
        <div class="border-t-2 p-2 flex justify-between">
          <p style="margin: 0">
            <strong>{{ translations._idvue.exit }}</strong>
          </p>
          <v-remixicon
            class="cursor-pointer"
            name="riCloseLine"
            @click="() => (showTextarea = false)"
          />
        </div>
      </div>
      <MermaidComponent
        :class="{ 'dark:text-purple-400 text-purple-500': selected }"
        :content="mermaidContent"
        @click="openTextarea"
      />
    </div>
  </NodeViewWrapper>
</template>

<script>
import { ref, watch, onMounted, shallowReactive, computed } from 'vue';
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

    // Compute the number of lines in the content
    const lineCount = computed(() => {
      return (mermaidContent.value.match(/\n/g) || []).length + 1;
    });

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
      setTimeout(() => {
        if (inputRef.value) {
          inputRef.value.focus();
        }
      }, 0);
    }

    function closeTextarea() {
      showTextarea.value = false;
    }

    function handleKeydown(event) {
      if (event.key === 'Tab') {
        event.preventDefault();
        insertTabAtCursor();
      }
    }

    // Sync scroll between textarea and line numbers
    function syncScroll(event) {
      const lineNumbers = event.target.previousElementSibling;
      lineNumbers.scrollTop = event.target.scrollTop;
    }

    function insertTabAtCursor() {
      const textarea = inputRef.value;
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;

      // Insert a tab character at the cursor's current position
      const newValue = `${mermaidContent.value.substring(
        0,
        start
      )}\t${mermaidContent.value.substring(end)}`;
      mermaidContent.value = newValue;

      // Update the attributes so that the content reflects the changes
      props.updateAttributes({ content: newValue });

      // Force the textarea to display the updated value
      textarea.value = newValue;

      // Set the cursor position after the inserted tab
      textarea.setSelectionRange(start + 1, start + 1);

      // Focus the textarea to ensure the cursor is visible
      textarea.focus();
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
        MermaidPlaceholder: '_idvue.MermaidPlaceholder',
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
      handleKeydown,
      lineCount,
      syncScroll,
    };
  },
};
</script>

<style scoped>
.line-numbers {
  font-family: monospace;
  min-width: 2em;
  color: #888;
  user-select: none;
  overflow: hidden;
}

textarea {
  font-family: monospace;
  line-height: inherit;
  overflow-y: auto;
}
</style>
