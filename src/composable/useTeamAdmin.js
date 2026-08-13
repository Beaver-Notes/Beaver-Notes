import { ref } from 'vue';
import { useAccountStore } from '@/store/account';
import {
  getAdminMembers,
  getAdminDevices,
  getAdminAudit,
  revokeSession,
  memberLookup,
  changeMemberRole,
} from '@/lib/api/admin';
import { addMember as apiAddMember, removeMember as apiRemoveMember } from '@/lib/api/workspaces';

export function useTeamAdmin(workspaceId) {
  const accountStore = useAccountStore();

  function activeBaseUrl() {
    return accountStore.serverUrl;
  }

  const members = ref([]);
  const devices = ref([]);
  const auditLogs = ref([]);
  const loading = ref(false);
  const error = ref('');

  async function loadMembers() {
    loading.value = true;
    error.value = '';
    try {
      const res = await getAdminMembers(workspaceId, { baseUrl: activeBaseUrl() });
      members.value = res?.members ?? [];
    } catch (err) {
      error.value = err?.message || 'Failed to load members';
      throw err;
    } finally {
      loading.value = false;
    }
  }

  async function loadDevices() {
    loading.value = true;
    error.value = '';
    try {
      const res = await getAdminDevices(workspaceId, { baseUrl: activeBaseUrl() });
      devices.value = res?.devices ?? [];
    } catch (err) {
      error.value = err?.message || 'Failed to load devices';
      throw err;
    } finally {
      loading.value = false;
    }
  }

  async function loadAudit() {
    loading.value = true;
    error.value = '';
    try {
      const res = await getAdminAudit(workspaceId, { baseUrl: activeBaseUrl() });
      auditLogs.value = res?.logs ?? [];
    } catch (err) {
      error.value = err?.message || 'Failed to load audit logs';
      throw err;
    } finally {
      loading.value = false;
    }
  }

  async function addMemberByEmail(usernameOrEmail, role = 'editor') {
    const lookup = await memberLookup(workspaceId, { email: usernameOrEmail }, { baseUrl: activeBaseUrl() });
    if (!lookup?.found) {
      throw new Error('No Beaver account found with that email or username.');
    }
    if (lookup.alreadyMember) {
      throw new Error('That user is already a member of this workspace.');
    }
    return apiAddMember(workspaceId, usernameOrEmail, role, { baseUrl: activeBaseUrl() });
  }

  async function generateInviteLink(usernameOrEmail, role = 'editor') {
    return apiAddMember(workspaceId, usernameOrEmail, role, { baseUrl: activeBaseUrl() });
  }

  async function changeRole(userId, role) {
    await changeMemberRole(workspaceId, userId, role, { baseUrl: activeBaseUrl() });
    const m = members.value.find((x) => x.userId === userId);
    if (m) m.role = role;
  }

  async function removeMember(userId) {
    await apiRemoveMember(workspaceId, userId, { baseUrl: activeBaseUrl() });
    members.value = members.value.filter((x) => x.userId !== userId);
  }

  async function revoke(hash) {
    await revokeSession(hash, { baseUrl: activeBaseUrl() });
  }

  return {
    members,
    devices,
    auditLogs,
    loading,
    error,
    loadMembers,
    loadDevices,
    loadAudit,
    addMemberByEmail,
    generateInviteLink,
    changeRole,
    removeMember,
    revoke,
    revokeSession: revoke,
  };
}
