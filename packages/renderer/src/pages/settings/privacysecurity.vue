<!-- eslint-disable vue/multi-word-component-names -->
<template>
  <div class="general space-y-8 mb-14 w-full max-w-xl">
    <section>
      <p class="mb-2">{{ translations.settings.security || '-' }}</p>
      <ui-button class="w-full" @click="resetPasswordDialog">
        {{ translations.settings.resetPassword }}
      </ui-button>
    </section>
  </div>
</template>

<script>
import { shallowReactive, onMounted, ref } from 'vue';
import { useTranslation } from '@/composable/translations';
import { useStorage } from '@/composable/storage';
import { useDialog } from '@/composable/dialog';
import { usePasswordStore } from '@/store/passwd';
import { formatTime } from '@/utils/time-format';
import { useAppStore } from '../../store/app';
import { t } from '@/utils/translations';

export const state = shallowReactive({
  dataDir: '',
  directionPreference: localStorage.getItem('directionPreference') || 'ltr',
});
export const dataDir = state.dataDir;

export default {
  setup() {
    const dialog = useDialog();
    const storage = useStorage();
    const passwordStore = usePasswordStore();

    let defaultPath = '';

    onMounted(() => {
      defaultPath = localStorage.getItem('default-path') || '';
      state.dataDir = defaultPath;
    });

    async function resetPasswordDialog() {
      dialog.prompt({
        title: translations.value.settings.resetPasswordTitle,
        okText: translations.value.settings.next,
        cancelText: translations.value.settings.cancel,
        placeholder: translations.value.settings.password,
        onConfirm: async (currentPassword) => {
          if (!currentPassword) {
            return alert(translations.value.settings.invalidPassword);
          }

          const isCurrentPasswordValid = await passwordStore.isValidPassword(
            currentPassword
          );
          if (!isCurrentPasswordValid) {
            return alert(translations.value.settings.wrongCurrentPassword);
          }

          dialog.prompt({
            title: translations.value.settings.enterNewPassword,
            okText: translations.value.settings.resetPassword,
            body: translations.value.settings.warning,
            cancelText: translations.value.settings.cancel,
            placeholder: translations.value.settings.newPassword,
            onConfirm: async (newPassword) => {
              if (!newPassword) {
                return alert(translations.value.settings.invalidPassword);
              }
              try {
                await passwordStore.resetPassword(currentPassword, newPassword);
                console.log('Password reset successful');
                alert(translations.value.settings.passwordResetSuccess);
              } catch (error) {
                console.error('Error resetting password:', error);
                alert(translations.value.settings.passwordResetError);
              }
            },
          });
        },
      });
    }

    // Translations
    const translations = ref({
      settings: {},
    });

    onMounted(async () => {
      await useTranslation().then((trans) => {
        if (trans) {
          translations.value = trans;
        }
      });
    });

    const appStore = useAppStore();

    return {
      state,
      storage,
      translations,
      resetPasswordDialog,
      defaultPath,
      appStore,
      formatTime,
      t,
    };
  },
  computed: {
    isMacOS() {
      return window.navigator.platform.toLowerCase().includes('mac');
    },
  },
};
</script>
