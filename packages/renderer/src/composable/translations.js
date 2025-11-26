const locales = import.meta.glob('@/assets/locales/*.json', { eager: true });

export const useTranslation = async (fallback = 'en') => {
  const selectedLanguage = localStorage.getItem('selectedLanguage') || fallback;
  try {
    const fallbackData =
      locales[`/src/assets/locales/${fallback}.json`]?.default ?? {};
    const selectedData =
      locales[`/src/assets/locales/${selectedLanguage}.json`]?.default ?? {};
    return { ...fallbackData, ...selectedData };
  } catch (error) {
    console.error('Error loading translations:', error);
    return null;
  }
};
