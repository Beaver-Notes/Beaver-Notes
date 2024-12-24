<template>
  <NodeViewWrapper class="draw select-none relative">
    <OverlayPortal v-if="isDrawMode">
      <DrawMode
        :update-attributes="updateAttributes"
        :node="node"
        @close="closeDrawMode"
      />
    </OverlayPortal>
    <div
      v-else
      class="cursor-pointer hover:opacity-80 transition-opacity"
      @click="toggleDrawMode"
    >
      <div class="relative drawing-container">
        <svg
          :viewBox="`0 0 500 ${PREVIEW_HEIGHT}`"
          :style="{ height: PREVIEW_HEIGHT + 'px' }"
          class="w-full border border-gray-300 dark:border-neutral-600"
        >
          <path
            v-for="line in lines"
            :key="line.id"
            :d="line.path"
            :stroke="line.color"
            :stroke-width="line.size"
            fill="none"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
        <div
          class="rounded absolute inset-0 flex items-center justify-center bg-black bg-opacity-20"
        >
          <span class="text-white text-lg font-medium"> Click to Draw </span>
        </div>
      </div>
    </div>
  </NodeViewWrapper>
</template>

<script>
import { ref } from 'vue';
import { NodeViewWrapper, nodeViewProps } from '@tiptap/vue-3';
import OverlayPortal from '@/components/ui/OverlayPortal.vue';
import DrawMode from './DrawMode.vue';

const PREVIEW_HEIGHT = 500;

export default {
  name: 'DrawingPaper',
  components: {
    NodeViewWrapper,
    OverlayPortal,
    DrawMode,
  },
  props: nodeViewProps,
  setup(props) {
    const isDrawMode = ref(false);
    const lines = ref(props.node.attrs.lines || []);

    const toggleDrawMode = () => {
      console.log('Toggling Draw Mode');
      isDrawMode.value = !isDrawMode.value;
    };

    const closeDrawMode = () => {
      console.log('Closing Draw Mode');
      isDrawMode.value = false;
    };

    return {
      isDrawMode,
      lines,
      toggleDrawMode,
      closeDrawMode,
      PREVIEW_HEIGHT,
    };
  },
};
</script>
