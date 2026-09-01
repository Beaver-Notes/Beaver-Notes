import { describe, it, expect, beforeEach } from 'vitest';
import { useReaderPrefs, STORAGE_KEY } from '@/composable/useReaderPrefs';
describe('useReaderPrefs', () => {
  beforeEach(() => localStorage.clear());
  it('defaults light/18/1.75/serif', () => {
    const { prefs } = useReaderPrefs(); expect(prefs.value.theme).toBe('light');
    expect(prefs.value.size).toBe(18); expect(prefs.value.line).toBe(1.75); expect(prefs.value.family).toBe('default');
  });
  it('persists and rehydrates', () => {
    const a = useReaderPrefs(); a.setTheme('sepia'); a.setSize(20);
    const b = useReaderPrefs(); b.hydrate(); expect(b.prefs.value.theme).toBe('sepia'); expect(b.prefs.value.size).toBe(20);
  });
  it('discards corrupt JSON', () => {
    localStorage.setItem(STORAGE_KEY, '{bad'); const { prefs, hydrate } = useReaderPrefs(); hydrate(); expect(prefs.value.theme).toBe('light');
  });
  it('quota catch keeps memory', () => {
    const { prefs, setTheme } = useReaderPrefs();
    const orig = Storage.prototype.setItem; Storage.prototype.setItem = () => { throw new Error('quota'); };
    expect(() => setTheme('dark')).not.toThrow(); expect(prefs.value.theme).toBe('dark');
    Storage.prototype.setItem = orig;
  });
});
