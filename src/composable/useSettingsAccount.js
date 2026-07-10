import { onMounted, ref } from 'vue';
import { useAccountStore } from '@/store/account';
import { setSetting } from '@/composable/settings';
import { useAccountAuth } from '@/composable/useAccountAuth';

export function useSettingsAccount({ dialog, translations, showDialogAlert }) {
  const accountStore = useAccountStore();
  const auth = useAccountAuth();

  const signInEmail = ref('');
  const signInPassword = ref('');
  const passkeyEmail = ref('');
  const quickConnectCode = ref('');
  const quickConnectSecret = ref('');
  const quickConnectExpiresAt = ref(null);
  const showServerUrlEditor = ref(false);
  const draftServerUrl = ref(accountStore.serverUrl);
  const deletingAccount = ref(false);
  const deletePassword = ref('');

  const defaultServerUrl = 'https://api.beavernotes.com';

  function clearError() {
    accountStore.setError('');
  }

  function showAlert(message, options = {}) {
    if (showDialogAlert) {
      showDialogAlert(message);
    } else {
      dialog.alert({
        title: translations.value.settings?.alertTitle || 'Alert',
        body: message,
        okText: translations.value.dialog?.close || 'Close',
        ...options,
      });
    }
  }

  async function saveServerUrl() {
    const next = (draftServerUrl.value || '').trim() || defaultServerUrl;
    accountStore.setServerUrl(next);
    await setSetting('beaverAccountServerUrl', next);
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
    } catch (err) {
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
        signInPassword.value
      );
      signInPassword.value = '';
    } catch (err) {
      // error already on the store
    }
  }

  async function handleSignInWithPasskey() {
    clearError();
    try {
      await auth.signInWithPasskey(passkeyEmail.value?.trim() || null);
    } catch (err) {
      // error already on the store
    }
  }

  async function handleSignUpWithPasskey() {
    clearError();
    try {
      await auth.signUpWithPasskey(passkeyEmail.value?.trim() || null);
    } catch (err) {
      // error already on the store
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
    } catch (err) {
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
    } catch (err) {
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
    } catch (err) {
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
        } catch (err) {
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
        } catch (err) {
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
    } catch (err) {
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
    } catch (err) {
      // error already on the store
    }
  }

  onMounted(() => {
    // hydrate is called by the composable's onMounted; ensure the latest
    // profile is fetched when the settings page is opened.
    if (accountStore.isAuthenticated) {
      auth.refreshProfile().catch(() => {});
    }
  });

  return {
    accountStore,
    signInEmail,
    signInPassword,
    passkeyEmail,
    quickConnectCode,
    quickConnectSecret,
    quickConnectExpiresAt,
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
  };
}
