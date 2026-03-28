import { computed, reactive } from 'vue';
import { syncFolderHasEncryption, isSyncKeyLoaded } from '@/utils/sync/crypto';

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

    const folderEncrypted = await syncFolderHasEncryption();
    syncLockBanner.show = folderEncrypted && !isSyncKeyLoaded();
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
  };
}
