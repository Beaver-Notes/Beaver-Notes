import { onMounted, ref } from 'vue';
import { useAccountStore } from '@/store/account';
import { PLAN_NAMES } from '@/lib/api/types';
import { setSetting } from '@/lib/settings';
import { useAccountAuth } from '@/composable/useAccountAuth';
import { updateUsername as apiUpdateUsername, getAccountExport } from '@/lib/api/account';
import { logger } from '@/utils/logger';
import { localNoteCount } from '@/utils/notes/local-note-count.js';

export function useSettingsAccount({ dialog, translations }) {
  const accountStore = useAccountStore();
  const auth = useAccountAuth();

  const signInEmail = ref('');
  const signInPassword = ref('');
  const signUpUsername = ref('');
  const passkeyEmail = ref('');
  const quickConnectCode = ref('');
  const quickConnectSecret = ref('');
  const quickConnectExpiresAt = ref(null);
  const showPasswordAuth = ref(false);
  const showQuickConnect = ref(false);
  const showServerUrlEditor = ref(false);
  const draftServerUrl = ref(accountStore.serverUrl);
  const deletingAccount = ref(false);
  const deletePassword = ref('');
  const editingUsername = ref(false);
  const draftUsername = ref('');
  const sessions = ref([]);
  const loadingSessions = ref(false);

  const defaultServerUrl = 'https://api.beavernotes.com';

  function activeBaseUrl() {
    return accountStore.serverUrl;
  }

  function clearError() {
    accountStore.setError('');
  }

  function tpl(raw, params) {
    return Object.entries(params).reduce(
      (s, [k, v]) => s.replace(`{${k}}`, String(v)),
      raw,
    );
  }

  async function saveServerUrl() {
    const next = (draftServerUrl.value || '').trim() || defaultServerUrl;
    if (!accountStore.setServerUrl(next)) {
      accountStore.setError('Server URL must start with http:// or https://.');
      return;
    }
    await setSetting('beaverAccountServerUrl', accountStore.serverUrl);
    showServerUrlEditor.value = false;
  }

  function resetServerUrl() {
    draftServerUrl.value = defaultServerUrl;
  }

  async function handleSignInWithPassword() {
    clearError();
    if (!signInEmail.value?.trim() || !signInPassword.value) {
      accountStore.setError(
        translations.value.account?.emailPasswordRequired ||
          'Email and password are required.'
      );
      return;
    }
    try {
      await auth.signInWithPassword(
        signInEmail.value.trim(),
        signInPassword.value
      );
      signInPassword.value = '';
      if (accountStore.isAuthenticated) {
        if (await detectAndPromptVaultJoin()) {
          auth.triggerSeed().catch((e) =>
            logger.warn('[settings] account seed failed:', e)
          );
        }
      }
    } catch {
      // error already on the store
    }
  }

  async function handleSignUpWithPassword() {
    clearError();
    if (!signInEmail.value?.trim() || !signInPassword.value) {
      accountStore.setError(
        translations.value.account?.emailPasswordRequired ||
          'Email and password are required.'
      );
      return;
    }
    try {
      await auth.signUpWithPassword(
        signInEmail.value.trim(),
        signInPassword.value,
        signUpUsername.value?.trim() || undefined
      );
      signInPassword.value = '';
      signUpUsername.value = '';
      if (accountStore.isAuthenticated) {
        if (await detectAndPromptVaultJoin()) {
          auth.triggerSeed().catch((e) =>
            logger.warn('[settings] account seed failed:', e)
          );
        }
      }
    } catch {
      // error already on the store
    }
  }

  async function handleSignInWithPasskey() {
    clearError();
    try {
      await auth.signInWithPasskey(passkeyEmail.value?.trim() || null);
      if (accountStore.isAuthenticated) {
        if (await detectAndPromptVaultJoin()) {
          auth.triggerSeed().catch((e) =>
            logger.warn('[settings] account seed failed:', e)
          );
        }
      }
    } catch {
      // error already on the store
    }
  }

  async function handleSignUpWithPasskey() {
    clearError();
    try {
      await auth.signUpWithPasskey(passkeyEmail.value?.trim() || null);
      if (accountStore.isAuthenticated) {
        if (await detectAndPromptVaultJoin()) {
          auth.triggerSeed().catch((e) =>
            logger.warn('[settings] account seed failed:', e)
          );
        }
      }
    } catch {
      // error already on the store
    }
  }

  async function detectAndPromptVaultJoin() {
    try {
      const { fetchCloudKeyParams, getFetchedCloudKeyParams } = await import('@/utils/sync/vault-key-params.js');
      const { hasRemoteVaultKeyParams, adoptVaultKey } = await import('@/utils/crypto/encryption.js');

      // Remote vault differs or no local manifest: never skip, wrong local key still re-imports.
      await fetchCloudKeyParams({ force: true }).catch((e) =>
        logger.warn('[settings] cloud key-params fetch failed:', e)
      );
      let hasVault;
      try {
        hasVault = await hasRemoteVaultKeyParams();
      } catch (e) {
        logger.warn('[settings] cloud vault detection failed:', e);
        return false;
      }

      if (hasVault) {
        dialog.confirm({
          title: translations.value.account?.vaultDetected || 'Vault detected',
          body: `A vault was found in your sync source. Importing merges this device's notes into it: ${localNoteCount()} local note(s) are re-encrypted with the vault key and kept. A backup is saved first.`,
          icon: 'riShieldKeyholeLine',
          okText: translations.value.account?.importVault || 'Import',
          cancelText: translations.value.dialog?.cancel || 'Cancel',
          onConfirm: () => {
            dialog.prompt({
              title: translations.value.account?.vaultKeyTitle || 'Enter vault key',
              body: translations.value.account?.vaultKeyBody || 'Enter the vault key for the existing encrypted vault in your sync source.',
              icon: 'riLockLine',
              okText: translations.value.account?.importVault || 'Import',
              cancelText: translations.value.dialog?.cancel || 'Cancel',
              placeholder: translations.value.settings?.vaultKeyPlaceholder || 'Vault key',
              password: true,
              onConfirm: async (pass) => {
                if (!pass) {
                  dialog.alert({
                    title: translations.value.settings?.alertTitle || 'Alert',
                    body: translations.value.settings?.invalidPassword || 'Enter the vault key.',
                    okText: translations.value.dialog?.close || 'Close',
                  });
                  return;
                }
                try {
                  const fetched = getFetchedCloudKeyParams();
                  const res = await adoptVaultKey(pass, fetched?.paramsBlob);
                  if (!res.ok) {
                    dialog.alert({
                      title: translations.value.settings?.alertTitle || 'Alert',
                      body: res.error || 'Failed to import the vault. Check the password.',
                      okText: translations.value.dialog?.close || 'Close',
                    });
                    return;
                  }
                  dialog.alert({
                    title: translations.value.account?.vaultImported || 'Vault imported',
                    body: translations.value.account?.vaultImportedBody || 'The vault has been imported. The app will reload.',
                    okText: translations.value.dialog?.close || 'Close',
                    onConfirm: () => window.location.reload(),
                  });
                } catch (e) {
                  dialog.alert({
                    title: translations.value.settings?.alertTitle || 'Alert',
                    body: e?.message || 'Failed to import the vault.',
                    okText: translations.value.dialog?.close || 'Close',
                  });
                }
              },
            });
          },
        });
      }
    } catch (e) {
      logger.warn('[auth] vault detection failed:', e);
      return false;
    }
    return true;
  }

  async function startQuickConnect() {
    clearError();
    try {
      const result = await auth.startQuickConnect();
      if (result) {
        quickConnectSecret.value = result.secret || '';
        quickConnectExpiresAt.value = result.expiresAt || null;
      }
    } catch {
      // error already on the store
    }
  }

  async function pollQuickConnect() {
    if (!quickConnectSecret.value) return;
    try {
      await auth.pollQuickConnect(quickConnectSecret.value);
      if (accountStore.isAuthenticated) {
        quickConnectSecret.value = '';
        quickConnectExpiresAt.value = null;
      }
    } catch {
      // error already on the store
    }
  }

  async function authorizeQuickConnect() {
    clearError();
    if (!quickConnectCode.value?.trim()) {
      accountStore.setError(
        translations.value.account?.quickConnectCodeRequired ||
          'Enter the code shown on the other device.'
      );
      return;
    }
    try {
      await auth.authorizeQuickConnect(quickConnectCode.value.trim(), null);
    } catch {
      // error already on the store
    }
  }

  async function handleSignOut() {
    clearError();
    // Team accounts: local-data isolation is an owner-controlled default, so
    // the per-user confirmation is skipped and sign-out proceeds directly.
    const isTeamAccount =
      accountStore.plan === PLAN_NAMES.TEAM ||
      accountStore.plan === PLAN_NAMES.ENTERPRISE;
    if (isTeamAccount) {
      try {
        await auth.signOut();
      } catch {
        // error already on the store
      }
      return;
    }

    const localNotes = localNoteCount();
    const body =
      localNotes > 0
        ? translations.value.account?.signOutClearBody ||
          `Signing out clears this device's local copy of ${localNotes} note(s) from this account. Sign back in to sync them again.`
        : translations.value.account?.signOutBody ||
          'You can sign back in at any time. Local notes stay on this device.';

    dialog.confirm({
      title: translations.value.account?.signOutTitle || 'Sign out?',
      body,
      okText: translations.value.account?.signOut || 'Sign out',
      cancelText: translations.value.dialog?.cancel || 'Cancel',
      okVariant: 'danger',
      icon: 'riLogoutBoxRLine',
      onConfirm: async () => {
        try {
          await auth.signOut();
        } catch {
          return false;
        }
        return true;
      },
    });
  }

  async function handleSignOutEverywhere() {
    clearError();
    dialog.confirm({
      title:
        translations.value.account?.signOutEverywhereTitle ||
        'Sign out everywhere?',
      body:
        translations.value.account?.signOutEverywhereBody ||
        'Revoke all other devices. This device stays signed in.',
      okText:
        translations.value.account?.signOutEverywhere || 'Sign out everywhere',
      cancelText: translations.value.dialog?.cancel || 'Cancel',
      okVariant: 'danger',
      icon: 'riShieldKeyholeLine',
      onConfirm: async () => {
        try {
          await auth.signOutEverywhere();
        } catch {
          return false;
        }
        return true;
      },
    });
  }

  function handleRevokeDevice(device) {
    clearError();
    const label = device?.label || device?.deviceId || 'this device';
    dialog.confirm({
      title: tpl(
        translations.value.account?.revokeDeviceTitle || 'Revoke {device}?',
        { device: label },
      ),
      body:
        translations.value.account?.revokeDeviceBody ||
        'The device is signed out and must sign in again. Notes stored locally on it are not deleted.',
      icon: 'riComputerLine',
      okText: translations.value.account?.revokeDevice || 'Revoke',
      cancelText: translations.value.dialog?.cancel || 'Cancel',
      okVariant: 'danger',
      onConfirm: async () => {
        try {
          await auth.revokeDevice(device.deviceId);
        } catch {
          // error already on the store
        }
      },
    });
  }

  function openDeleteAccount() {
    clearError();
    deletePassword.value = '';
    deletingAccount.value = true;
  }

  function cancelDeleteAccount() {
    deletingAccount.value = false;
    deletePassword.value = '';
  }

  async function confirmDeleteAccount() {
    clearError();
    if (!deletePassword.value) {
      accountStore.setError(
        translations.value.account?.deletePasswordRequired ||
          'Enter your password to confirm.'
      );
      return;
    }
    try {
      await auth.deleteAccount(deletePassword.value);
      deletingAccount.value = false;
      deletePassword.value = '';
    } catch {
      // error already on the store
    }
  }

  function startEditUsername() {
    draftUsername.value = accountStore.profile?.username || '';
    editingUsername.value = true;
  }

  function cancelEditUsername() {
    editingUsername.value = false;
    draftUsername.value = '';
  }

  async function saveUsername() {
    const name = draftUsername.value.trim();
    if (!name) return;
    clearError();
    try {
      await apiUpdateUsername(name, { baseUrl: activeBaseUrl() });
      accountStore.setProfile({ ...accountStore.profile, username: name });
      editingUsername.value = false;
    } catch (err) {
      accountStore.setError(err?.message || 'Failed to update username');
    }
  }

  async function loadSessions() {
    loadingSessions.value = true;
    try {
      sessions.value = await auth.listActiveSessions();
    } catch {
      sessions.value = [];
    } finally {
      loadingSessions.value = false;
    }
  }

  function revokeSession(session) {
    const label =
      session?.deviceInfo?.label ||
      session?.userAgent ||
      translations.value.account?.unknownSession ||
      'Unknown session';
    dialog.confirm({
      title: tpl(
        translations.value.account?.revokeSessionTitle || 'Revoke {device}?',
        { device: label },
      ),
      body:
        translations.value.account?.revokeSessionBody ||
        'The session is signed out. Signing in again on that device creates a new session.',
      icon: 'riShieldKeyholeLine',
      okText: translations.value.account?.revokeSession || 'Revoke',
      cancelText: translations.value.dialog?.cancel || 'Cancel',
      okVariant: 'danger',
      onConfirm: async () => {
        try {
          await auth.revokeActiveSession(session.id);
          await loadSessions();
        } catch {
          // error already on the store
        }
      },
    });
  }

  async function exportAccountData() {
    clearError();
    try {
      const data = await getAccountExport({ baseUrl: activeBaseUrl() });
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `beaver-account-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      accountStore.setError(err?.message || 'Failed to export account data');
    }
  }

  onMounted(() => {
    // Hydration runs in the auth composable's own onMounted; refresh the
    // profile when the settings page opens.
    if (accountStore.isAuthenticated) {
      auth.refreshProfile().catch(() => {});
    }
  });

  return {
    accountStore,
    signInEmail,
    signInPassword,
    signUpUsername,
    passkeyEmail,
    quickConnectCode,
    quickConnectSecret,
    quickConnectExpiresAt,
    showPasswordAuth,
    showQuickConnect,
    showServerUrlEditor,
    draftServerUrl,
    defaultServerUrl,
    deletingAccount,
    deletePassword,
    saveServerUrl,
    resetServerUrl,
    handleSignInWithPassword,
    handleSignUpWithPassword,
    handleSignInWithPasskey,
    handleSignUpWithPasskey,
    startQuickConnect,
    pollQuickConnect,
    authorizeQuickConnect,
    handleSignOut,
    handleSignOutEverywhere,
    handleRevokeDevice,
    openDeleteAccount,
    cancelDeleteAccount,
    confirmDeleteAccount,
    clearError,
    triggerSeed: auth.triggerSeed,
    editingUsername,
    draftUsername,
    startEditUsername,
    cancelEditUsername,
    saveUsername,
    sessions,
    loadingSessions,
    loadSessions,
    revokeSession,
    exportAccountData,
  };
}
