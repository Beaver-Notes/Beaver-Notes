import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

const { updateMenu } = vi.hoisted(() => ({ updateMenu: vi.fn() }));
const { backend } = vi.hoisted(() => ({
  backend: { isDesktopRuntime: vi.fn(() => true) },
}));

vi.mock('@/lib/native/app', () => ({ updateMenu }));
vi.mock('@/lib/tauri-bridge', () => ({ backend }));

import { pushMenuContext } from '../menuContext.js';

const CONTEXT = { screen: 'note', noteEditable: true, noteLocked: false };

describe('pushMenuContext', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    updateMenu.mockReset();
    updateMenu.mockResolvedValue(undefined);
    backend.isDesktopRuntime.mockReset();
    backend.isDesktopRuntime.mockReturnValue(true);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('invokes updateMenu with the context after the debounce delay on desktop', async () => {
    pushMenuContext(CONTEXT);

    await vi.advanceTimersByTimeAsync(149);
    expect(updateMenu).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(updateMenu).toHaveBeenCalledTimes(1);
    expect(updateMenu).toHaveBeenCalledWith(CONTEXT);
  });

  it('coalesces rapid calls into a single updateMenu invocation with the latest context', async () => {
    pushMenuContext(CONTEXT);
    pushMenuContext({ ...CONTEXT, screen: 'reader' });
    pushMenuContext({ ...CONTEXT, screen: 'settings' });

    await vi.advanceTimersByTimeAsync(150);
    expect(updateMenu).toHaveBeenCalledTimes(1);
    expect(updateMenu).toHaveBeenCalledWith({ ...CONTEXT, screen: 'settings' });
  });

  it('does not call updateMenu on a non-desktop runtime even after the delay', async () => {
    backend.isDesktopRuntime.mockReturnValue(false);

    pushMenuContext(CONTEXT);
    await vi.advanceTimersByTimeAsync(500);

    expect(updateMenu).not.toHaveBeenCalled();
  });

  it('does not throw when updateMenu rejects', async () => {
    updateMenu.mockRejectedValue(new Error('menu unavailable'));

    pushMenuContext(CONTEXT);
    await vi.advanceTimersByTimeAsync(150);

    expect(updateMenu).toHaveBeenCalledTimes(1);
  });
});
