import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  attachKeyboardGuard,
  isPaperEditing,
  selectMediaBlock,
  setPaperEditing,
} from '../paperEditing.js';

function pointer(target, type) {
  target.dispatchEvent(
    new PointerEvent('pointerdown', { pointerType: type, bubbles: true }),
  );
}

function focusableHost() {
  const el = document.createElement('div');
  el.tabIndex = -1;
  document.body.appendChild(el);
  el.focus();
  return el;
}

describe('paper editing state', () => {
  afterEach(() => {
    setPaperEditing('first', false);
    setPaperEditing('second', false);
  });

  it('stays active until every editing paper has exited', () => {
    setPaperEditing('first', true);
    setPaperEditing('second', true);
    setPaperEditing('first', false);

    expect(isPaperEditing.value).toBe(true);

    setPaperEditing('second', false);
    expect(isPaperEditing.value).toBe(false);
  });
});

describe('selectMediaBlock', () => {
  it('selects the node through editor commands', () => {
    const setNodeSelection = vi.fn();
    selectMediaBlock({ commands: { setNodeSelection } }, 7);
    expect(setNodeSelection).toHaveBeenCalledWith(7);
  });

  it('drops editor focus after a touch gesture so the keyboard stays down', async () => {
    const dom = focusableHost();
    pointer(dom, 'touch');
    selectMediaBlock({ view: { dom } }, 0);
    await Promise.resolve(); // flush the blur microtask
    expect(document.activeElement).not.toBe(dom);
    dom.remove();
  });

  it('keeps focus for mouse gestures', async () => {
    const dom = focusableHost();
    pointer(dom, 'mouse');
    selectMediaBlock({ view: { dom } }, 0);
    await Promise.resolve();
    expect(document.activeElement).toBe(dom);
    dom.remove();
  });
});

describe('attachKeyboardGuard', () => {
  it('blurs the editor when a touch/pen gesture inside the block steals focus', () => {
    const root = document.createElement('div');
    const inner = document.createElement('canvas');
    root.appendChild(inner);
    document.body.appendChild(root);
    const dom = focusableHost();
    const detach = attachKeyboardGuard(root, () => ({ view: { dom } }));

    pointer(inner, 'pen');
    document.dispatchEvent(new Event('focusin'));
    expect(document.activeElement).not.toBe(dom);

    detach();
    root.remove();
    dom.remove();
  });

  it('ignores mouse gestures and touches outside the block', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const outside = focusableHost();
    const dom = focusableHost();
    const detach = attachKeyboardGuard(root, () => ({ view: { dom } }));

    pointer(root, 'mouse');
    document.dispatchEvent(new Event('focusin'));
    expect(document.activeElement).toBe(dom);

    pointer(outside, 'touch');
    document.dispatchEvent(new Event('focusin'));
    expect(document.activeElement).toBe(dom);

    detach();
    root.remove();
    outside.remove();
    dom.remove();
  });
});
