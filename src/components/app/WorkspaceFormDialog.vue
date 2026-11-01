<template>
  <ui-customize-editor
    :model-value="show"
    kind="workspace"
    :title="title"
    :primary-label="okText"
    :name-placeholder="translations.workspaceDialog?.nameLabel || 'Workspace name'"
    :initial-name="initialName"
    :initial-color="initialColor"
    :initial-icon="initialIcon"
    :quick-icons="WORKSPACE_QUICK_ICONS"
    :saving="submitting"
    :error="error"
    :autofocus-name="mode !== 'edit'"
    :overlay-class="'z-[70]'"
    :persist="true"
    @update:model-value="onUpdateShow"
    @close="onClose"
    @save="onSave"
  />
</template>

<script>
import { ref, computed, watch } from 'vue';
import { useTranslations } from '@/composable/useTranslations';
import {
  CUSTOMIZE_DEFAULT_COLOR,
  WORKSPACE_QUICK_ICONS,
  WORKSPACE_DEFAULT_EMOJI,
} from '@/lib/customize';

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

    const initialName = ref('');
    const initialColor = ref(CUSTOMIZE_DEFAULT_COLOR);
    const initialIcon = ref(WORKSPACE_DEFAULT_EMOJI);
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

    function resetForm() {
      initialName.value = props.workspace?.name || '';
      initialColor.value = props.workspace?.color || CUSTOMIZE_DEFAULT_COLOR;
      initialIcon.value = props.workspace?.emoji || WORKSPACE_DEFAULT_EMOJI;
      error.value = '';
      submitting.value = false;
    }

    async function onSave({ name, color, icon }) {
      if (!name.trim()) {
        error.value = translations.value.workspaceDialog?.nameRequired || 'Workspace name is required.';
        return;
      }
      if (submitting.value) return;
      submitting.value = true;
      error.value = '';
      const payload = {
        name: name.trim(),
        emoji: icon || WORKSPACE_DEFAULT_EMOJI,
        color,
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

    function onClose() {
      resetForm();
      emit('close');
    }

    function onUpdateShow(value) {
      if (!value) resetForm();
      emit('update:show', value);
    }

    // Load the workspace (and clear any stale error/loading) whenever the
    // dialog opens, so a programmatic v-model close can't leave the button
    // stuck loading for the next open.
    watch(
      () => props.show,
      (value) => {
        if (value) resetForm();
      },
      { immediate: true }
    );

    return {
      initialName,
      initialColor,
      initialIcon,
      submitting,
      error,
      title,
      okText,
      translations,
      WORKSPACE_QUICK_ICONS,
      onSave,
      onClose,
      onUpdateShow,
    };
  },
};
</script>
