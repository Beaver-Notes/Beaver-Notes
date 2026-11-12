import { describe, expect, it, vi, beforeEach } from 'vitest';

const api = vi.hoisted(() => ({
  getAdminMembers: vi.fn(),
  getAdminDevices: vi.fn(),
  getAdminAudit: vi.fn(),
  revokeSession: vi.fn(),
  memberLookup: vi.fn(),
  changeMemberRole: vi.fn(),
  addMember: vi.fn(),
  removeMember: vi.fn(),
}));
vi.mock('@/lib/api/admin', () => ({
  getAdminMembers: (...args) => api.getAdminMembers(...args),
  getAdminDevices: (...args) => api.getAdminDevices(...args),
  getAdminAudit: (...args) => api.getAdminAudit(...args),
  revokeSession: (...args) => api.revokeSession(...args),
  memberLookup: (...args) => api.memberLookup(...args),
  changeMemberRole: (...args) => api.changeMemberRole(...args),
}));
vi.mock('@/lib/api/workspaces', () => ({
  addMember: (...args) => api.addMember(...args),
  removeMember: (...args) => api.removeMember(...args),
}));
vi.mock('@/store/account', () => ({
  useAccountStore: () => ({ serverUrl: 'https://api.test' }),
}));

import { useTeamAdmin } from '../useTeamAdmin.js';

describe('useTeamAdmin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.getAdminMembers.mockResolvedValue({ workspaceId: 'w1', members: [{ userId: 'u1', role: 'editor' }] });
    api.memberLookup.mockResolvedValue({ found: true, accountId: 'u2', hasKemPublicKey: true, alreadyMember: false });
    api.addMember.mockResolvedValue({ workspaceId: 'w1', token: 'tok' });
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

  it('addMemberByEmail looks up an email as email and delegates add', async () => {
    api.memberLookup.mockResolvedValue({ found: true, accountId: 'u2', hasKemPublicKey: true, alreadyMember: false });
    const admin = useTeamAdmin('w1');
    await admin.addMemberByEmail('alice@example.com', 'editor');
    expect(api.memberLookup).toHaveBeenCalledWith('w1', { email: 'alice@example.com' }, { baseUrl: 'https://api.test' });
    expect(api.addMember).toHaveBeenCalledWith('w1', 'alice@example.com', 'editor', { baseUrl: 'https://api.test' });
  });

  it('addMemberByEmail looks up a username as username', async () => {
    const admin = useTeamAdmin('w1');
    await admin.addMemberByEmail('alice', 'viewer');
    expect(api.memberLookup).toHaveBeenCalledWith('w1', { username: 'alice' }, { baseUrl: 'https://api.test' });
    expect(api.addMember).toHaveBeenCalledWith('w1', 'alice', 'viewer', { baseUrl: 'https://api.test' });
  });

  it('addMemberByEmail rejects an unknown user', async () => {
    api.memberLookup.mockResolvedValue({ found: false });
    const admin = useTeamAdmin('w1');
    await expect(admin.addMemberByEmail('ghost@example.com')).rejects.toThrow('No Beaver account found');
    expect(api.addMember).not.toHaveBeenCalled();
  });

  it('addMemberByEmail rejects an existing member', async () => {
    api.memberLookup.mockResolvedValue({ found: true, accountId: 'u2', hasKemPublicKey: true, alreadyMember: true });
    const admin = useTeamAdmin('w1');
    await expect(admin.addMemberByEmail('alice@example.com')).rejects.toThrow('already a member');
    expect(api.addMember).not.toHaveBeenCalled();
  });
});
