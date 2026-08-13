import { describe, expect, it, vi, beforeEach } from 'vitest';

const clientMock = {
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  delete: vi.fn(),
};
vi.mock('../client', () => ({
  getApiClient: () => clientMock,
}));

import { getAdminMembers, memberLookup, changeMemberRole } from '../admin.js';
import { addMember } from '../workspaces.js';

describe('admin API wrappers', () => {
  beforeEach(() => vi.clearAllMocks());

  it('getAdminMembers hits /admin/workspaces/:id/members', async () => {
    clientMock.get.mockResolvedValue({ workspaceId: 'w1', members: [] });
    const res = await getAdminMembers('w1', { baseUrl: 'https://api.test' });
    expect(clientMock.get).toHaveBeenCalledWith('/admin/workspaces/w1/members', { baseUrl: 'https://api.test' });
    expect(res.workspaceId).toBe('w1');
  });

  it('memberLookup sends email or username query', async () => {
    clientMock.get.mockResolvedValue({ found: true, accountId: 'u1', hasKemPublicKey: true });
    await memberLookup('w1', { email: 'a@b.c' }, { baseUrl: 'https://api.test' });
    expect(clientMock.get).toHaveBeenCalledWith('/workspaces/w1/member-lookup', {
      baseUrl: 'https://api.test',
      query: { email: 'a@b.c' },
    });
  });

  it('changeMemberRole PATCHes the member', async () => {
    clientMock.patch.mockResolvedValue({ updated: true });
    await changeMemberRole('w1', 'u1', 'admin', { baseUrl: 'https://api.test' });
    expect(clientMock.patch).toHaveBeenCalledWith('/workspaces/w1/members/u1', { role: 'admin' }, {
      baseUrl: 'https://api.test',
    });
  });

  it('addMember sends username or email, not identifier', async () => {
    clientMock.post.mockResolvedValue({});
    await addMember('w1', 'alice@example.com', 'editor', { baseUrl: 'https://api.test' });
    expect(clientMock.post).toHaveBeenCalledWith('/workspaces/w1/members', { email: 'alice@example.com', role: 'editor' }, { baseUrl: 'https://api.test' });
  });
});
