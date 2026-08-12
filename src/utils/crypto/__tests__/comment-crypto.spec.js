import { describe, expect, it } from 'vitest';

describe('comment encryption', () => {
  it('encrypts and decrypts comment content with a note key', async () => {
    const { encryptComment, decryptComment } = await import('@/utils/crypto/comment-crypto');
    const { importCollabKey } = await import('@/utils/crypto/collab');
    const key = await importCollabKey('ab'.repeat(32));
    const { contentEncrypted, contentIv } = await encryptComment(key, 'hello @alice', 'note-1');
    expect(contentEncrypted).toBeTruthy();
    expect(contentIv).toBeTruthy();
    const plaintext = await decryptComment(key, { contentEncrypted, contentIv }, 'note-1');
    expect(plaintext).toBe('hello @alice');
  });
});

describe('workspace/org name encryption', () => {
  it('encrypts and decrypts a name with a workspace key', async () => {
    const { encryptName, decryptName } = await import('@/utils/crypto/comment-crypto');
    const { importCollabKey } = await import('@/utils/crypto/collab');
    const key = await importCollabKey('cd'.repeat(32));
    const nameEncrypted = await encryptName(key, 'Design Team');
    expect(nameEncrypted).toBeTruthy();
    expect(await decryptName(key, nameEncrypted)).toBe('Design Team');
  });
});
