// tests/unit/store/passwd.spec.js
import { describe, it, expect } from 'vitest';
import { usePasswordStore } from '@/store/passwd';

describe('password store', () => {
  it('starts with an empty shared key', () => {
    const store = usePasswordStore();
    expect(store.sharedKey).toBe('');
  });

  it('imports a raw bcrypt hash into the shared key in memory', async () => {
    const store = usePasswordStore();
    const hash = '$2a$10$xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';
    await store.importSharedKey(hash);
    expect(store.sharedKey).toBe(hash);
  });
});
