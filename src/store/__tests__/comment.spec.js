import { setActivePinia, createPinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useCommentStore } from '@/store/comment';

vi.mock('@/lib/api/comments', () => ({
  listComments: vi.fn(async () => []),
  createComment: vi.fn(async () => ({ comment: { id: 'c1', contentEncrypted: 'x', contentIv: 'y', mentions: '[]' } })),
}));

vi.mock('@/composable/useNoteSharing', () => ({
  useNoteSharing: () => ({
    ensureNoteKey: vi.fn(async () => 'ab'.repeat(32)),
  }),
}));

import { listComments, createComment } from '@/lib/api/comments';

describe('comment store pending flow', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

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

  it('addComment encrypts content and posts encrypted fields', async () => {
    const s = useCommentStore();
    await s.addComment('n1', { content: 'hello @alice', threadId: 't1' });
    const [, body] = createComment.mock.calls[0];
    expect(body.contentEncrypted).toBeTruthy();
    expect(body.contentIv).toBeTruthy();
    expect(body.content).toBeUndefined();
    expect(body.mentions).toEqual([]);
    expect(s.comments[0].content).toBe('hello @alice');
  });

  it('fetchThreads decrypts encrypted comment content', async () => {
    const { encryptComment } = await import('@/utils/crypto/comment-crypto');
    const { importCollabKey } = await import('@/utils/crypto/collab');
    const key = await importCollabKey('ab'.repeat(32));
    const { contentEncrypted, contentIv } = await encryptComment(key, 'secret note', 'n1');
    listComments.mockResolvedValueOnce([
      { id: 'c1', noteId: 'n1', threadId: 't1', contentEncrypted, contentIv, resolved: false },
    ]);
    const s = useCommentStore();
    await s.fetchThreads('n1');
    expect(s.comments[0].content).toBe('secret note');
  });
});
