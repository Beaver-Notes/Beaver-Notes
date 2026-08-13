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

  // Accept a static id or a getter so callers can recompute when the active
  // workspace changes instead of capturing a stale id at setup time.
  function resolveWorkspaceId() {
    return typeof workspaceId === 'function' ? workspaceId() : workspaceId;
  }

  const members = ref([]);
  const devices = ref([]);
  const sessions = ref([]);
  const auditLogs = ref([]);
  const loading = ref(false);
  const error = ref('');

  async function loadMembers() {
    const id = resolveWorkspaceId();
    if (!id) return;
    loading.value = true;
    error.value = '';
    try {
      const res = await getAdminMembers(id, { baseUrl: activeBaseUrl() });
      members.value = res?.members ?? [];
    } catch (err) {
      error.value = err?.message || 'Failed to load members';
      throw err;
    } finally {
      loading.value = false;
    }
  }

  async function loadDevices() {
    const id = resolveWorkspaceId();
    if (!id) return;
    loading.value = true;
    error.value = '';
    try {
      const res = await getAdminDevices(id, { baseUrl: activeBaseUrl() });
      devices.value = res?.devices ?? [];
      sessions.value = res?.sessions ?? [];
    } catch (err) {
      error.value = err?.message || 'Failed to load devices';
      throw err;
    } finally {
      loading.value = false;
    }
  }

  async function loadAudit() {
    const id = resolveWorkspaceId();
    if (!id) return;
    loading.value = true;
    error.value = '';
    try {
      const res = await getAdminAudit(id, { baseUrl: activeBaseUrl() });
      auditLogs.value = res?.logs ?? [];
    } catch (err) {
      error.value = err?.message || 'Failed to load audit logs';
      throw err;
    } finally {
      loading.value = false;
    }
  }

  async function addMemberByEmail(usernameOrEmail, role = 'editor') {
    const identifier = (usernameOrEmail ?? '').trim();
    if (!identifier) {
      throw new Error('Enter an email or username.');
    }
    const isEmail = /\S+@\S+\.\S+/.test(identifier);
    const query = isEmail
      ? { email: identifier.toLowerCase() }
      : { username: identifier.toLowerCase() };
    const lookup = await memberLookup(resolveWorkspaceId(), query, { baseUrl: activeBaseUrl() });
    if (!lookup?.found) {
      throw new Error('No Beaver account found with that email or username.');
    }
    if (lookup.alreadyMember) {
      throw new Error('That user is already a member of this workspace.');
    }

    // The add-member endpoint provisions a token invite the invitee accepts via
    // `beaver-notes://join/<token>` (see the backend invite/join flow). The
    // workspace key envelope for the new member is NOT wrapped client-side here:
    // `POST /workspaces/:id/members` accepts no wrapped key/recipients and
    // `member-lookup` returns only `hasKemPublicKey`, not the target's public
    // key, so the workspace key cannot be re-wrapped for the invitee. Wrapping
    // for the target is deferred to the backend invite/join key handoff.
    return apiAddMember(resolveWorkspaceId(), identifier, role, { baseUrl: activeBaseUrl() });
  }

  async function generateInviteLink(usernameOrEmail, role = 'editor') {
    const identifier = (usernameOrEmail ?? '').trim();
    if (!identifier) {
      throw new Error('Enter an email or username.');
    }
    const res = await apiAddMember(resolveWorkspaceId(), identifier, role, {
      baseUrl: activeBaseUrl(),
    });
    // The invite deep link uses the app's registered custom scheme; the backend
    // builds the same link with `INVITE_URL_SCHEME ?? 'beaver-notes://'`.
    return {
      inviteUrl: res?.token ? `beaver-notes://join/${res.token}` : null,
      ...res,
    };
  }

  async function changeRole(userId, role) {
    error.value = '';
    try {
      await changeMemberRole(resolveWorkspaceId(), userId, role, { baseUrl: activeBaseUrl() });
      const m = members.value.find((x) => x.userId === userId);
      if (m) m.role = role;
    } catch (err) {
      error.value = err?.message || 'Failed to change role';
      throw err;
    }
  }

  async function removeMember(userId) {
    error.value = '';
    try {
      await apiRemoveMember(resolveWorkspaceId(), userId, { baseUrl: activeBaseUrl() });
      members.value = members.value.filter((x) => x.userId !== userId);
    } catch (err) {
      error.value = err?.message || 'Failed to remove member';
      throw err;
    }
  }

  async function revoke(hash) {
    error.value = '';
    try {
      await revokeSession(hash, { baseUrl: activeBaseUrl() });
      sessions.value = sessions.value.filter((s) => s.idHash !== hash);
    } catch (err) {
      error.value = err?.message || 'Failed to revoke session';
      throw err;
    }
  }

  return {
    members,
    devices,
    sessions,
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
