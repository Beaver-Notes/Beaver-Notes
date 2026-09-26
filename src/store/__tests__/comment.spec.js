import { setActivePinia, createPinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useCommentStore } from '@/store/comment';

vi.mock('@/lib/api/comments', () => ({
  listComments: vi.fn(async () => []),
  createComment: vi.fn(async () => ({ comment: { id: 'c1', contentEncrypted: 'x', contentIv: 'y', mentions: '[]' } })),
  resolveComment: vi.fn(async () => ({ resolved: true })),
}));

const ensureNoteKeyMock = vi.hoisted(() => vi.fn(async () => 'ab'.repeat(32)));

vi.mock('@/composable/useNoteSharing', () => ({
  useNoteSharing: () => ({
    ensureNoteKey: ensureNoteKeyMock,
  }),
}));

import { listComments, createComment, resolveComment } from '@/lib/api/comments';

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

  it('addComment carries anchors encrypted, not as readable columns', async () => {
    const { decryptComment } = await import('@/utils/crypto/comment-crypto');
    const { importCollabKey } = await import('@/utils/crypto/collab');
    const s = useCommentStore();
    await s.addComment('n1', { content: 'hi', threadId: 't1', anchorFrom: 4, anchorTo: 9 });
    const [, body] = createComment.mock.calls[0];
    expect(body.anchorFrom).toBeUndefined();
    expect(body.anchorTo).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain('anchorFrom');
    const key = await importCollabKey('ab'.repeat(32));
    const payload = JSON.parse(await decryptComment(key, body, 'n1'));
    expect(payload.text).toBe('hi');
    expect(payload.anchorFrom).toBe(4);
    expect(payload.anchorTo).toBe(9);
  });

  it('fetchThreads reads anchors from the encrypted payload', async () => {
    const { encryptComment, packComment } = await import('@/utils/crypto/comment-crypto');
    const { importCollabKey } = await import('@/utils/crypto/collab');
    const key = await importCollabKey('ab'.repeat(32));
    const { contentEncrypted, contentIv } = await encryptComment(
      key,
      packComment({ text: 'new scheme', anchorFrom: 11, anchorTo: 22 }),
      'n1'
    );
    listComments.mockResolvedValueOnce([
      { id: 'c1', noteId: 'n1', threadId: 't1', contentEncrypted, contentIv, anchorFrom: null, anchorTo: null, resolved: false },
    ]);
    const s = useCommentStore();
    await s.fetchThreads('n1');
    expect(s.comments[0].content).toBe('new scheme');
    expect(s.threads[0].anchorFrom).toBe(11);
    expect(s.threads[0].anchorTo).toBe(22);
  });

  it('fetchThreads falls back to row anchor columns for a legacy comment', async () => {
    const { encryptComment } = await import('@/utils/crypto/comment-crypto');
    const { importCollabKey } = await import('@/utils/crypto/collab');
    const key = await importCollabKey('ab'.repeat(32));
    const { contentEncrypted, contentIv } = await encryptComment(key, 'legacy body', 'n1');
    listComments.mockResolvedValueOnce([
      { id: 'c1', noteId: 'n1', threadId: 't1', contentEncrypted, contentIv, anchorFrom: 5, anchorTo: 9, resolved: false },
    ]);
    const s = useCommentStore();
    await s.fetchThreads('n1');
    expect(s.comments[0].content).toBe('legacy body');
    expect(s.threads[0].anchorFrom).toBe(5);
    expect(s.threads[0].anchorTo).toBe(9);
  });

  it('fetchThreads populates authorName from the collaborator store', async () => {
    const { useCollaboratorStore } = await import('@/store/collaborator');
    const collab = useCollaboratorStore();
    collab.setCollaborators('n1', [{ userId: 'u1', username: 'alice', email: 'alice@example.com' }]);
    listComments.mockResolvedValueOnce([
      { id: 'c1', noteId: 'n1', threadId: 't1', authorId: 'u1', contentEncrypted: 'x', contentIv: 'y', resolved: false },
    ]);
    const s = useCommentStore();
    await s.fetchThreads('n1');
    expect(s.comments[0].authorName).toBe('alice');
  });

  it('marks comments unavailable instead of a silent no-op when the note has no shared key', async () => {
    ensureNoteKeyMock.mockResolvedValueOnce(null);
    const s = useCommentStore();
    await s.fetchThreads('personal-note');
    expect(s.unavailable).toBe(true);
    expect(s.comments).toEqual([]);
    expect(listComments).not.toHaveBeenCalled();
  });

  it('clears the unavailable state once a shared key resolves', async () => {
    ensureNoteKeyMock.mockResolvedValueOnce(null);
    const s = useCommentStore();
    await s.fetchThreads('personal-note');
    expect(s.unavailable).toBe(true);

    await s.fetchThreads('personal-note');
    expect(s.unavailable).toBe(false);
    expect(listComments).toHaveBeenCalled();
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

  it('toggleResolve still flips the thread after the payload change', async () => {
    const { encryptComment, packComment } = await import('@/utils/crypto/comment-crypto');
    const { importCollabKey } = await import('@/utils/crypto/collab');
    const key = await importCollabKey('ab'.repeat(32));
    const { contentEncrypted, contentIv } = await encryptComment(
      key,
      packComment({ text: 'root', anchorFrom: 1, anchorTo: 2 }),
      'n1'
    );
    listComments.mockResolvedValueOnce([
      { id: 'c1', noteId: 'n1', threadId: 't1', contentEncrypted, contentIv, anchorFrom: null, anchorTo: null, resolved: 0 },
    ]);
    const s = useCommentStore();
    await s.fetchThreads('n1');
    expect(s.unresolvedThreads).toHaveLength(1);

    await s.toggleResolve('t1');

    expect(resolveComment).toHaveBeenCalledWith('c1', expect.anything());
    expect(s.resolvedThreads).toHaveLength(1);
    expect(s.unresolvedThreads).toHaveLength(0);
  });
});
