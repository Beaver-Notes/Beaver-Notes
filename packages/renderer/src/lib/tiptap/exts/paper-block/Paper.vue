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
          @update-attributes="handleUpdateAttributes"
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
            {{ translations.paperBlock.clickToDraw }}
          </span>
        </div>
      </div>
    </div>
  </NodeViewWrapper>
</template>

<script>
import { ref, computed, watch, onMounted } from 'vue';
import { useTranslation } from '../../../../composable/translations';
import { getStroke } from 'perfect-freehand';
import { NodeViewWrapper, nodeViewProps } from '@tiptap/vue-3';
import {
  getStrokeOptions,
  getSvgPathFromStroke,
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
    const background = ref(props.node.attrs.paperType || 'plain');
    const tool = ref('pen');
    const height = ref(props.node.attrs.height || 400);
    const isDrawMode = ref(false);
    const translations = ref({
      paperBlock: {},
    });

    onMounted(async () => {
      await useTranslation().then((trans) => {
        if (trans) {
          translations.value = trans;
        }
      });
    });

    // Watch for external changes to node attributes
    watch(
      () => props.node.attrs,
      (newAttrs) => {
        console.log('Node attrs changed:', newAttrs);
        lines.value = convertLegacyLines(newAttrs.lines || []);
        background.value = newAttrs.paperType || 'plain';
        height.value = newAttrs.height || 400;
      },
      { deep: true }
    );

    const renderedPaths = computed(() => {
      return lines.value.map((line) => {
        if (!line.points || line.points.length === 0) {
          return { d: '', fill: 'transparent', opacity: 1 };
        }

        try {
          const stroke = getStroke(line.points, getStrokeOptions(line));
          const pathData = getSvgPathFromStroke(stroke);

          return {
            d: pathData,
            fill: line.color || '#000000',
            opacity: line.tool === 'highlighter' ? 0.4 : 1,
          };
        } catch (error) {
          console.error('Error rendering path:', error, line);
          return { d: '', fill: 'transparent', opacity: 1 };
        }
      });
    });

    const toggleDrawMode = () => {
      isDrawMode.value = !isDrawMode.value;
    };

    const closeDrawMode = () => {
      isDrawMode.value = false;
      // Refresh from current node attributes
      lines.value = convertLegacyLines(props.node.attrs.lines || []);
      background.value = props.node.attrs.paperType || 'plain';
      height.value = props.node.attrs.height || 400;
    };

    const handleUpdateAttributes = (updates) => {
      console.log('Received update-attributes:', updates);

      try {
        // Validate the updates before applying
        const validatedUpdates = {};

        if (updates.lines !== undefined) {
          validatedUpdates.lines = Array.isArray(updates.lines)
            ? updates.lines
            : [];
        }

        if (updates.linesV2 !== undefined) {
          validatedUpdates.linesV2 = Array.isArray(updates.linesV2)
            ? updates.linesV2
            : [];
        }

        if (updates.height !== undefined) {
          validatedUpdates.height = Math.max(
            100,
            Number(updates.height) || 400
          );
        }

        if (updates.paperType !== undefined) {
          validatedUpdates.paperType = updates.paperType;
        }

        console.log('Calling updateAttributes with:', validatedUpdates);

        // Call the Tiptap updateAttributes method
        props.updateAttributes(validatedUpdates);

        // Update local state to reflect changes immediately
        if (validatedUpdates.lines || validatedUpdates.linesV2) {
          const linesToUse =
            validatedUpdates.linesV2 ||
            convertLegacyLines(validatedUpdates.lines || []);
          lines.value = linesToUse;
        }

        if (validatedUpdates.height !== undefined) {
          height.value = validatedUpdates.height;
        }

        if (validatedUpdates.paperType !== undefined) {
          background.value = validatedUpdates.paperType;
        }
      } catch (error) {
        console.error('Error updating attributes:', error);
      }
    };

    const handleDrawModeClose = () => {
      console.log('Draw mode closing');
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
      handleUpdateAttributes,
      setLines,
      setTool,
    };
  },
};
</script>
