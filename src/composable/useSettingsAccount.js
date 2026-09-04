import { onMounted, ref } from 'vue';
import { useAccountStore } from '@/store/account';
import { setSetting } from '@/lib/settings';
import { useAccountAuth } from '@/composable/useAccountAuth';
import { updateUsername as apiUpdateUsername, getAccountExport } from '@/lib/api/account';

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
        await detectAndPromptVaultJoin();
        auth.triggerSeed().catch(() => {});
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
        await detectAndPromptVaultJoin();
        auth.triggerSeed().catch(() => {});
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
        await detectAndPromptVaultJoin();
        auth.triggerSeed().catch(() => {});
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
        await detectAndPromptVaultJoin();
        auth.triggerSeed().catch(() => {});
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
      await fetchCloudKeyParams({ force: true }).catch(() => null);
      const hasVault = await hasRemoteVaultKeyParams().catch(() => false);

      if (hasVault) {
        dialog.confirm({
          title: translations.value.account?.vaultDetected || 'Vault detected',
          body: translations.value.account?.vaultDetectedBody || 'A vault was found in your sync source. Import it to unlock your notes.',
          icon: 'riShieldKeyholeLine',
          okText: translations.value.account?.importVault || 'Import',
          cancelText: translations.value.dialog?.cancel || 'Cancel',
          onConfirm: () => {
            dialog.prompt({
              title: translations.value.account?.vaultPasswordTitle || 'Enter vault password',
              body: translations.value.account?.vaultPasswordBody || 'Enter the password for the existing encrypted vault in your sync source.',
              icon: 'riLockLine',
              okText: translations.value.account?.importVault || 'Import',
              cancelText: translations.value.dialog?.cancel || 'Cancel',
              placeholder: translations.value.settings?.password || 'Vault password',
              password: true,
              onConfirm: async (pass) => {
                if (!pass) {
                  dialog.alert({
                    title: translations.value.settings?.alertTitle || 'Alert',
                    body: translations.value.settings?.invalidPassword || 'Enter the vault password.',
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
      console.warn('[auth] vault detection failed:', e);
    }
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
    dialog.confirm({
      title: translations.value.account?.signOutTitle || 'Sign out?',
      body:
        translations.value.account?.signOutBody ||
        'You can sign back in at any time. Local notes stay on this device.',
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

  async function handleRevokeDevice(deviceId) {
    clearError();
    try {
      await auth.revokeDevice(deviceId);
    } catch {
      // error already on the store
    }
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

  async function revokeSession(id) {
    try {
      await auth.revokeActiveSession(id);
      await loadSessions();
    } catch {
      // error already on the store
    }
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
