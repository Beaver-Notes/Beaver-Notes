import { describe, it, expect, vi } from 'vitest';
import keepFocus from '../keepFocus';

function makeEl() {
  const listeners = {};
  return {
    listeners,
    addEventListener: vi.fn((type, fn) => { listeners[type] = fn; }),
    removeEventListener: vi.fn(),
  };
}

describe('keepFocus directive', () => {
  it('prevents default on mousedown so focus is not stolen', () => {
    const el = makeEl();
    keepFocus.mounted(el);
    const handler = el.listeners.mousedown;
    expect(handler).toBeDefined();
    const event = { preventDefault: vi.fn() };
    handler(event);
    expect(event.preventDefault).toHaveBeenCalled();
  });

  it('removes listeners on unmount', () => {
    const el = makeEl();
    keepFocus.mounted(el);
    keepFocus.unmounted(el);
    expect(el.removeEventListener).toHaveBeenCalledWith('mousedown', el.listeners.mousedown, true);
  });
});
