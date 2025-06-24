<template>
  <NodeViewWrapper
    class="draw"
    :class="{ 'is-active': selected }"
    :contenteditable="false"
    style="touch-action: none"
    tabindex="0"
  >
    <div
      v-if="isDrawMode"
      class="bg-neutral-100 dark:bg-neutral-800 absolute inset-0 z-50"
    >
      <OverlayPortal>
        <DrawMode
          :node="node"
          @update-attributes="updateAttributes"
          @close="handleDrawModeClose"
        />
      </OverlayPortal>
    </div>
    <div
      v-else
      class="cursor-pointer hover:opacity-80 transition-opacity"
      @click="toggleDrawMode"
    >
      <div class="relative drawing-container">
        <svg :viewBox="`0 0 500 ${height}`" :class="`w-full ${background}`">
          <path
            v-for="(path, index) in renderedPaths"
            :key="`line-${index}`"
            :d="path.d"
            :fill="path.fill"
            stroke="none"
            stroke-width="0"
            :opacity="path.opacity"
          />
        </svg>
        <div
          class="absolute inset-0 flex items-end justify-center bg-black bg-opacity-15 rounded-xl print:hidden"
        >
          <span
            class="text-neutral-800 dark:text-[color:var(--selected-dark-text)] mb-6 text-lg font-medium"
          >
            {{ translations.paperBlock.clicktoDraw }}
          </span>
        </div>
      </div>
    </div>
  </NodeViewWrapper>
</template>

<script>
import { ref, computed } from 'vue';
import { getStroke } from 'perfect-freehand';
import { NodeViewWrapper, nodeViewProps } from '@tiptap/vue-3';
import {
  getStrokeOptions,
  getSvgPathFromStroke,
  convertToLegacyFormat,
  convertLegacyLines,
} from './helpers/drawHelper';
import DrawMode from './DrawMode.vue';
import '@/assets/css/paper.scss';
import OverlayPortal from '../../../../components/ui/OverlayPortal.vue';

export default {
  name: 'CustomNodeView',
  components: {
    DrawMode,
    OverlayPortal,
    NodeViewWrapper,
  },
  props: nodeViewProps,
  setup(props) {
    const lines = ref(convertLegacyLines(props.node.attrs.lines || []));
    const background = ref(props.node.attrs.paperType);
    const tool = ref('pen');
    const height = ref(props.node.attrs.height);
    const isDrawMode = ref(false);
    const translations = ref({
      paperBlock: {
        clicktoDraw: 'Click to Draw',
      },
    });

    const renderedPaths = computed(() => {
      return lines.value.map((line) => {
        const stroke = getStroke(line.points, getStrokeOptions(line));
        const pathData = getSvgPathFromStroke(stroke);

        return {
          d: pathData,
          fill: line.color,
          opacity: line.tool === 'highlighter' ? 0.4 : 1,
        };
      });
    });

    const toggleDrawMode = () => {
      isDrawMode.value = !isDrawMode.value;
    };

    const closeDrawMode = () => {
      isDrawMode.value = false;
      lines.value = convertLegacyLines(props.node.attrs.lines || []);
      background.value = props.node.attrs.paperType || [];
    };

    const handleDrawModeClose = () => {
      props.updateAttributes({
        lines: convertToLegacyFormat(lines.value),
      });
      closeDrawMode();
    };

    const setLines = (newLines) => {
      lines.value = newLines;
    };

    const setTool = (newTool) => {
      tool.value = newTool;
    };

    return {
      lines,
      background,
      tool,
      height,
      isDrawMode,
      translations,
      renderedPaths,
      toggleDrawMode,
      closeDrawMode,
      handleDrawModeClose,
      setLines,
      setTool,
    };
  },
};
</script>
