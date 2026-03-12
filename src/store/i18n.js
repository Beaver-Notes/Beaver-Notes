// src/store/i18n.js
import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import dayjs from '@/lib/dayjs';
import { getSettingSync, setSetting } from '@/composable/settings';

const localeFiles = import.meta.glob('@/assets/locales/*.json', {
  eager: true,
});

const dayjsLocales = import.meta.glob('../../node_modules/dayjs/locale/*.js');

export const useI18nStore = defineStore('i18n', () => {
  const lang = ref(getSettingSync('selectedLanguage'));

  const messages = computed(() => {
    const fallback = localeFiles[`/src/assets/locales/en.json`]?.default ?? {};
    const selected =
      localeFiles[`/src/assets/locales/${lang.value}.json`]?.default ??
      fallback;
    return { ...fallback, ...selected };
  });

  async function setLanguage(newLang) {
    lang.value = newLang;
    await setSetting('selectedLanguage', newLang);
    if (newLang !== 'en') {
      try {
        await dayjsLocales[`../../node_modules/dayjs/locale/${newLang}.js`]?.();
      } catch {
        // default to 'en'
      }
    }
    dayjs.locale(newLang);
  }

  setLanguage(lang.value).catch((error) => {
    console.error('[i18n] failed to initialize language:', error);
  });

  return { lang, messages, setLanguage };
});
