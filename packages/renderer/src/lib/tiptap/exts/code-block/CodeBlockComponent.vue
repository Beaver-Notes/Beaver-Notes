<template>
  <node-view-wrapper class="relative">
    <div class="absolute right-0">
      <v-remixicon
        :name="copyIcon"
        class="cursor-pointer w-4"
        @click="copyToClipboard"
      />
      <select
        v-model="selectedLanguage"
        contenteditable="false"
        class="text-sm m-2 rounded bg-opacity-5 bg-black dark:bg-gray-300 dark:bg-opacity-5"
      >
        <option :value="null">auto</option>
        <option disabled>—</option>
        <option
          v-for="(
            language, index
          ) in extension.options.lowlight.listLanguages()"
          :key="index"
          :value="language"
        >
          {{ language }}
        </option>
      </select>
    </div>
    <pre><node-view-content as="code" /></pre>
  </node-view-wrapper>
</template>

<script>
import { computed } from 'vue';
import { NodeViewWrapper, NodeViewContent, nodeViewProps } from '@tiptap/vue-3';
import { useClipboard } from '../../../../composable/clipboard';

export default {
  components: {
    NodeViewWrapper,
    NodeViewContent,
  },
  props: nodeViewProps,
  setup(props) {
    const selectedLanguage = computed({
      set(language) {
        props.updateAttributes({ language });
      },
      get() {
        return props.node.attrs.language;
      },
    });
    const { copyState, copyToClipboard } = useClipboard();
    const copyIcon = computed(() =>
      copyState.value === 1
        ? 'riCheckFill'
        : copyState.value === 2
        ? 'riErrorWarningLine'
        : 'riClipboardLine'
    );

    const copy = () => {
      const code = props.node.content.content[0].text;
      copyToClipboard(code);
    };

    return {
      selectedLanguage,
      copyToClipboard: copy,
      copyState,
      copyIcon,
    };
  },
};
</script>

<style lang="postcss" scoped>
.code-block {
  position: relative;

  select {
    position: absolute;
    top: 0.5rem;
    right: 0.5rem;
  }
}
</style>
