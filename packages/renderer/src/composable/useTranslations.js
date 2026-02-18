// src/composable/useTranslations.js
import { useI18nStore } from '@/store/i18n';
import { computed } from 'vue';

export function useTranslations() {
  const i18n = useI18nStore();
  const translations = computed(() => i18n.messages);
  return { translations };
}
