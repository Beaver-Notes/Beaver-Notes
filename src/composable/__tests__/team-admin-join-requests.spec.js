import { describe, expect, it, vi, beforeEach } from 'vitest';

const api = vi.hoisted(() => ({
  getAdminMembers: vi.fn(),
  listWorkspaceRequests: vi.fn(),
  approveWorkspaceRequest: vi.fn(),
  denyWorkspaceRequest: vi.fn(),
  listNoteRequests: vi.fn(),
  approveNoteRequest: vi.fn(),
  denyNoteRequest: vi.fn(),
}));

vi.mock('@/lib/api/admin', () => ({
  getAdminMembers: (...a) => api.getAdminMembers(...a),
  getAdminDevices: vi.fn(),
  getAdminAudit: vi.fn(),
  revokeSession: vi.fn(),
  memberLookup: vi.fn(),
  changeMemberRole: vi.fn(),
}));
vi.mock('@/lib/api/workspaces', () => ({
  addMember: vi.fn(),
  removeMember: vi.fn(),
  listAllWorkspaceJoinRequests: (...a) => api.listWorkspaceRequests(...a),
  approveWorkspaceJoinRequest: (...a) => api.approveWorkspaceRequest(...a),
  denyWorkspaceJoinRequest: (...a) => api.denyWorkspaceRequest(...a),
}));
vi.mock('@/lib/api/collaboration', () => ({
  listAllNoteJoinRequests: (...a) => api.listNoteRequests(...a),
  approveNoteJoinRequest: (...a) => api.approveNoteRequest(...a),
  denyNoteJoinRequest: (...a) => api.denyNoteRequest(...a),
}));
vi.mock('@/store/account', () => ({
  useAccountStore: () => ({ serverUrl: 'https://api.test' }),
}));

import { useTeamAdmin } from '../useTeamAdmin.js';

describe('useTeamAdmin join request queue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.getAdminMembers.mockResolvedValue({ workspaceId: 'w1', members: [] });
    api.listWorkspaceRequests.mockResolvedValue([
      { id: 'wr1', workspaceId: 'w1', accountId: 'u2', username: 'bob', role: 'editor' },
    ]);
    api.listNoteRequests.mockResolvedValue([
      { id: 'nr1', noteId: 'n1', accountId: 'u3', username: 'cara', role: 'viewer' },
    ]);
  });

  it('loads workspace and note join requests together, tagged by type', async () => {
    const admin = useTeamAdmin('w1');
    await admin.loadJoinRequests();
    expect(api.listWorkspaceRequests).toHaveBeenCalledWith({ baseUrl: 'https://api.test' });
    expect(api.listNoteRequests).toHaveBeenCalledWith({ baseUrl: 'https://api.test' });
    expect(admin.joinRequests.value).toHaveLength(2);
    expect(admin.joinRequests.value.map((r) => r.type).sort()).toEqual(['note', 'workspace']);
  });

  it('approves a workspace request through the workspace endpoint and drops it from the queue', async () => {
    api.approveWorkspaceRequest.mockResolvedValue({ approved: true });
    const admin = useTeamAdmin('w1');
    await admin.loadJoinRequests();
    const request = admin.joinRequests.value.find((r) => r.type === 'workspace');
    await admin.approveJoinRequest(request);
    expect(api.approveWorkspaceRequest).toHaveBeenCalledWith('wr1', { baseUrl: 'https://api.test' });
    expect(admin.joinRequests.value.find((r) => r.id === 'wr1')).toBeUndefined();
    expect(api.getAdminMembers).toHaveBeenCalled();
  });

  it('approves a note request through the collaboration endpoint', async () => {
    api.approveNoteRequest.mockResolvedValue({ approved: true });
    const admin = useTeamAdmin('w1');
    await admin.loadJoinRequests();
    const request = admin.joinRequests.value.find((r) => r.type === 'note');
    await admin.approveJoinRequest(request);
    expect(api.approveNoteRequest).toHaveBeenCalledWith('nr1', { baseUrl: 'https://api.test' });
    expect(admin.joinRequests.value.find((r) => r.id === 'nr1')).toBeUndefined();
  });
});
