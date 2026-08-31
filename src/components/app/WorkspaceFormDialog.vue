<template>
  <ui-modal
    :model-value="show"
    :content-class="'max-w-md'"
    :overlay-class="'z-[70]'"
    :persist="true"
    @close="onClose"
    @update:model-value="onUpdateShow"
  >
    <template #header>
      <div class="flex flex-row items-center gap-4">
        <div
          class="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-primary/10"
        >
          <v-remixicon name="riFolderLine" size="24" class="text-primary" />
        </div>
        <h3 class="font-semibold text-lg">{{ title }}</h3>
      </div>
    </template>

    <div class="space-y-4">
      <ui-input
        v-model="form.name"
        :placeholder="placeholder"
        :label="label"
        class="w-full"
        autofocus
      />

      <div>
        <label class="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-2">
          Emoji
        </label>
        <div class="grid grid-cols-8 gap-1 max-h-40 overflow-y-auto">
          <button
            v-for="emoji in EMOJI_ALLOWLIST"
            :key="emoji"
            type="button"
            class="text-xl p-1.5 rounded-lg transition-colors duration-150 hover:bg-neutral-100 dark:hover:bg-neutral-800"
            :class="{ 'bg-primary/15 ring-1 ring-primary': emoji === form.emoji }"
            style="
              font-family:
                'Apple Color Emoji', 'Segoe UI Emoji', 'Noto Color Emoji',
                'Twemoji', sans-serif;
            "
            @click="form.emoji = emoji"
          >
            {{ emoji }}
          </button>
        </div>
      </div>

      <div>
        <label class="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-2">
          Color
        </label>
        <div class="flex flex-wrap gap-2">
          <button
            v-for="color in COLOR_SWATCHES"
            :key="color"
            type="button"
            class="w-8 h-8 rounded-lg transition-all duration-150 border-2"
            :style="{ backgroundColor: color }"
            :class="{ 'ring-2 ring-offset-2 ring-primary scale-110': color === form.color }"
            @click="form.color = color"
            :aria-label="color"
          >
            <span v-if="color === form.color" class="sr-only">Selected</span>
          </button>
        </div>
      </div>

      <div v-if="error" class="text-sm text-red-500" role="alert">
        {{ error }}
      </div>
    </div>

    <template #actions>
      <ui-button class="w-full mobile:!min-h-[48px] mobile:!h-auto mobile:!py-3" @click="onCancel">
        Cancel
      </ui-button>
      <ui-button
        class="w-full mobile:!min-h-[48px] mobile:!h-auto mobile:!py-3"
        variant="primary"
        @click="onConfirm"
        :disabled="submitting"
      >
        {{ submitting ? '...' : okText }}
      </ui-button>
    </template>
  </ui-modal>
</template>

<script>
import { ref, reactive, computed } from 'vue';
import emitter from 'tiny-emitter/instance';

const EMOJI_ALLOWLIST = Object.freeze([
  '📁', '📂', '🗂️', '📋', '📝', '📄', '📃', '📑', '📦', '🎒',
  '💼', '🗃️', '🗄️', '📊', '📈', '📉', '🧮', '📐', '📏', '✏️',
  '📌', '📍', '🏷️', '🔖', '🏷️', '🗒️', '🗓️', '📅', '📆', '📇',
  '📰', '📜', '📖', '📕', '📗', '📘', '📙', '📚', '📓', '📔',
  '🎯', '🎲', '🎮', '🕹️', '🧩', '🎨', '🖼️', '🎪', '🎭', '🎬',
  '🏠', '🏢', '🏭', '🏫', '🏥', '🏦', '🏛️', '⛪', '🕌', '🕍',
  '⛩️', '🏟️', '🎡', '🎢', '💒', '🏰', '🏯', '🏰', '🗼', '🗽',
  '⭐', '🌟', '✨', '💫', '⚡', '🔥', '💎', '💍', '🏆', '🥇',
  '🥈', '🥉', '🏅', '🎖️', '🏵️', '🎗️', '🎀', '🎁', '🎊', '🎉',
  '🌈', '☀️', '🌤️', '⛅', '🌥️', '☁️', '🌦️', '🌧️', '⛈️', '🌩️',
  '🌨️', '❄️', '☃️', '⛄', '☄️', '🌙', '🌙', '🌛', '🌜', '☀️',
  '🪐', '⭐', '🌌', '🌠', '☄️', '🚀', '🛸', '🛰️', '🌍', '🌎',
  '🌏', '🌐', '🗺️', '🧭', '⛰️', '🏔️', '🌋', '🗻', '🏕️', '⛺',
  '🌲', '🌳', '🌴', '🌵', '🌿', '☘️', '🍀', '🍁', '🍂', '🍃',
  '🍄', '🌾', '💐', '🌷', '🌹', '🥀', '🌺', '🌸', '🌼', '🌻',
  '🌱', '🌿', '🌵', '🎄', '🎋', '🎍', '🎍', '🍂', '🍃', '🍁',
]);

const COLOR_SWATCHES = Object.freeze([
  '#6366f1', '#8b5cf6', '#d946ef', '#ec4899', '#f43f5e',
  '#ef4444', '#f97316', '#f59e0b', '#eab308', '#84cc16',
  '#22c55e', '#10b981', '#14b8a6', '#06b6d4', '#0ea5e9',
  '#3b82f6', '#6366f1', '#8b5cf6', '#a855f7', '#d946ef',
]);

const DEFAULT_EMOJI = EMOJI_ALLOWLIST[0];
const DEFAULT_COLOR = COLOR_SWATCHES[0];

export default {
  name: 'WorkspaceFormDialog',
  props: {
    show: { type: Boolean, default: false },
    mode: { type: String, default: 'create' }, // 'create' or 'edit'
    workspace: { type: Object, default: null },
  },
  emits: ['close', 'confirm', 'update:show'],
  setup(props, { emit }) {
    const form = reactive({
      name: '',
      emoji: DEFAULT_EMOJI,
      color: DEFAULT_COLOR,
    });
    const submitting = ref(false);
    const error = ref('');

    const title = computed(() => (props.mode === 'edit' ? 'Edit Workspace' : 'New Workspace'));
    const placeholder = computed(() => (props.mode === 'edit' ? 'Workspace name' : 'Workspace name'));
    const label = computed(() => 'Workspace name');
    const okText = computed(() => (props.mode === 'edit' ? 'Save' : 'Create'));

    function resetForm() {
      form.name = props.workspace?.name || '';
      form.emoji = props.workspace?.emoji || DEFAULT_EMOJI;
      form.color = props.workspace?.color || DEFAULT_COLOR;
      error.value = '';
      submitting.value = false;
    }

    function onConfirm() {
      if (!form.name.trim()) {
        error.value = 'Workspace name is required.';
        return;
      }
      if (submitting.value) return;
      submitting.value = true;
      error.value = '';
      emit('confirm', {
        name: form.name.trim(),
        emoji: form.emoji,
        color: form.color,
      });
    }

    function onCancel() {
      emit('close');
    }

    function onClose() {
      resetForm();
      emit('close');
    }

    function onUpdateShow(value) {
      emit('update:show', value);
    }

    return {
      form,
      submitting,
      error,
      title,
      placeholder,
      label,
      okText,
      EMOJI_ALLOWLIST,
      COLOR_SWATCHES,
      onConfirm,
      onCancel,
      onClose,
      onUpdateShow,
    };
  },
};
</script>