<template>
  <div>
    <!-- Style options button -->
    <div
      class="fixed top-6 right-6 z-10 flex items-center gap-3 bg-neutral-800 rounded-2xl shadow-lg px-3 py-2"
    >
      <ui-popover
        padding="!bg-neutral-800 p-2 flex items-center hover:bg-neutral-700"
      >
        <template #trigger>
          <button class="transition hoverable h-8 px-1 rounded-lg text-white">
            <v-remixicon name="riBrush2Fill" />
          </button>
        </template>
        <div class="draw">
          <div class="drawing-container grid grid-cols-2 gap-2">
            <button
              v-for="type in paperTypes"
              :key="type"
              :class="`w-16 h-16 rounded-lg border transition-all ${type} ${
                state.background === type
                  ? 'ring-2 ring-primary scale-105'
                  : 'hover:border-primary border-neutral-600'
              }`"
              @click="handleBackgroundChange(type)"
            ></button>
          </div>
        </div>
      </ui-popover>

      <!-- Divider -->
      <div class="w-px h-6 bg-neutral-500/50"></div>

      <!-- Close Button -->
      <button
        class="w-8 h-8 rounded-full flex items-center justify-center text-white hover:bg-neutral-700 transition"
        @click="$emit('close')"
      >
        <v-remixicon name="riCloseLine" />
      </button>
    </div>

    <!-- Main toolbar -->
    <div
      class="fixed top-6 left-1/2 -translate-x-1/2 z-10 flex flex-col items-center gap-3"
    >
      <!-- Tool Buttons -->
      <div
        class="bg-neutral-800 rounded-2xl shadow-lg px-2 py-1 flex items-center gap-2"
      >
        <button
          v-for="tool in ['select', 'pen', 'highlighter', 'eraser']"
          :key="tool"
          :class="[
            'w-10 h-10 flex items-center justify-center rounded-md transition',
            state.tool === tool
              ? 'text-secondary bg-neutral-700'
              : 'text-white hover:bg-neutral-700',
          ]"
          @click="handleToolChange(tool)"
        >
          <v-remixicon
            :name="
              {
                select: 'riFocus3Line',
                pen: 'riBallPenLine',
                highlighter: 'riMarkPenLine',
                eraser: 'riEraserLine',
              }[tool]
            "
            class="w-6 h-6"
          />
        </button>

        <!-- Undo / Redo -->
        <button
          :disabled="state.undoStack.length === 0"
          class="w-10 h-10 text-white disabled:opacity-40 hover:bg-neutral-700 rounded-md transition"
          @click="$emit('undo')"
        >
          <v-remixicon name="riArrowGoBackLine" class="w-6 h-6" />
        </button>
        <button
          :disabled="state.redoStack.length === 0"
          class="w-10 h-10 text-white disabled:opacity-40 hover:bg-neutral-700 rounded-md transition"
          @click="$emit('redo')"
        >
          <v-remixicon name="riArrowGoForwardLine" class="w-6 h-6" />
        </button>
      </div>

      <!-- Tool Settings -->
      <div
        v-if="['pen', 'highlighter', 'eraser'].includes(state.tool)"
        class="bg-neutral-800 rounded-2xl shadow-lg px-3 py-2 flex items-center gap-4"
      >
        <!-- Color Picker -->
        <div v-if="state.tool !== 'eraser'" class="relative">
          <input
            v-if="activePicker === state.tool"
            :ref="`${state.tool}ColorInput`"
            type="color"
            :value="state[`${state.tool}Settings`].color"
            class="absolute inset-0 opacity-0 cursor-pointer"
            @input="
              handleColorChange(`${state.tool}Settings`, $event.target.value)
            "
            @blur="activePicker = null"
          />
          <button
            :style="{ backgroundColor: state[`${state.tool}Settings`].color }"
            class="w-8 h-8 rounded-md border border-neutral-600 hover:ring-2 hover:ring-amber-400 transition"
            @click="toggleColorPicker(state.tool)"
          ></button>
        </div>

        <!-- Size Slider -->
        <label class="flex items-center gap-2">
          <input
            type="range"
            :min="state.tool === 'pen' ? 1 : 5"
            :max="state.tool === 'pen' ? 20 : 20"
            :value="state[`${state.tool}Settings`].size"
            class="w-32"
            @input="
              handleSizeChange(`${state.tool}Settings`, +$event.target.value)
            "
          />
        </label>
      </div>
    </div>
  </div>
</template>

<script>
import { ref, nextTick } from 'vue';
import '@/assets/css/paper.scss';

export default {
  name: 'DrawingToolBar',
  props: {
    state: Object,
    tool: String,
    undoStack: Array,
    redoStack: Array,
  },
  emits: [
    'update-state',
    'set-selected-element',
    'close',
    'update-attributes',
    'undo',
    'redo',
  ],
  setup(props, { emit }) {
    const showStyleOpt = ref(false);
    const activePicker = ref(null);
    const penColorInput = ref(null);
    const highlighterColorInput = ref(null);

    const paperTypes = ['grid', 'ruled', 'dotted', 'plain'];

    const handleToolChange = (tool) => {
      emit('update-state', { tool });
      emit('set-selected-element', null);
    };

    const handleBackgroundChange = (type) => {
      emit('update-state', { background: type });
      emit('update-attributes', { paperType: type });
      showStyleOpt.value = false;
    };

    const handleColorChange = (settingsType, color) => {
      const newSettings = {
        ...props.state[settingsType],
        color,
      };
      emit('update-state', { [settingsType]: newSettings });
    };

    const handleSizeChange = (settingsType, size) => {
      const newSettings = {
        ...props.state[settingsType],
        size,
      };
      emit('update-state', { [settingsType]: newSettings });
    };

    const toggleColorPicker = async (type) => {
      if (activePicker.value === type) {
        activePicker.value = null;
      } else {
        activePicker.value = type;
        await nextTick();
        // Focus the color input after it's rendered
        if (type === 'pen' && penColorInput.value) {
          penColorInput.value.focus();
        } else if (type === 'highlighter' && highlighterColorInput.value) {
          highlighterColorInput.value.focus();
        }
      }
    };

    return {
      showStyleOpt,
      activePicker,
      penColorInput,
      highlighterColorInput,
      paperTypes,
      handleToolChange,
      handleBackgroundChange,
      handleColorChange,
      handleSizeChange,
      toggleColorPicker,
    };
  },
};
</script>
