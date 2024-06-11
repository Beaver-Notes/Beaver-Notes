<template>
  <node-view-wrapper class="collapsible-section">
    <button @click="toggleOpen">{{ node.attrs.open ? '▼' : '▶' }}</button>
    <div class="collapsible-header">
      <node-view-content
        v-model="title"
        @input="updateTitle"
        class="collapsible-title"
      ></node-view-content>
    </div>
    <div v-show="node.attrs.open" class="collapsible-content">
      <node-view-content></node-view-content>
    </div>
  </node-view-wrapper>
</template>

<script>
import { NodeViewWrapper, NodeViewContent, nodeViewProps } from '@tiptap/vue-3';
import { ref } from 'vue';

export default {
  name: 'CollapsibleSection',
  components: {
    NodeViewWrapper,
    NodeViewContent,
  },
  props: nodeViewProps,
  setup(props) {
    const title = ref(props.node.attrs.title);

    function toggleOpen() {
      props.updateAttributes({ open: !props.node.attrs.open });
    }

    function updateTitle(event) {
      props.updateAttributes({ title: event.target.value });
    }

    return {
      toggleOpen,
      updateTitle,
      title,
    };
  },
};
</script>

<style scoped>
.collapsible-section {
  border: 1px solid #ccc;
  margin: 10px 0;
}

.collapsible-header {
  background: #f0f0f0;
  padding: 10px;
  display: flex;
  align-items: center;
}

.collapsible-title {
  margin-left: 10px;
  flex-grow: 1;
  border: none;
  background: none;
  font-size: 1em;
}

.collapsible-content {
  padding: 10px;
}
</style>
