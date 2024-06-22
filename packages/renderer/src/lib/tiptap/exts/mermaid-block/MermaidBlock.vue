<template>
  <NodeViewWrapper>
    <div>
      <VueMermaidRender
        v-if="currentTheme === 'dark'"
        :class="{ 'dark:text-purple-400 text-purple-500': selected }"
        :content="mermaidContent"
        :config="config"
        @click="openTextarea"
      />
      <VueMermaidRender
        v-else
        :class="{ 'dark:text-purple-400 text-purple-500': selected }"
        :content="mermaidContent"
        :config="config"
        @click="openTextarea"
      />
      <div v-if="showTextarea" class="bg-input transition rounded-lg p-2">
        <textarea
          ref="inputRef"
          :value="mermaidContent"
          type="textarea"
          placeholder="Enter Mermaid code here..."
          class="bg-transparent w-full"
          @input="updateContent($event)"
          @keydown.ctrl.enter="closeTextarea"
        ></textarea>
      </div>
    </div>
  </NodeViewWrapper>
</template>

<script>
import { ref, watch, onMounted, computed } from 'vue';
import { VueMermaidRender } from 'vue-mermaid-render';
import { NodeViewWrapper, nodeViewProps } from '@tiptap/vue-3';
import { useTheme } from '@/composable/theme';

export default {
  components: {
    VueMermaidRender,
    NodeViewWrapper,
  },
  props: nodeViewProps,
  setup(props) {
    const mermaidContent = ref('');
    const inputRef = ref(null);
    const showTextarea = ref(false);
    const { currentTheme } = useTheme();
    const config = computed(() => ({
      theme: currentTheme.value === 'dark' ? 'dark' : 'default',
    }));

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

    return {
      updateContent,
      mermaidContent,
      inputRef,
      showTextarea,
      openTextarea,
      closeTextarea,
      config,
      currentTheme,
    };
  },
};
</script>
