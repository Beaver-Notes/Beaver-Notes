export const useTranslation = async (fallback = 'en') => {
  const selectedLanguage = localStorage.getItem('selectedLanguage') || fallback;
  try {
    const translationModule = await import(
      `@/assets/locales/${selectedLanguage}.json`
    );
    const translationsFallbackModule = await import(
      `@/assets/locales/${fallback}.json`
    );
    return Object.assign(
      translationsFallbackModule.default,
      translationModule.default
    );
  } catch (error) {
    console.error('Error loading translations:', error);
    return null;
  }
};
