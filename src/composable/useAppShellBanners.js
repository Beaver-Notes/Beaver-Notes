import { computed, reactive } from 'vue';
import {
  encryptionIsConfigured,
  isKeyLoaded,
} from '@/utils/crypto/encryption.js';

const ONBOARDING_ROUTE_NAME = 'Onboarding';
const SETTINGS_ROUTE_PREFIX = '/settings';

export function useAppShellBanners({ translations, route, router }) {
  const updateBanner = reactive({
    show: false,
    content: '',
    primaryText: '',
    secondaryText: '',
    version: '',
  });
  const syncLockBanner = reactive({
    show: false,
    dismissed: false,
  });
  const appEncryptionMigrationBanner = reactive({
    show: false,
    dismissed: false,
    status: null,
    error: null,
  });

  const syncLockBannerCopy = computed(() => ({
    content:
      translations.value.app?.syncLockContent ||
      'Sync is encrypted but locked on this device. Unlock it in Settings to resume sync.',
    primaryText: translations.value.app?.openSettings || 'Open Settings',
    secondaryText: translations.value.app?.dismiss || 'Dismiss',
  }));

  const handleUpdateInstall = (installUpdate) => {
    installUpdate();
    updateBanner.show = false;
  };

  const handleUpdateDismiss = () => {
    updateBanner.show = false;
  };

  const openSyncSettings = () => {
    syncLockBanner.show = false;
    router.push(SETTINGS_ROUTE_PREFIX);
  };

  const dismissSyncBanner = () => {
    syncLockBanner.dismissed = true;
    syncLockBanner.show = false;
  };

  const refreshSyncLockBanner = async () => {
    const inSettings = router.currentRoute.value.path.startsWith(
      SETTINGS_ROUTE_PREFIX
    );
    if (
      inSettings ||
      syncLockBanner.dismissed ||
      route.name === ONBOARDING_ROUTE_NAME
    ) {
      syncLockBanner.show = false;
      return;
    }

    const configured = await encryptionIsConfigured();
    syncLockBanner.show = configured && !isKeyLoaded();
  };

  const dismissAppEncryptionMigrationBanner = () => {
    appEncryptionMigrationBanner.dismissed = true;
    appEncryptionMigrationBanner.show = false;
  };

  const openAppEncryptionMigrationSettings = () => {
    appEncryptionMigrationBanner.show = false;
    router.push(SETTINGS_ROUTE_PREFIX);
  };

  const checkAppEncryptionMigration = (migrationStatus) => {
    if (!migrationStatus) return;
    const { status, error } = migrationStatus;
    if (status === 'in_progress' || status === 'error') {
      appEncryptionMigrationBanner.status = status;
      appEncryptionMigrationBanner.error = error || null;
      if (!appEncryptionMigrationBanner.dismissed) {
        appEncryptionMigrationBanner.show = true;
      }
    }
  };

  return {
    dismissSyncBanner,
    handleUpdateDismiss,
    handleUpdateInstall,
    openSyncSettings,
    refreshSyncLockBanner,
    syncLockBanner,
    syncLockBannerCopy,
    updateBanner,
    appEncryptionMigrationBanner,
    dismissAppEncryptionMigrationBanner,
    openAppEncryptionMigrationSettings,
    checkAppEncryptionMigration,
  };
}
