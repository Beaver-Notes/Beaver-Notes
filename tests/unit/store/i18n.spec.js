// tests/unit/store/i18n.spec.js
import { describe, it, expect } from 'vitest';
import { useI18nStore } from '@/store/i18n';

describe('i18n store', () => {
  it('initialises with the stored language', () => {
    const store = useI18nStore();
    expect(typeof store.lang).toBe('string');
  });

  it('switches language and reflects it in state', async () => {
    const store = useI18nStore();
    await store.setLanguage('en');
    expect(store.lang).toBe('en');
    expect(document.documentElement.getAttribute('lang')).toBe('en');
  });
});
