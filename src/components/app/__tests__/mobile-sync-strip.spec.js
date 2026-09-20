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

function dispatchTouch(type, y, changed = false) {
  const ev = new Event(type);
  ev.touches = [{ clientY: y }];
  if (changed) ev.changedTouches = [{ clientY: y }];
  document.dispatchEvent(ev);
}

function pullToReveal() {
  dispatchTouch('touchstart', 100);
  dispatchTouch('touchmove', 140);
  dispatchTouch('touchend', 140, true);
}

function pullToRefresh() {
  dispatchTouch('touchstart', 100);
  dispatchTouch('touchmove', 200);
  dispatchTouch('touchend', 200, true);
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
    expect(wrapper.find('[data-testid="mobile-sync-strip"]').exists()).toBe(false);

    pullToReveal();
    await nextTick();

    expect(wrapper.find('[data-testid="mobile-sync-strip"]').exists()).toBe(true);
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

  it('renders as a flat full-width top bar with an icon and status text', async () => {
    const wrapper = await mountStrip();
    pullToReveal();
    await nextTick();

    const root = wrapper.get('[data-testid="mobile-sync-strip"]');
    expect(root.classes()).toContain('inset-x-0');
    expect(root.classes()).toContain('w-full');

    expect(wrapper.find('[data-testid="sync-icon"]').exists()).toBe(true);
    expect(wrapper.get('[data-testid="sync-status"]').text().trim().length).toBeGreaterThan(0);

    const live = wrapper.get('[role="status"]');
    expect(live.classes()).not.toContain('rounded-2xl');
    expect(live.classes()).not.toContain('shadow-xl');
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

  it('tones the icon by status (calm, syncing, error)', async () => {
    const wrapper = await mountStrip();
    pullToReveal();
    await nextTick();

    let icon = wrapper.get('[data-testid="sync-icon"]');
    expect(icon.attributes('data-tone')).toBe('calm');
    expect(icon.classes()).toContain('text-emerald-600');

    store.status = 'syncing';
    store.phase = 'push';
    await nextTick();
    icon = wrapper.get('[data-testid="sync-icon"]');
    expect(icon.attributes('data-tone')).toBe('syncing');
    expect(icon.classes()).toContain('text-primary');

    store.status = 'idle';
    store.lastAction = {
      status: 'sync-failed',
      text: 'Sync stopped unexpectedly',
      at: Date.now(),
    };
    await nextTick();
    icon = wrapper.get('[data-testid="sync-icon"]');
    expect(icon.attributes('data-tone')).toBe('action');
    expect(icon.classes()).toContain('text-red-600');
  });

  it('auto-hides after the timeout when the state is calm', async () => {
    const wrapper = await mountStrip();
    pullToReveal();
    await nextTick();
    expect(wrapper.find('[data-testid="mobile-sync-strip"]').exists()).toBe(true);

    vi.advanceTimersByTime(6000);
    await nextTick();

    expect(wrapper.find('[data-testid="mobile-sync-strip"]').exists()).toBe(false);
  });

  it('does not auto-hide while a sync is running', async () => {
    store.status = 'syncing';
    store.phase = 'push';

    const wrapper = await mountStrip();
    pullToReveal();
    await nextTick();

    vi.advanceTimersByTime(6000);
    await nextTick();

    expect(wrapper.find('[data-testid="mobile-sync-strip"]').exists()).toBe(true);
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

    expect(wrapper.find('[data-testid="mobile-sync-strip"]').exists()).toBe(true);
  });

  it('toggles sync through the shared desktop control handler', async () => {
    const wrapper = await mountStrip();
    pullToReveal();
    await nextTick();

    await wrapper.get('[data-testid="sync-toggle"]').trigger('click');

    expect(syncCtl.syncNow).toHaveBeenCalledTimes(1);
  });

  it('runs the shared handler on a full pull-to-refresh', async () => {
    await mountStrip();

    pullToRefresh();
    await nextTick();

    expect(syncCtl.syncNow).toHaveBeenCalledTimes(1);
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

describe('MobileSyncStrip surfaces', () => {
  it.each([
    ['folder page', 'src/pages/folder/_id.vue'],
    ['note page', 'src/pages/note/_id.vue'],
  ])('mounts the shared strip on the %s', (_label, file) => {
    const src = readFileSync(file, 'utf8');

    expect(src).toContain(
      "import MobileSyncStrip from '@/components/app/MobileSyncStrip.vue'",
    );
    expect(src).toContain('MobileSyncStrip,');
    expect(src).toContain('<mobile-sync-strip v-if="isMobile" />');
    expect(src).toContain(
      "import { isMobileRuntime } from '@/lib/tauri/runtime'",
    );
    expect(src).toContain('const isMobile = isMobileRuntime();');
    expect(src).toContain('isMobile,');
  });
});
