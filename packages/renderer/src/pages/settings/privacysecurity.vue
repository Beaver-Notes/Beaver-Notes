<!-- eslint-disable vue/multi-word-component-names -->
<template>
  <div class="general space-y-8 mb-14 w-full max-w-xl">
    <section>
      <p class="mb-2">{{ translations.settings.security || '-' }}</p>
      <ui-button class="w-full" @click="resetPasswordDialog">{{
        translations.settings.resetPassword
      }}</ui-button>
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

const deTranslations = import('../../pages/settings/locales/de.json');
const enTranslations = import('../../pages/settings/locales/en.json');
const esTranslations = import('../../pages/settings/locales/es.json');
const itTranslations = import('../../pages/settings/locales/it.json');
const nlTranslations = import('../../pages/settings/locales/nl.json');
const zhTranslations = import('../../pages/settings/locales/zh.json');
const ukTranslations = import('../../pages/settings/locales/uk.json');

export const state = shallowReactive({
  dataDir: '',
  directionPreference: localStorage.getItem('directionPreference') || 'ltr',
});
export const dataDir = state.dataDir;

export default {
  setup() {
    const dialog = useDialog();
    const storage = useStorage();

    let defaultPath = '';

    onMounted(() => {
      defaultPath = localStorage.getItem('default-path') || ''; // Set defaultPath here
      state.dataDir = defaultPath;
    });

    async function resetPasswordDialog() {
      const passwordStore = usePasswordStore(); // Get the password store instance

      dialog.prompt({
        title: translations.value.settings.resetPasswordTitle,
        okText: translations.value.settings.next,
        cancelText: translations.value.settings.Cancel,
        placeholder: translations.value.settings.password,
        onConfirm: async (currentPassword) => {
          if (currentPassword) {
            const isCurrentPasswordValid = await passwordStore.isValidPassword(
              currentPassword
            );
            if (isCurrentPasswordValid) {
              dialog.prompt({
                title: translations.value.settings.enterNewPassword,
                okText: translations.value.settings.resetPassword,
                body: translations.value.settings.warning,
                cancelText: translations.value.settings.Cancel,
                placeholder: translations.value.settings.newPassword,
                onConfirm: async (newPassword) => {
                  if (newPassword) {
                    try {
                      // Reset the password
                      await passwordStore.setsharedKey(newPassword);
                      console.log('Password reset successful');
                      alert(translations.value.settings.passwordResetSuccess);
                    } catch (error) {
                      console.error('Error resetting password:', error);
                      alert(translations.value.settings.passwordResetError);
                    }
                  } else {
                    alert(translations.value.settings.Invalidpassword);
                  }
                },
              });
            } else {
              alert(translations.value.settings.wrongCurrentPassword);
            }
          } else {
            alert(translations.value.settings.Invalidpassword);
          }
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
  data() {
    return {
      advancedSettings: localStorage.getItem('advanced-settings') === 'true',
      directionPreference: localStorage.getItem('directionPreference') || 'ltr',
      spellcheckEnabled:
        localStorage.getItem('spellcheckEnabled') === 'true' &&
        localStorage.getItem('spellcheckEnabled') != null,
      disableAppReminder: localStorage.getItem('disableAppReminder') === 'true',
      autoSync: localStorage.getItem('autoSync') === 'true',
      selectedFont: localStorage.getItem('selected-font') || 'Arimo',
      selectedLanguage: localStorage.getItem('selectedLanguage') || 'en', // Initialize with a value from localStorage if available
      languages: [
        { code: 'de', name: 'Deutsch', translations: deTranslations },
        { code: 'en', name: 'English', translations: enTranslations },
        { code: 'es', name: 'Español', translations: esTranslations },
        { code: 'it', name: 'Italiano', translations: itTranslations },
        { code: 'nl', name: 'Nederlands', translations: nlTranslations },
        { code: 'zh', name: '简体中文', translations: zhTranslations },
        { code: 'uk', name: 'Українська', translations: ukTranslations },
      ],
    };
  },
  computed: {
    isMacOS() {
      return window.navigator.platform.toLowerCase().includes('mac');
    },
  },
};
</script>
