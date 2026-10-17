import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ref, nextTick } from 'vue';
import { mount, flushPromises } from '@vue/test-utils';

const mobileFlag = vi.hoisted(() => ({ value: false }));
const accountCtl = vi.hoisted(() => ({ authed: false, paid: false }));
const syncPrefs = vi.hoisted(() => ({ calls: [] }));
const setSettingCtl = vi.hoisted(() => ({ sets: [] }));
const vaultJoinCtl = vi.hoisted(() => ({ detect: null }));

vi.mock('@/composable/useTranslations', () => ({
  useTranslations: () => ({ translations: ref({}) }),
}));

vi.mock('@/composable/theme', () => ({
  useTheme: () => ({ loadTheme: vi.fn(), isDark: () => false }),
}));

vi.mock('@/lib/settings', () => ({
  DEFAULT_UI_FONT_STACK: "'Inter'",
  getSetting: vi.fn(async () => null),
  getSettingSync: vi.fn(() => null),
  invalidateSettingMirrors: vi.fn(),
  setSetting: vi.fn(async (key, value) => {
    setSettingCtl.sets.push([key, value]);
  }),
}));

vi.mock('@/store/account', () => ({
  useAccountStore: () => ({
    get isAuthenticated() {
      return accountCtl.authed;
    },
    get isPaidPlan() {
      return accountCtl.paid;
    },
    serverUrl: 'https://api.test',
    status: 'anonymous',
    subscription: null,
    profile: null,
  }),
}));

vi.mock('@/lib/dialog', () => ({
  useDialog: () => ({ confirm: vi.fn() }),
}));

vi.mock('@/utils/onboarding/index.js', () => ({
  applyOnboardingSyncPreferences: vi.fn(async (prefs) => {
    syncPrefs.calls.push({ ...prefs });
  }),
  getOnboardingMigrationStatus: vi.fn(async () => ({ hasLegacyData: false })),
  markOnboardingCompleted: vi.fn(async () => {}),
  probeCustomMigrationPath: vi.fn(async () => ({ hasLegacyData: false })),
  runOnboardingMigration: vi.fn(async () => {}),
  runOnboardingMigrationFromPath: vi.fn(async () => {}),
  ENTRANCE_DELAYS: { logo: 120, text: 580, cta: 1020 },
  CURTAIN_DURATIONS: { in: 420, out: 320, hold: 0, open: 0 },
}));

vi.mock('@/utils/onboarding/import-finalize.js', () => ({
  buildImportedSearchIndex: vi.fn(async () => {}),
  secureImportedAssets: vi.fn(async () => {}),
}));

vi.mock('@/utils/crypto/encryption.js', () => ({
  setupEncryption: vi.fn(async () => ({ ok: true })),
  hasRemoteVaultKeyParams: vi.fn(async () => false),
  adoptVaultKey: vi.fn(async () => ({ ok: true })),
  isKeyLoaded: vi.fn(() => false),
  publishLocalKeyParamsToFolder: vi.fn(async () => {}),
  setDeclinedVaultJoin: vi.fn(async () => {}),
}));

vi.mock('@/utils/onboarding/sync-policy.js', () => ({
  getOnboardingSyncTransport: vi.fn(({ isAuthenticated, isPaidPlan }) =>
    isAuthenticated && isPaidPlan ? 'remote' : 'folder',
  ),
  getOnboardingSyncLocation: vi.fn(({ isAuthenticated, isPaidPlan }) =>
    isAuthenticated && isPaidPlan ? 'cloud' : 'local',
  ),
}));

vi.mock('@/utils/sync/path.js', () => ({
  setSyncPath: vi.fn(async () => {}),
}));

vi.mock('@/utils/sync/rust-shim.js', () => ({
  kickRustSync: vi.fn(() => true),
  startRustSync: vi.fn(async () => {}),
}));

vi.mock('@/utils/migration/legacyElectron.js', () => ({
  detectLegacyLockedNotes: vi.fn(async () => ({ hasLocked: false, count: 0 })),
  validateLegacyLockedPassword: vi.fn(async () => ({ ok: true, count: 0 })),
}));

vi.mock('@/utils/onboarding/platforms.js', () => ({
  ALL_PLATFORMS: [],
  ONBOARDING_IMPORT_SOURCE_MAP: {},
  PLATFORM_LABELS: {},
  getMigrationSourceCopy: vi.fn(() => null),
  getMigrationWhatGetsCopied: vi.fn(() => null),
  isPlatformVisible: vi.fn(() => false),
}));

vi.mock('@/lib/tauri/runtime', () => ({
  isMacOSRuntime: () => false,
  isMobileRuntime: () => mobileFlag.value,
  isIOSRuntime: () => false,
}));

vi.mock('@/lib/native/dialog', () => ({
  openDialog: vi.fn(async () => ({ canceled: true })),
}));

vi.mock('@/lib/native/app', () => ({
  readLegacyData: vi.fn(async () => null),
}));

vi.mock('@/lib/tauri-bridge', () => ({
  backend: {
    isMobileRuntime: () => mobileFlag.value,
    invoke: vi.fn(async () => {}),
    listenPayload: vi.fn(async () => () => {}),
    listen: vi.fn(),
  },
  clipboard: {},
  addCloseHandler: vi.fn(),
}));

vi.mock('@/utils/sync/vault-key-params.js', () => ({
  fetchCloudKeyParams: vi.fn(async () => null),
  getFetchedCloudKeyParams: vi.fn(() => null),
  deriveVaultPassphraseProof: vi.fn(async () => 'proof'),
}));

vi.mock('@/utils/onboarding/remote-vault-join.js', () => ({
  detectRemoteVaultJoin: (...a) => vaultJoinCtl.detect(...a),
  completeRemoteVaultJoin: vi.fn(async () => ({ ok: true })),
  adoptWorkspaceKeysFromVault: vi.fn(async () => {}),
}));

vi.mock('@/store/workspace.ts', () => ({
  useWorkspaceStore: () => ({ activeId: 'ws-1', workspaces: [], retrieve: vi.fn() }),
}));

vi.mock('@/composable/useCloudWorkspaces', () => ({
  useCloudWorkspaces: () => ({ workspaces: ref([]) }),
}));

vi.mock('@/lib/api/client', () => ({
  getApiClient: () => ({
    createVaultChallenge: vi.fn(async () => ({ challenge: 'c' })),
    verifyVaultPassphrase: vi.fn(async () => ({ ok: true })),
  }),
}));

vi.mock('@/lib/account-storage', () => ({
  loadSessionToken: vi.fn(async () => 'token'),
}));

vi.mock('@/lib/yjs/meta-store.js', () => ({
  writeStoresFromWorkspace: vi.fn(async () => {}),
  seedWorkspaceDocFromData: vi.fn(async () => ({ seededFolders: 0 })),
}));

// Onboarding.vue's own collaborators (page-level stores and orchestration).
vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(async () => {}) }),
}));

vi.mock('@/lib/storage', () => ({
  useStorage: () => ({}),
}));

vi.mock('@/store', () => ({
  useStore: () => ({}),
}));

vi.mock('@/store/note', () => ({
  useNoteStore: () => ({}),
}));

vi.mock('@/store/folder', () => ({
  useFolderStore: () => ({}),
}));

vi.mock('@/composable/useSounds', () => ({
  useSounds: () => ({ play: vi.fn() }),
}));

const accountApi = vi.hoisted(() => () => ({
  signInEmail: ref(''),
  signInPassword: ref(''),
  signUpUsername: ref(''),
  passkeyEmail: ref(''),
  quickConnectCode: ref(''),
  quickConnectSecret: ref(''),
  quickConnectExpiresAt: ref(null),
  showPasswordAuth: ref(false),
  showQuickConnect: ref(false),
  showServerUrlEditor: ref(false),
  draftServerUrl: ref('https://api.test'),
  defaultServerUrl: 'https://api.test',
  deletingAccount: ref(false),
  deletePassword: ref(''),
  saveServerUrl: vi.fn(),
  resetServerUrl: vi.fn(),
  handleSignInWithPassword: vi.fn(),
  handleSignUpWithPassword: vi.fn(),
  handleSignInWithPasskey: vi.fn(),
  handleSignUpWithPasskey: vi.fn(),
  startQuickConnect: vi.fn(),
  pollQuickConnect: vi.fn(),
  authorizeQuickConnect: vi.fn(),
  handleSignOut: vi.fn(),
  handleRevokeDevice: vi.fn(),
  triggerSeed: vi.fn(),
  clearError: vi.fn(),
}));

vi.mock('@/composable/useSettingsAccount', () => ({
  useSettingsAccount: accountApi,
}));

import Onboarding from '@/pages/Onboarding.vue';

async function mountOnAccountStep() {
  const wrapper = mount(Onboarding);
  const welcome = wrapper.find('[data-testid="onboarding-welcome-continue"]');
  expect(welcome.exists()).toBe(true);
  await welcome.trigger('click');
  await nextTick();
  return wrapper;
}

function connectButtons(wrapper) {
  return wrapper.findAll('[data-testid^="onboarding-connect-"]');
}

describe('onboarding account step footer', () => {
  beforeEach(() => {
    vaultJoinCtl.detect = vi.fn(async () => false);
    accountCtl.authed = false;
    accountCtl.paid = false;
    syncPrefs.calls = [];
    setSettingCtl.sets = [];
  });

  it('signed-out with no sync folder: a single primary button reading Skip for now', async () => {
    const wrapper = await mountOnAccountStep();

    const btns = connectButtons(wrapper);
    expect(btns).toHaveLength(1);
    expect(btns[0].attributes('data-testid')).toBe(
      'onboarding-connect-continue',
    );
    expect(btns[0].text()).toBe('Skip for now');
  });

  it('signed-in (any plan): a single button reading Continue', async () => {
    accountCtl.authed = true;
    accountCtl.paid = false;
    const wrapper = await mountOnAccountStep();

    const btns = connectButtons(wrapper);
    expect(btns).toHaveLength(1);
    expect(btns[0].text()).toBe('Continue');
  });

  it('free signed-out user still picks a folder, then the button commits it', async () => {
    const wrapper = await mountOnAccountStep();
    expect(wrapper.find('[data-testid="onboarding-sync-path"]').exists()).toBe(
      true,
    );
    // Same reactive path `ui-input` v-model writes (stubbed inputs don't wire
    // custom v-model in jsdom).
    wrapper.vm.fresh.syncPath = '/tmp/sync';
    await nextTick();

    const btns = connectButtons(wrapper);
    await nextTick();
    expect(btns).toHaveLength(1);
    expect(btns[0].text()).toBe('Continue');

    await btns[0].trigger('click');
    await flushPromises();
    expect(syncPrefs.calls[0]).toMatchObject({ syncPath: '/tmp/sync' });
  });

  it('paid signed-in user: no folder-sync block, single Continue button', async () => {
    accountCtl.authed = true;
    accountCtl.paid = true;
    const wrapper = await mountOnAccountStep();

    expect(wrapper.find('[data-testid="onboarding-sync-path"]').exists()).toBe(
      false,
    );
    expect(connectButtons(wrapper)).toHaveLength(1);
    expect(connectButtons(wrapper)[0].text()).toBe('Continue');
  });
});
