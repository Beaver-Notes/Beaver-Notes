import { describe, it, expect } from 'vitest';
import { isTitleFocused } from '../titleGuard.js';

describe('title guard', () => {
  it('is true only while the title element is focused', () => {
    const div = document.createElement('div');
    div.setAttribute('contenteditable', 'true');
    document.body.appendChild(div);
    div.focus();
    expect(isTitleFocused(div)).toBe(true);
    div.blur();
    expect(isTitleFocused(div)).toBe(false);
    document.body.removeChild(div);
  });
});
