// src/store/i18n.js
import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import dayjs from '@/lib/dayjs';
import { getSettingSync, setSetting } from '@/composable/settings';

const localeFiles = import.meta.glob<{ default: Record<string, string> }>('@/assets/locales/*.json', {
  eager: false,
});

const dayjsLocales = import.meta.glob('../../node_modules/dayjs/locale/*.js');

export const useI18nStore = defineStore('i18n', () => {
  const lang = ref<string>(getSettingSync('selectedLanguage') as string);
  const loadedMessages = ref<Record<string, Record<string, string>>>({});

  let _cachedLang: string | null = null;
  let _cachedMessages: Record<string, string> | null = null;

  const messages = computed(() => {
    if (lang.value === _cachedLang && _cachedMessages) return _cachedMessages;
    const fallback: Record<string, string> = loadedMessages.value['en'] ?? {};
    const selected: Record<string, string> =
      lang.value === 'en'
        ? fallback
        : loadedMessages.value[lang.value] ?? fallback;
    _cachedLang = lang.value;
    _cachedMessages = lang.value === 'en' ? fallback : { ...fallback, ...selected };
    return _cachedMessages;
  });

  async function loadLocale(locale: string) {
    if (loadedMessages.value[locale]) return;
    const path = `/src/assets/locales/${locale}.json`;
    const loader = localeFiles[path];
    if (loader) {
      const mod = await loader();
      loadedMessages.value[locale] = mod.default;
    }
  }

  async function setLanguage(newLang: string) {
    await loadLocale('en');
    if (newLang !== 'en') {
      await loadLocale(newLang);
    }
    lang.value = newLang;
    _cachedLang = null;
    _cachedMessages = null;
    await setSetting('selectedLanguage', newLang);
    document.documentElement.setAttribute('lang', newLang);
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
