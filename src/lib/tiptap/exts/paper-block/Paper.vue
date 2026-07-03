<template>
  <NodeViewWrapper
    ref="wrapperRef"
    class="paper-node"
    :class="{ 'is-active': selected }"
    :contenteditable="false"
    tabindex="0"
  >
    <div v-if="!overlayOpen" class="paper-preview-wrap" @click="openOverlay">
      <div class="paper-preview relative cursor-pointer">
        <DrawMode ref="drawModeRef" :node="node" :interactive="false" />

        <div
          class="preview-overlay absolute inset-0 flex items-center justify-center"
        >
          <span
            class="px-4 py-2 rounded-lg text-sm font-medium shadow-lg transition-opacity"
            :class="
              hasContent
                ? 'bg-white/90 dark:bg-neutral-800/90 text-neutral-700 dark:text-neutral-300'
                : 'bg-primary/90 text-white'
            "
          >
            {{ hasContent ? 'Click to edit drawing' : 'Tap to draw' }}
          </span>
        </div>
      </div>
    </div>

    <PaperOverlay
      v-if="overlayOpen"
      :initial-attrs="overlayAttrs"
      @close="closeOverlay"
      @update-attributes="handleOverlayUpdate"
    />
  </NodeViewWrapper>
</template>

<script>
import { computed, ref } from 'vue';
import { NodeViewWrapper, nodeViewProps } from '@tiptap/vue-3';
import DrawMode from './DrawMode.vue';
import PaperOverlay from './PaperOverlay.vue';

export default {
  name: 'PaperBlock',
  components: { DrawMode, NodeViewWrapper, PaperOverlay },
  props: nodeViewProps,
  setup(props) {
    const wrapperRef = ref(null);
    const drawModeRef = ref(null);
    const overlayOpen = ref(false);
    const overlayAttrs = ref(null);

    const hasContent = computed(() => {
      const lines = props.node.attrs.linesV2 ?? props.node.attrs.lines ?? [];
      return Array.isArray(lines) && lines.length > 0;
    });

    function openOverlay() {
      const a = props.node.attrs;
      overlayAttrs.value = {
        linesV2: a.linesV2,
        lines: a.lines,
        height: a.height,
        paperType: a.paperType,
      };
      overlayOpen.value = true;
    }

    function closeOverlay() {
      overlayOpen.value = false;
    }

    function handleOverlayUpdate(attrs) {
      props.updateAttributes(attrs);
    }

    return {
      wrapperRef,
      drawModeRef,
      overlayOpen,
      overlayAttrs,
      hasContent,
      openOverlay,
      closeOverlay,
      handleOverlayUpdate,
    };
  },
};
</script>

<style scoped>
.paper-node {
  position: relative;
}

.paper-preview-wrap {
  position: relative;
}

.paper-preview {
  max-height: 300px;
  overflow: hidden;
  border-radius: 8px;
  border: 1px solid transparent;
  transition: border-color 0.2s;
}

.paper-preview:hover {
  border-color: rgba(99, 102, 241, 0.3);
}

.preview-overlay {
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.2s ease;
  background: rgba(0, 0, 0, 0.05);
  border-radius: 8px;
}

.paper-preview:hover .preview-overlay {
  opacity: 1;
  pointer-events: auto;
}

.is-active .paper-preview {
  border-color: rgba(99, 102, 241, 0.5);
}
</style>
