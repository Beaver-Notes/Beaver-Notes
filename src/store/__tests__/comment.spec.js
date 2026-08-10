import { setActivePinia, createPinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useCommentStore } from '@/store/comment';

vi.mock('@/lib/api/comments', () => ({
  createComment: vi.fn(async () => ({ comment: { id: 'c1', contentEncrypted: 'x', contentIv: 'y', mentions: '[]' } })),
}));

describe('comment store pending flow', () => {
  beforeEach(() => setActivePinia(createPinia()));

  it('setPendingThread opens the sidebar and records anchors', () => {
    const s = useCommentStore();
    s.setPendingThread('t1', 10, 20);
    expect(s.showSidebar).toBe(true);
    expect(s.pendingThreadId).toBe('t1');
    expect(s.pendingAnchorFrom).toBe(10);
    expect(s.pendingAnchorTo).toBe(20);
  });

  it('addComment clears the pending anchors', async () => {
    const s = useCommentStore();
    s.setPendingThread('t1', 10, 20);
    await s.addComment('n1', { content: 'hi', threadId: 't1', anchorFrom: 10, anchorTo: 20 });
    expect(s.pendingThreadId).toBe(null);
    expect(s.pendingAnchorFrom).toBe(null);
    expect(s.pendingAnchorTo).toBe(null);
  });
});
