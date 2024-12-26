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
      class="draw drawing-container cursor-pointer hover:opacity-80 transition-opacity"
      @click="toggleDrawMode"
    >
      <div class="relative drawing-container rounded-xl">
        <svg
          :viewBox="`0 0 500 ${PREVIEW_HEIGHT}`"
          :style="{ height: PREVIEW_HEIGHT + 'px' }"
          :class="`w-full ${background} dark:border-neutral-600`"
        >
          <path
            v-for="line in lines"
            :key="line.id"
            :d="line.path"
            :stroke="adjustColorForMode(line.color)"
            :stroke-width="line.size"
            fill="none"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
        <div
          class="absolute inset-0 flex items-center justify-center bg-black bg-opacity-20"
        >
          <span class="text-white text-lg font-medium">
            {{ translations.paperBlock.clicktoDraw }}
          </span>
        </div>
      </div>
    </div>
  </NodeViewWrapper>
</template>

<script>
import { ref, onMounted } from 'vue';
import { NodeViewWrapper, nodeViewProps } from '@tiptap/vue-3';
import OverlayPortal from '@/components/ui/OverlayPortal.vue';
import DrawMode from './DrawMode.vue';
import { useTranslation } from '@/composable/translations';
import '@/assets/css/paper.scss';

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
    const translations = ref({ paperBlock: {} });
    const isDrawMode = ref(false);
    const lines = ref(props.node.attrs.lines || []);
    const background = ref(props.node.attrs.paperType);

    const toggleDrawMode = () => {
      isDrawMode.value = !isDrawMode.value;
    };

    const closeDrawMode = () => {
      isDrawMode.value = false;
      lines.value = props.node.attrs.lines || [];
      background.value = props.node.attrs.paperType || [];
    };

    const adjustColorForMode = (color) => {
      const isDarkMode = document.documentElement.classList.contains('dark');
      if (isDarkMode) {
        // Dark mode: Black turns to white; other colors unchanged
        return color === '#000000' ? '#FFFFFF' : color;
      } else {
        // Light mode: White turns to black; other colors unchanged
        return color === '#FFFFFF' ? '#000000' : color;
      }
    };

    onMounted(async () => {
      await useTranslation().then((trans) => {
        if (trans) {
          translations.value = trans;
        }
      });
    });

    return {
      isDrawMode,
      lines,
      toggleDrawMode,
      closeDrawMode,
      adjustColorForMode,
      PREVIEW_HEIGHT,
      background,
      translations,
    };
  },
};
</script>
