import { describe, expect, it, vi, beforeEach } from 'vitest';

const api = vi.hoisted(() => ({
  getAdminMembers: vi.fn(),
  getAdminDevices: vi.fn(),
  getAdminAudit: vi.fn(),
  revokeSession: vi.fn(),
  memberLookup: vi.fn(),
  changeMemberRole: vi.fn(),
}));
vi.mock('@/lib/api/admin', () => api);
vi.mock('@/lib/api/workspaces', () => ({
  addMember: vi.fn(),
  removeMember: vi.fn(),
}));
vi.mock('@/store/account', () => ({
  useAccountStore: () => ({ serverUrl: 'https://api.test' }),
}));

import { useTeamAdmin } from '../useTeamAdmin.js';

describe('useTeamAdmin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.getAdminMembers.mockResolvedValue({ workspaceId: 'w1', members: [{ userId: 'u1', role: 'editor' }] });
  });

  it('loadMembers populates reactive list', async () => {
    const admin = useTeamAdmin('w1');
    await admin.loadMembers();
    expect(api.getAdminMembers).toHaveBeenCalledWith('w1', { baseUrl: 'https://api.test' });
    expect(admin.members.value).toHaveLength(1);
  });

  it('changeRole delegates to API', async () => {
    api.changeMemberRole.mockResolvedValue({ updated: true });
    const admin = useTeamAdmin('w1');
    await admin.changeRole('u1', 'admin');
    expect(api.changeMemberRole).toHaveBeenCalledWith('w1', 'u1', 'admin', { baseUrl: 'https://api.test' });
  });

  it('revokeSession delegates to API', async () => {
    api.revokeSession.mockResolvedValue({ revoked: true });
    const admin = useTeamAdmin('w1');
    await admin.revokeSession('hash-1');
    expect(api.revokeSession).toHaveBeenCalledWith('hash-1', { baseUrl: 'https://api.test' });
  });
});
