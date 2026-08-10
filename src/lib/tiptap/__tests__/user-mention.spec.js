import { describe, expect, it } from 'vitest';
import UserMention from '@/lib/tiptap/exts/user-mention';

describe('user-mention extension', () => {
  it('sets labelKey so dropdown renders item.label', () => {
    const suggestion = UserMention.options.suggestion;
    expect(suggestion.labelKey ?? suggestion.props?.labelKey).toBe('label');
  });
});
