import { beforeEach, describe, expect, it, vi } from 'vitest';

const invoke = vi.hoisted(() => vi.fn());

vi.mock('@tauri-apps/api/core', () => ({ invoke }));
vi.mock('@/lib/tauri/runtime', () => ({ isIOSRuntime: () => true }));

import { collectScribbleTargets, updateScribbleTargets } from '../scribble.js';

describe('collectScribbleTargets', () => {
  beforeEach(() => invoke.mockReset());

  it('returns visible editable controls and contenteditable regions only', () => {
    document.body.innerHTML = `
      <input id="input">
      <textarea id="textarea"></textarea>
      <div id="editable" contenteditable="true"></div>
      <div id="inherited" contenteditable="true"><span id="child">text</span></div>
      <div id="explicitly-static" contenteditable="false"></div>
      <input id="readonly" readonly>
      <input id="disabled" disabled>
      <div id="static">text</div>
    `;
    for (const element of document.querySelectorAll('input, textarea, [contenteditable]')) {
      element.getBoundingClientRect = () => ({
        left: 10, top: 20, right: 110, bottom: 50, width: 100, height: 30,
      });
    }

    expect(collectScribbleTargets(document)).toEqual([
      { left: 10, top: 20, width: 100, height: 30 },
      { left: 10, top: 20, width: 100, height: 30 },
      { left: 10, top: 20, width: 100, height: 30 },
      { left: 10, top: 20, width: 100, height: 30 },
    ]);
  });

  it('ignores editable targets with invalid or offscreen geometry', () => {
    document.body.innerHTML = `
      <input id="visible">
      <textarea id="hidden"></textarea>
      <div id="zero" contenteditable="true"></div>
    `;
    document.querySelector('#visible').getBoundingClientRect = () => ({
      left: 0, top: 0, right: 20, bottom: 10, width: 20, height: 10,
    });
    document.querySelector('#hidden').getBoundingClientRect = () => ({
      left: 0, top: 0, right: 0, bottom: 10, width: 0, height: 10,
    });
    document.querySelector('#zero').getBoundingClientRect = () => ({
      left: 0, top: 0, right: 20, bottom: 0, width: 20, height: 0,
    });

    expect(collectScribbleTargets(document)).toEqual([
      { left: 0, top: 0, width: 20, height: 10 },
    ]);
  });

  it('clips target rectangles to the visible viewport', () => {
    document.body.innerHTML = '<textarea id="partial"></textarea>';
    document.querySelector('#partial').getBoundingClientRect = () => ({
      left: -10, top: 5, right: 30, bottom: 25, width: 40, height: 20,
    });
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 100 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 100 });

    expect(collectScribbleTargets(document)).toEqual([
      { left: 0, top: 5, width: 30, height: 20 },
    ]);
  });

  it('excludes embedded paper drawing blocks from a contenteditable target', () => {
    document.body.innerHTML = `
      <div id="editor" contenteditable="true">
        <p>Editable note text</p>
        <div class="paper-node" contenteditable="false"></div>
      </div>
    `;
    document.querySelector('#editor').getBoundingClientRect = () => ({
      left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100,
    });
    document.querySelector('.paper-node').getBoundingClientRect = () => ({
      left: 20, top: 20, right: 80, bottom: 80, width: 60, height: 60,
    });

    expect(collectScribbleTargets(document)).toEqual([
      { left: 0, top: 0, width: 100, height: 20 },
      { left: 0, top: 80, width: 100, height: 20 },
      { left: 0, top: 20, width: 20, height: 60 },
      { left: 80, top: 20, width: 20, height: 60 },
    ]);
  });

  it('keeps Scribble disabled when native target registration fails', async () => {
    document.body.innerHTML = '<input id="editable">';
    document.querySelector('#editable').getBoundingClientRect = () => ({
      left: 0, top: 0, right: 20, bottom: 10,
    });
    invoke.mockRejectedValueOnce(new Error('native target update failed'));

    updateScribbleTargets();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(invoke.mock.calls).toContainEqual([
      'plugin:safe-area-insets-css|set_scribble_enabled',
      { enabled: false },
    ]);
  });
});
