import { describe, it, expect, vi } from 'vitest'; import { mount } from '@vue/test-utils'; import ReaderChrome from '@/components/note/ReaderChrome.vue';
describe('ReaderChrome', () => {
  it('Done emits exit', async () => { const w = mount(ReaderChrome); await w.find('[data-testid="reader-done"]').trigger('click'); expect(w.emitted('exit')).toBeTruthy(); });
  it('Aa buttons emit change', async () => { const w = mount(ReaderChrome); await w.find('[data-testid="theme-sepia"]').trigger('click'); expect(w.emitted('change')).toBeTruthy(); });
  it('auto-hide hides after 3s', async () => { vi.useFakeTimers(); const w = mount(ReaderChrome); expect(w.vm.visible).toBe(true); vi.advanceTimersByTime(3100); await w.vm.$nextTick(); expect(w.vm.visible).toBe(false); vi.useRealTimers(); });
});
