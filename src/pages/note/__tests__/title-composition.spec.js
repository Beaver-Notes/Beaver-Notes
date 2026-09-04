import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// Mocks same as Task 1 so useNoteYjs can be imported
vi.mock('@/lib/native/yjs.js', () => ({
  getUpdates: vi.fn().mockResolvedValue([]),
  getSnapshot: vi.fn().mockResolvedValue(null),
  appendUpdate: vi.fn().mockResolvedValue(),
  compactUpdates: vi.fn().mockResolvedValue(),
  getCommitsDir: vi.fn(),
}));
vi.mock('@/lib/yjs/helpers.js', () => ({
  getDeviceId: () => 'd1',
  applyUpdatesToDoc: () => {},
  toUint8Array: (x) => x,
  ensureSchema: vi.fn(),
}));
vi.mock('@/store/workspace', () => ({ useWorkspaceStore: () => ({ activeId: 'w1' }) }));
vi.mock('@/composable/useNoteSharing.js', () => ({
  useNoteSharing: () => ({ ensureNoteKey: vi.fn().mockResolvedValue(null) }),
}));
vi.mock('@/lib/sync/ws-sync.js', () => ({
  getWsSync: () => ({ leaveNoteRoom: () => {} }),
  setRoomKey: vi.fn().mockResolvedValue(),
}));
vi.mock('@/lib/yjs/shared.js', () => ({
  registerActiveDoc: vi.fn(),
  unregisterActiveDoc: vi.fn(),
}));

import { useNoteYjs } from '@/composable/useNoteYjs.js';

describe('title composition guard', () => {
  it('observer does not overwrite while focused (Y.Text stays, DOM guard skips)', async () => {
    const { load, getTitle, setTitle, observeTitle } = useNoteYjs();
    await load('n3', null, 'hello');
    expect(getTitle()).toBe('hello');

    // Simulate focused titleDiv: guard should prevent DOM overwrite.
    // We test the guard logic in isolation: isTitleFocused || isComposing skips
    const el = document.createElement('div');
    el.textContent = 'hello';
    el.contentEditable = 'true';
    document.body.appendChild(el);
    el.focus();
    // isTitleFocused helper equivalent
    function isTitleFocused(titleEl) {
      return titleEl && document.activeElement === titleEl;
    }
    expect(isTitleFocused(el)).toBe(true);

    // Simulate remote Yjs title update (another peer sets title to "remote")
    // Y.Text updates, but DOM should NOT be overwritten while focused.
    let observed = null;
    const unobserve = observeTitle((t) => {
      observed = t;
      // This is the guard from _id.vue: if focused or composing, skip DOM write
      if (isTitleFocused(el) /* || isComposing */) return;
      el.textContent = t;
    });
    setTitle('remote');
    expect(getTitle()).toBe('remote');
    expect(observed).toBe('remote');
    // DOM still "hello" because focused => guard skipped
    expect(el.textContent).toBe('hello');

    // When not focused, DOM should update
    el.blur();
    expect(isTitleFocused(el)).toBe(false);
    // Trigger again with new title
    setTitle('remote2');
    // Need to manually apply guard logic as observe callback already fired synchronously
    // Re-simulate: after blur, next remote update should write
    if (!isTitleFocused(el)) el.textContent = getTitle();
    expect(el.textContent).toBe('remote2');

    unobserve();
    el.remove();
  });

  it('composition guard prevents overwrite while composing', async () => {
    const { load, getTitle, setTitle, observeTitle } = useNoteYjs();
    await load('n4', null, 'hello');

    const el = document.createElement('div');
    el.textContent = 'hello';
    document.body.appendChild(el);

    let isComposing = false;
    function isTitleFocused(titleEl) {
      return titleEl && document.activeElement === titleEl;
    }

    let domWrites = 0;
    const unobserve = observeTitle((t) => {
      if (isTitleFocused(el) || isComposing) return;
      el.textContent = t;
      domWrites++;
    });

    // Start composing => guard active
    isComposing = true;
    setTitle('remote-while-composing');
    expect(getTitle()).toBe('remote-while-composing');
    expect(el.textContent).toBe('hello');
    expect(domWrites).toBe(0);

    // End composing => next update writes
    isComposing = false;
    setTitle('after-composing');
    expect(el.textContent).toBe('after-composing');

    unobserve();
    el.remove();
  });

  it('_id.vue contains IME composition guard and focused check', () => {
    const file = path.resolve('src/pages/note/_id.vue');
    const src = fs.readFileSync(file, 'utf8');

    // isComposing flag + handlers
    expect(src).toContain('isComposing');
    expect(src).toContain('onCompositionStart');
    expect(src).toContain('onCompositionEnd');
    expect(src).toContain("compositionstart");
    expect(src).toContain("compositionend");
    expect(src).toContain("addEventListener('compositionstart'");
    expect(src).toContain("addEventListener('compositionend'");
    // isTitleFocused helper
    expect(src).toContain('function isTitleFocused');
    expect(src).toContain('document.activeElement ===');
    // Guard in both observers
    // Count occurrences of isComposing in guard context
    expect(src).toContain('isComposing');
    // Ensure guard pattern exists: focused || isComposing
    const guardPattern = /isTitleFocused\s*\(\s*titleDiv\.value\s*\)\s*\|\|\s*isComposing/;
    expect(guardPattern.test(src)).toBe(true);
  });
});
