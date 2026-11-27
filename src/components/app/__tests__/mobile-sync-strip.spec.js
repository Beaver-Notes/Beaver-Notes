import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, enableAutoUnmount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { nextTick } from 'vue';
import { readFileSync } from 'node:fs';

const syncCtl = vi.hoisted(() => ({
  syncNow: vi.fn(),
  label: 'Synced just now',
}));

vi.mock('@/composable/useSyncControl', async () => {
  const { computed } = await import('vue');
  return {
    useSyncControl: () => ({
      lastSyncLabel: computed(() => syncCtl.label),
      syncNow: syncCtl.syncNow,
    }),
  };
});

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
}));
vi.mock('@/lib/native/app', () => ({ notify: vi.fn(() => Promise.resolve()) }));
vi.mock('@/composable/useTranslations', () => ({
  useTranslations: () => ({
    translations: {
      value: {
        settings: {
          syncNow: 'Sync now',
          syncing: 'Syncing...',
        },
      },
    },
  }),
}));

import { useSyncProgressStore } from '@/store/sync-progress';
import VRemixIcon from '@/lib/v-remixicon';
import MobileSyncStrip from '../MobileSyncStrip.vue';

enableAutoUnmount(afterEach);

function dispatchTouch(type, y, opts = {}) {
  const ev = new Event(type);
  ev.touches = [{ clientY: y, ...opts.touch }];
  if (opts.target) {
    Object.defineProperty(ev, 'target', { value: opts.target });
  }
  if (opts.changed) ev.changedTouches = [{ clientY: y }];
  document.dispatchEvent(ev);
}

function pencilPull() {
  dispatchTouch('touchstart', 100, { touch: { type: 'stylus' } });
  dispatchTouch('touchmove', 200, { touch: { type: 'stylus' } });
  dispatchTouch('touchend', 200, { touch: { type: 'stylus' }, changed: true });
}

function pullToReveal() {
  dispatchTouch('touchstart', 100);
  dispatchTouch('touchmove', 140);
  dispatchTouch('touchend', 140, { changed: true });
}

function pullToRefresh() {
  dispatchTouch('touchstart', 100);
  dispatchTouch('touchmove', 200);
  dispatchTouch('touchend', 200, { changed: true });
}

function inkSurfacePull() {
  const surface = document.createElement('div');
  surface.setAttribute('data-paper-surface', '');
  document.body.appendChild(surface);
  dispatchTouch('touchstart', 100, { target: surface });
  dispatchTouch('touchmove', 200, { target: surface });
  dispatchTouch('touchend', 200, { target: surface, changed: true });
  surface.remove();
}

async function mountStrip() {
  const wrapper = mount(MobileSyncStrip, {
    attachTo: document.body,
    global: { plugins: [VRemixIcon] },
  });
  await nextTick();
  return wrapper;
}

describe('MobileSyncStrip', () => {
  let store;

  beforeEach(() => {
    setActivePinia(createPinia());
    store = useSyncProgressStore();
    syncCtl.syncNow.mockReset();
    syncCtl.label = 'Synced just now';
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('stays hidden until the user pulls down', async () => {
    const wrapper = await mountStrip();
    expect(wrapper.find('[data-testid="mobile-sync-strip"]').isVisible()).toBe(false);

    pullToReveal();
    await nextTick();

    expect(wrapper.find('[data-testid="mobile-sync-strip"]').isVisible()).toBe(true);
  });

  it('shows the live sync status and progress while syncing', async () => {
    store.status = 'syncing';
    store.phase = 'push';
    store.total = 4;
    store.processed = 1;
    store.progress = 25;

    const wrapper = await mountStrip();
    pullToReveal();
    await nextTick();

    expect(wrapper.get('[data-testid="sync-status"]').text()).toContain('Pushing updates');
    expect(wrapper.get('[data-testid="sync-progress"]').attributes('style')).toContain('width: 25%');
  });

  it('exposes the status to assistive technology', async () => {
    const wrapper = await mountStrip();
    pullToReveal();
    await nextTick();

    const live = wrapper.get('[role="status"]');
    expect(live.attributes('aria-live')).toBe('polite');

    const icon = wrapper.get('[data-testid="sync-icon"]');
    expect(icon.attributes('aria-hidden')).toBe('true');
    expect(wrapper.get('[data-testid="sync-status"]').text().trim()).not.toBe('');
  });

  it('auto-hides after the timeout when the state is calm', async () => {
    const wrapper = await mountStrip();
    pullToReveal();
    await nextTick();
    expect(wrapper.find('[data-testid="mobile-sync-strip"]').isVisible()).toBe(true);

    vi.advanceTimersByTime(6000);
    await nextTick();

    expect(wrapper.find('[data-testid="mobile-sync-strip"]').isVisible()).toBe(false);
  });

  it('does not auto-hide while a sync is running', async () => {
    store.status = 'syncing';
    store.phase = 'push';

    const wrapper = await mountStrip();
    pullToReveal();
    await nextTick();

    vi.advanceTimersByTime(6000);
    await nextTick();

    expect(wrapper.find('[data-testid="mobile-sync-strip"]').isVisible()).toBe(true);
  });

  it('does not auto-hide while an attention/error state is active', async () => {
    store.lastAction = {
      status: 'sync-failed',
      text: 'Sync stopped unexpectedly',
      detail: 'boom: transport died',
      at: Date.now(),
    };

    const wrapper = await mountStrip();
    pullToReveal();
    await nextTick();
    expect(wrapper.get('[data-testid="sync-attention-detail"]').text()).toContain('boom: transport died');

    vi.advanceTimersByTime(6000);
    await nextTick();

    expect(wrapper.find('[data-testid="mobile-sync-strip"]').isVisible()).toBe(true);
  });

  it('stays passive: no inline toggle button (pull-to-refresh and Settings are the only triggers)', async () => {
    const wrapper = await mountStrip();
    pullToReveal();
    await nextTick();

    expect(wrapper.find('[data-testid="sync-toggle"]').exists()).toBe(false);
  });

  it('runs the shared handler on a full pull-to-refresh', async () => {
    await mountStrip();

    pullToRefresh();
    await nextTick();

    expect(syncCtl.syncNow).toHaveBeenCalledTimes(1);
  });

  it('ignores Apple Pencil strokes: drawing at the top never reveals or syncs', async () => {
    const wrapper = await mountStrip();

    pencilPull();
    await nextTick();

    // an ink stroke must not read as pull-to-sync (revealed strip + kick)
    expect(wrapper.find('[data-testid="mobile-sync-strip"]').isVisible()).toBe(false);
    expect(syncCtl.syncNow).not.toHaveBeenCalled();
  });

  it('ignores pulls that start on an ink surface (paper/pdf markup)', async () => {
    const wrapper = await mountStrip();

    inkSurfacePull();
    await nextTick();

    expect(wrapper.find('[data-testid="mobile-sync-strip"]').isVisible()).toBe(false);
    expect(syncCtl.syncNow).not.toHaveBeenCalled();
  });

  it('ignores pull gestures while a modal dialog is open', async () => {
    const wrapper = await mountStrip();
    const dlg = document.createElement('div');
    dlg.setAttribute('role', 'dialog');
    document.body.appendChild(dlg);

    try {
      pullToReveal();
      await nextTick();
      expect(wrapper.find('[data-testid="mobile-sync-strip"]').isVisible()).toBe(false);

      pullToRefresh();
      await nextTick();
      expect(syncCtl.syncNow).not.toHaveBeenCalled();
    } finally {
      dlg.remove();
    }

    pullToReveal();
    await nextTick();
    expect(wrapper.find('[data-testid="mobile-sync-strip"]').isVisible()).toBe(true);
  });

  it('desktop settings surface routes through the same shared control (no duplicate handler)', () => {
    const src = readFileSync('src/pages/settings/Index.vue', 'utf8');
    expect(src).toContain("from '@/composable/useSyncControl'");
    expect(src).not.toMatch(/\bkickRustSync\s*\(/);
  });

  it('detaches its pull listeners on unmount so surfaces cannot both react', async () => {
    const addSpy = vi.spyOn(document, 'addEventListener');
    const removeSpy = vi.spyOn(document, 'removeEventListener');

    try {
      const leavingSurface = await mountStrip();
      const added = addSpy.mock.calls
        .map(([type]) => type)
        .filter((type) => type.startsWith('touch'));
      expect(added).toEqual(
        expect.arrayContaining(['touchstart', 'touchmove', 'touchend']),
      );

      leavingSurface.unmount();

      const removed = removeSpy.mock.calls
        .map(([type]) => type)
        .filter((type) => type.startsWith('touch'));
      expect(removed).toEqual(
        expect.arrayContaining(['touchstart', 'touchmove', 'touchend']),
      );

      syncCtl.syncNow.mockClear();
      pullToRefresh();
      await nextTick();
      expect(syncCtl.syncNow).not.toHaveBeenCalled();
    } finally {
      addSpy.mockRestore();
      removeSpy.mockRestore();
    }
  });
});
