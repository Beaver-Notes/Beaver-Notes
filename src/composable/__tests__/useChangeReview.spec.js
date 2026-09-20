import { describe, expect, it, vi } from 'vitest';
import { useChangeReview } from '@/composable/useChangeReview.js';

function makeFakeEditor(editable = true) {
  return {
    isEditable: editable,
    setEditable(v) {
      this.isEditable = v;
    },
    commands: {
      setChangeReview: vi.fn(() => true),
      clearChangeReview: vi.fn(() => true),
    },
  };
}

describe('useChangeReview', () => {
  it('enters review read-only and restores the previous editable state', () => {
    const editor = makeFakeEditor(true);
    const review = useChangeReview();

    expect(review.start(editor, { content: '<p>hi</p>', label: 'x' })).toBe(true);
    expect(review.active.value).toBe(true);
    expect(editor.isEditable).toBe(false);
    expect(editor.commands.setChangeReview).toHaveBeenCalledWith(
      '<p>hi</p>',
      expect.objectContaining({ label: 'x' })
    );

    review.exit(editor);
    expect(review.active.value).toBe(false);
    expect(editor.isEditable).toBe(true);
    expect(editor.commands.clearChangeReview).toHaveBeenCalled();
  });

  it('restores a viewer (non-editable) editor to non-editable on exit', () => {
    const editor = makeFakeEditor(false);
    const review = useChangeReview();

    review.start(editor, { content: '<p>hi</p>' });
    review.exit(editor);

    expect(editor.isEditable).toBe(false);
  });

  it('does not activate without baseline content', () => {
    const editor = makeFakeEditor(true);
    const review = useChangeReview();

    expect(review.start(editor, { content: null })).toBe(false);
    expect(review.active.value).toBe(false);
    expect(editor.isEditable).toBe(true);
  });

  it('shows the merge banner only for remote changes on the open note', () => {
    const review = useChangeReview({ mergeBannerMs: 50 });

    expect(review.mergeBannerVisible.value).toBe(false);
    expect(review.handleRemoteApplied('note-1', 'note-1')).toBe(true);
    expect(review.mergeBannerVisible.value).toBe(true);

    review.dismissMergeBanner();
    expect(review.mergeBannerVisible.value).toBe(false);

    // remote changes for a different note do not show on this one
    expect(review.handleRemoteApplied('note-2', 'note-1')).toBe(false);
    expect(review.mergeBannerVisible.value).toBe(false);
  });

  it('does not show the merge banner while a review is already open', () => {
    const editor = makeFakeEditor(true);
    const review = useChangeReview();
    review.start(editor, { content: '<p>hi</p>' });

    expect(review.handleRemoteApplied('note-1', 'note-1')).toBe(false);
    expect(review.mergeBannerVisible.value).toBe(false);
  });

  it('starting a review dismisses a pending merge banner', () => {
    const editor = makeFakeEditor(true);
    const review = useChangeReview();
    review.handleRemoteApplied('note-1', 'note-1');
    expect(review.mergeBannerVisible.value).toBe(true);

    review.start(editor, { content: '<p>hi</p>' });
    expect(review.mergeBannerVisible.value).toBe(false);
  });
});
