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
          class="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary/10"
        >
          <v-remixicon name="riFolderLine" size="24" class="text-primary" />
        </div>
        <h3 class="font-semibold text-lg">{{ title }}</h3>
      </div>
    </template>

    <div class="space-y-4">
      <ui-input
        v-model="form.name"
        :placeholder="translations.workspaceDialog?.nameLabel || 'Workspace name'"
        :label="translations.workspaceDialog?.nameLabel || 'Workspace name'"
        class="w-full"
        autofocus
      />

      <div>
        <label class="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-2">
          {{ translations.workspaceDialog?.emojiLabel || 'Emoji' }}
        </label>
        <div class="grid grid-cols-10 gap-1 max-h-40 overflow-y-auto">
          <button
            v-for="emoji in EMOJI_ALLOWLIST"
            :key="emoji"
            type="button"
            class="motion-press text-xl p-1.5 rounded-lg transition-colors duration-150 hover:bg-neutral-100 dark:hover:bg-neutral-800"
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
          {{ translations.workspaceDialog?.colorLabel || 'Color' }}
        </label>
        <div class="flex flex-wrap gap-2">
          <button
            v-for="swatch in COLOR_PALETTE"
            :key="swatch.hex"
            type="button"
            class="motion-press w-8 h-8 rounded-lg transition-all duration-150 border-2"
            :style="{ backgroundColor: swatch.hex }"
            :class="{ 'ring-2 ring-offset-2 ring-primary scale-110': swatch.hex.toLowerCase() === form.color.toLowerCase() }"
            :aria-label="swatch.label"
            @click="form.color = swatch.hex"
          >
            <span
              v-if="swatch.hex.toLowerCase() === form.color.toLowerCase()"
              class="sr-only"
            >Selected</span>
          </button>

          <label
            class="motion-press relative w-8 h-8 rounded-lg flex items-center justify-center border-2 overflow-hidden cursor-pointer isolate"
            :class="isCustomColor ? 'ring-2 ring-offset-2 ring-primary' : 'ring-1 ring-black/10 dark:ring-white/10'"
            style="background: conic-gradient(from 0deg, #ef4444, #fbbf24, #84cc16, #06b6d4, #3b82f6, #8b5cf6, #ec4899, #ef4444)"
            :aria-label="translations.workspaceDialog?.customColor || 'Custom color'"
          >
            <v-remixicon
              v-if="!isCustomColor"
              name="riPaletteLine"
              size="14"
              class="text-white drop-shadow pointer-events-none relative z-10"
            />
            <input
              type="color"
              class="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
              :value="form.color"
              @input="form.color = $event.target.value"
              tabindex="0"
            />
          </label>
        </div>
      </div>

      <div v-if="error" class="text-sm text-red-500" role="alert">
        {{ error }}
      </div>
    </div>

    <template #actions>
      <ui-button class="w-full mobile:!min-h-[48px] mobile:!h-auto mobile:!py-3" @click="onCancel">
        {{ translations.workspaceDialog?.cancel || 'Cancel' }}
      </ui-button>
      <ui-button
        class="w-full mobile:!min-h-[48px] mobile:!h-auto mobile:!py-3"
        variant="primary"
        :loading="submitting"
        @click="onConfirm"
      >
        {{ okText }}
      </ui-button>
    </template>
  </ui-modal>
</template>

<script>
import { ref, reactive, computed, watch } from 'vue';
import { useTranslations } from '@/composable/useTranslations';

const EMOJI_ALLOWLIST = Object.freeze([
  '📁', '📂', '🗂️', '📋', '📝', '📄', '📃', '📑', '📦', '🎒',
  '💼', '🗃️', '🗄️', '📊', '📈', '📉', '🧮', '📐', '📏', '✏️',
  '📌', '📍', '🏷️', '🔖', '🗒️', '🗓️', '📅', '📆', '📇', '📰',
  '📜', '📖', '📕', '📗', '📘', '📙', '📚', '📓', '📔', '🎯',
  '🎲', '🎮', '🕹️', '🧩', '🎨', '🖼️', '🎪', '🎭', '🎬', '🏠',
  '🏢', '🏭', '🏫', '🏥', '🏦', '🏛️', '⛪', '🕌', '🕍', '⛩️',
  '🏟️', '🎡', '🎢', '💒', '🏰', '🏯', '🗼', '🗽', '⭐', '🌟',
  '✨', '💫', '⚡', '🔥', '💎', '💍', '🏆', '🥇', '🥈', '🥉',
  '🏅', '🎖️', '🏵️', '🎗️', '🎀', '🎁', '🎊', '🎉', '🌈', '☀️',
  '🌤️', '⛅', '🌥️', '☁️', '🌦️', '🌧️', '⛈️', '🌩️', '🌨️', '❄️',
  '☃️', '⛄', '☄️', '🌙', '🌛', '🌜', '🪐', '🌌', '🌠', '🚀',
  '🛸', '🛰️', '🌍', '🌎', '🌏', '🌐', '🗺️', '🧭', '⛰️', '🏔️',
  '🌋', '🗻', '🏕️', '⛺', '🌲', '🌳', '🌴', '🌵', '🌿', '☘️',
  '🍀', '🍁', '🍂', '🍃', '🍄', '🌾', '💐', '🌷', '🌹', '🥀',
  '🌺', '🌸', '🌼', '🌻', '🌱', '🎄', '🎋', '🎍',
]);

// Same hex set as labelPalette in Labels.vue, so picking a workspace color
// suggests the same palette as recoloring a label.
const COLOR_PALETTE = Object.freeze([
  { label: 'Red', hex: '#ef4444' },
  { label: 'Amber', hex: '#fbbf24' },
  { label: 'Green', hex: '#10b981' },
  { label: 'Blue', hex: '#3b82f6' },
  { label: 'Purple', hex: '#8b5cf6' },
  { label: 'Pink', hex: '#ec4899' },
  { label: 'Neutral', hex: '#a3a3a3' },
]);

const DEFAULT_EMOJI = EMOJI_ALLOWLIST[0];
const DEFAULT_COLOR = COLOR_PALETTE[0].hex;

export default {
  name: 'WorkspaceFormDialog',
  props: {
    show: { type: Boolean, default: false },
    mode: { type: String, default: 'create' }, // 'create' or 'edit'
    workspace: { type: Object, default: null },
    // Async submit handler. The dialog awaits it so it can keep the loading
    // state honest: clear it on success AND on failure, and surface the failure
    // inline instead of stranding the button on a fake loading state.
    submitHandler: { type: Function, default: null },
  },
  emits: ['close', 'confirm', 'update:show'],
  setup(props, { emit }) {
    const { translations } = useTranslations();

    const form = reactive({
      name: '',
      emoji: DEFAULT_EMOJI,
      color: DEFAULT_COLOR,
    });
    const submitting = ref(false);
    const error = ref('');

    const title = computed(() =>
      props.mode === 'edit'
        ? translations.value.workspaceDialog?.editWorkspace || 'Edit Workspace'
        : translations.value.workspaceDialog?.newWorkspace || 'New Workspace'
    );
    const okText = computed(() =>
      props.mode === 'edit'
        ? translations.value.workspaceDialog?.save || 'Save'
        : translations.value.workspaceDialog?.create || 'Create'
    );
    const isCustomColor = computed(
      () => !COLOR_PALETTE.some((swatch) => swatch.hex.toLowerCase() === form.color.toLowerCase())
    );

    function resetForm() {
      form.name = props.workspace?.name || '';
      form.emoji = props.workspace?.emoji || DEFAULT_EMOJI;
      form.color = props.workspace?.color || DEFAULT_COLOR;
      error.value = '';
      submitting.value = false;
    }

    async function onConfirm() {
      if (!form.name.trim()) {
        error.value = translations.value.workspaceDialog?.nameRequired || 'Workspace name is required.';
        return;
      }
      if (submitting.value) return;
      submitting.value = true;
      error.value = '';
      const payload = {
        name: form.name.trim(),
        emoji: form.emoji,
        color: form.color,
      };
      try {
        if (props.submitHandler) {
          await props.submitHandler(payload);
          resetForm();
          emit('close');
          return;
        }
        emit('confirm', payload);
      } catch (err) {
        error.value = err?.message || translations.value.workspaceDialog?.saveFailed || 'Failed to save workspace.';
      } finally {
        submitting.value = false;
      }
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

    // Load the workspace (and clear any stale error/loading) whenever the
    // dialog opens, so a programmatic v-model close can't leave the button
    // stuck loading for the next open.
    watch(
      () => props.show,
      (value) => {
        if (value) resetForm();
      }
    );

    return {
      form,
      submitting,
      error,
      title,
      okText,
      translations,
      isCustomColor,
      EMOJI_ALLOWLIST,
      COLOR_PALETTE,
      onConfirm,
      onCancel,
      onClose,
      onUpdateShow,
    };
  },
};
</script>
