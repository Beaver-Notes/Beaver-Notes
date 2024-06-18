<template>
  <NodeViewWrapper>
    <div class="flex items-center">
      <v-remixicon
        class="cursor-pointer h-10"
        :name="isOpen ? 'riArrowDropDownFill' : 'riArrowRightSFill'"
        @click="toggleCollapse"
      />
      <NodeViewContent :as="`h${attrs.level}`" />
    </div>
  </NodeViewWrapper>
</template>
<script setup>
import { NodeViewWrapper, NodeViewContent, nodeViewProps } from '@tiptap/vue-3';
import { computed, toRaw } from 'vue';

const props = defineProps(nodeViewProps);
const attrs = computed(() => props.node.attrs);
const isOpen = computed(() => attrs.value.open);
function findPos(node) {
  const allNodePos = props.editor.$nodes(node.type.name);
  // don't use eq, beacause it will be matched wrong node.
  return allNodePos.find((p) => p.node === node);
}
function collapseHeading() {
  const editor = props.editor;
  const node = toRaw(props.node);
  const level = attrs.value.level;
  const nodes = editor.view.state.doc.content.content;
  // due to some unknow reason, `===` will be unmatched at the first time.
  let start = nodes.findIndex((n) => node.eq(n));
  if (start < 0) {
    return;
  }
  const startPos = findPos(nodes[start]);
  const rs = startPos.to;
  let end = nodes.length;
  const lastNode = nodes[nodes.length - 1];
  const lastPos = findPos(lastNode);
  let re = lastPos.from + lastNode.content.size;
  for (let i = start + 1, len = nodes.length; i < len; i++) {
    const n = nodes[i];
    if (n.type.name === 'heading' && n.attrs.level <= level) {
      end = i;
      const t = findPos(n);
      re = t.from - 1;
      break;
    }
  }
  const collapsedContent = JSON.stringify(nodes.slice(start + 1, end));
  collapsedContent !== '[]' &&
    editor.commands.deleteRange({ from: rs, to: re });
  return collapsedContent;
}
function unCollapsedHeading() {
  const collapsedContent = attrs.value.collapsedContent;
  if (collapsedContent == null || collapsedContent === '') {
    return;
  }
  const editor = props.editor;
  const node = toRaw(props.node);
  const nodes = editor.view.state.doc.content.content;
  let start = nodes.findIndex((n) => node.eq(n));
  if (start < 0) {
    return;
  }
  const nodePos = findPos(nodes[start]);
  try {
    const cNodes = JSON.parse(collapsedContent);
    if (cNodes.length === 0) {
      return;
    }
    if (nodePos.node.content.size === 0) {
      editor.commands.insertContentAt(nodePos.range, cNodes);
    } else {
      editor.commands.insertContentAt(
        nodePos.from + nodePos.node.content.size,
        cNodes
      );
    }
  } catch (e) {
    console.error(e);
  }
  return '';
}
function toggleCollapse() {
  const content = attrs.value.open ? collapseHeading() : unCollapsedHeading();
  props.updateAttributes({
    level: attrs.value.level,
    open: !isOpen.value,
    collapsedContent: content,
  });
}
</script>
