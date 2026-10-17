import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, enableAutoUnmount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { nextTick } from 'vue';
import { useToastStore } from '@/store/ui-toast';
import ToastHost from '../ToastHost.vue';
import ToastHostSource from '../ToastHost.vue?raw';

enableAutoUnmount(afterEach);

beforeEach(() => {
  vi.useFakeTimers();
  setActivePinia(createPinia());
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useToastStore', () => {
  it('push adds a toast and auto-dismisses after 5s', () => {
    const store = useToastStore();

    store.push({ title: 'Saved' });

    expect(store.toasts).toEqual([
      { id: expect.any(Number), title: 'Saved', kind: 'info', undo: null },
    ]);
    vi.advanceTimersByTime(4999);
    expect(store.toasts.length).toBe(1);
    vi.advanceTimersByTime(1);
    expect(store.toasts.length).toBe(0);
  });

  it('undo action appears, is callable and dismisses the toast', async () => {
    const undo = vi.fn();
    const store = useToastStore();
    store.push({ title: 'Note moved', undo });

    const wrapper = mount(ToastHost);
    await nextTick();

    const button = wrapper.find('button');
    expect(button.exists()).toBe(true);
    expect(button.text()).toBe('Undo');
    await button.trigger('click');
    expect(undo).toHaveBeenCalledTimes(1);
    expect(store.toasts.length).toBe(0);
  });

  it('push caps at 3 toasts', () => {
    const store = useToastStore();

    store.push({ title: 'one' });
    store.push({ title: 'two' });
    store.push({ title: 'three' });
    store.push({ title: 'four' });

    expect(store.toasts.map((t) => t.title)).toEqual(['two', 'three', 'four']);
  });

  it('a second push does not extend the first toast auto-dismiss', () => {
    const store = useToastStore();

    store.push({ title: 'first' });
    vi.advanceTimersByTime(2500);
    store.push({ title: 'second' });
    // First toast's 5s timer is independent: it fires at t=5000 regardless of the later push.
    vi.advanceTimersByTime(2500);
    expect(store.toasts.map((t) => t.title)).toEqual(['second']);
  });
});

describe('ToastHost source', () => {
  it('reduced-motion declared for toast host', () => {
    expect(ToastHostSource).toMatch(/@media\s*\(prefers-reduced-motion/);
  });
});
