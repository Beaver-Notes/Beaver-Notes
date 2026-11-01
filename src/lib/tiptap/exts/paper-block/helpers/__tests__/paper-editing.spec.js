import { afterEach, describe, expect, it } from 'vitest';
import { isPaperEditing, setPaperEditing } from '../paperEditing.js';

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
