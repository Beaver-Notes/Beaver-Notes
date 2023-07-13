<template>
  <node-view-wrapper class="relative">
    <select
      v-model="selectedLanguage"
      contenteditable="false"
      class="
        absolute
        text-sm
        right-0
        m-2
        rounded
        bg-opacity-5 bg-black
        dark:bg-gray-300 dark:bg-opacity-5
      "
    >
      <option :value="null">auto</option>
      <option disabled>—</option>
      <option
        v-for="(language, index) in extension.options.lowlight.listLanguages()"
        :key="index"
        :value="language"
      >
        {{ language }}
      </option>
    </select>
    <pre><node-view-content as="code" /></pre>
  </node-view-wrapper>
</template>

<script>
import { computed } from 'vue';
import { NodeViewWrapper, NodeViewContent, nodeViewProps } from '@tiptap/vue-3';

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

    return {
      selectedLanguage,
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
