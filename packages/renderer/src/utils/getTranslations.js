// src/utils/getTranslations.js
const locales = import.meta.glob('@/assets/locales/*.json', { eager: true });

export function getTranslations() {
  const lang = localStorage.getItem('selectedLanguage') || 'en';
  const fallback = locales['/src/assets/locales/en.json']?.default ?? {};
  const selected =
    locales[`/src/assets/locales/${lang}.json`]?.default ?? fallback;
  return { ...fallback, ...selected };
}
