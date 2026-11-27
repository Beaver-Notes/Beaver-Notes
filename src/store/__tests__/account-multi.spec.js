import { setActivePinia, createPinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The account index and the per-account credential slots both sit on the native
// secure-blob store, so keep a stateful stand-in rather than a no-op stub.
const { blobs } = vi.hoisted(() => ({ blobs: new Map() }));

vi.mock('@/lib/native/security', () => ({
  isEncryptionAvailable: vi.fn(async () => true),
  encryptString: vi.fn(async (s) => `cipher:${s}`),
  decryptString: vi.fn(async (s) => String(s).replace(/^cipher:/, '')),
  storeSecureBlob: vi.fn(async (key, value) => {
    blobs.set(key, value);
  }),
  fetchSecureBlob: vi.fn(async (key) => blobs.get(key) ?? null),
  clearSecureBlob: vi.fn(async (key) => {
    blobs.delete(key);
  }),
}));

import { useAccountStore } from '@/store/account';
import { saveSessionToken } from '@/lib/account-storage';
import { clearIndex, saveIndex } from '@/lib/accounts-index';
import { refreshPlanQuietly } from '@/composable/useAppShell';

// refreshPlanQuietly lives in the app-shell module, whose import graph drags
// in tauri/native/yjs code. Stub those edges so the unit test can import the
// real function; the account store and settings stay real.
const { getAccount, getPlans } = vi.hoisted(() => ({
  getAccount: vi.fn(),
  getPlans: vi.fn(),
}));

vi.mock('@/lib/api/account', () => ({ getAccount }));
vi.mock('@/lib/api/plans', () => ({ getPlans }));
vi.mock('@/store', () => ({ useStore: vi.fn(() => ({})) }));
vi.mock('@/store/app', () => ({ useAppStore: vi.fn(() => ({})) }));
vi.mock('@/lib/tauri-bridge', () => ({
  backend: {
    isMobileRuntime: vi.fn(() => false),
    isPhoneRuntime: vi.fn(() => false),
    isDesktopRuntime: vi.fn(() => false),
  },
  onFileOpened: vi.fn(),
}));
vi.mock('@/lib/native/app', () => ({
  appReady: Promise.resolve(),
  initNotificationClicks: vi.fn(),
  setMenuVisibility: vi.fn(),
  setZoomLevel: vi.fn(),
}));
vi.mock('@/lib/native/updates', () => ({
  checkForUpdates: vi.fn(),
  getAutoUpdateStatus: vi.fn(),
  installUpdate: vi.fn(),
  isUpdateManaged: vi.fn(),
}));
vi.mock('@/utils/ui/zoom', () => ({
  getStoredZoomLevel: vi.fn(() => 1),
  setStoredZoomLevel: vi.fn(),
  wasZoomAppliedAtBoot: vi.fn(() => false),
}));
vi.mock('@/utils/crypto/encryption.js', () => ({
  encryptionIsConfigured: vi.fn(),
  isKeyLoaded: vi.fn(),
}));
vi.mock('@/composable/theme', () => ({ useTheme: vi.fn() }));
vi.mock('@/composable/useUiState', () => ({ useUiState: vi.fn(() => ({})) }));
vi.mock('@/lib/foldable', () => ({ foldState: { isFoldable: false } }));
vi.mock('@/composable/useTranslations', () => ({
  useTranslations: vi.fn(() => ({ translations: {} })),
}));
vi.mock('@/lib/mousetrap', () => ({ default: vi.fn() }));
vi.mock('@/utils/share/BEA', () => ({ importBEA: vi.fn() }));
vi.mock('@/composable/useSoundActions', () => ({ useSoundActions: vi.fn() }));
vi.mock('@/composable/useAppEncryptionGate', () => ({
  useAppEncryptionGate: vi.fn(),
}));
vi.mock('@/lib/yjs/workspace-doc', () => ({
  loadWorkspaceDoc: vi.fn(),
  observeWorkspace: vi.fn(),
  writeStoresFromWorkspace: vi.fn(),
  backfillNotePreviews: vi.fn(),
  repairStrandedNotes: vi.fn(),
}));
vi.mock('@/utils/sync/app-sync.js', () => ({ initAppSync: vi.fn() }));
vi.mock('@/utils/sync/rust-shim.js', () => ({
  kickRustSync: vi.fn(),
  kickRustDirty: vi.fn(),
}));
vi.mock('@/utils/ui/menuContext', () => ({
  buildMenuContext: vi.fn(),
  pushMenuContext: vi.fn(),
}));
vi.mock('@/composable/useSidebar', () => ({ useSidebar: vi.fn() }));

beforeEach(async () => {
  setActivePinia(createPinia());
  localStorage.clear();
  blobs.clear();
  vi.clearAllMocks();
  await clearIndex();
});

describe('account store: several accounts at once', () => {
  it('two accounts keep their own plan and switch in the store', async () => {
    const store = useAccountStore();
    await store.hydrateAccounts();
    await store.persistActiveAccount({
      id: 'p1',
      email: 'me@test.test',
      organizations: [{ id: 'o1', subscription: { plan: 'pro' } }],
      activeOrgId: 'o1',
      subscription: { plan: 'pro' },
      planLimits: { historyDays: 30 },
    });
    await store.persistActiveAccount({
      id: 't1',
      email: 'team@test.test',
      organizations: [{ id: 'o2', subscription: { plan: 'team' } }],
      activeOrgId: 'o2',
      subscription: { plan: 'team' },
      planLimits: { historyDays: 90 },
    });
    await store.activateAccount('p1');
    expect(store.plan).toBe('pro');
    expect(store.isPaidPlan).toBe(true);
    await store.activateAccount('t1');
    expect(store.plan).toBe('team');
    expect(store.historyDays).toBe(90);
  });

  it('org subscription alone decides the plan when no legacy subscription exists', async () => {
    // Finding 24: org-based gating is what refreshPlanQuietly heals (finding
    // 13); the org record must carry the plan on its own.
    const store = useAccountStore();
    await store.hydrateAccounts();
    await store.persistActiveAccount({
      id: 't1',
      email: 'team@test.test',
      organizations: [{ id: 'o2', subscription: { plan: 'team' } }],
      activeOrgId: 'o2',
      subscription: null,
    });
    expect(store.plan).toBe('team');
    expect(store.isPaidPlan).toBe(true);
  });

  it('forgetting the active account keeps the other one usable', async () => {
    const store = useAccountStore();
    await store.hydrateAccounts();
    await store.persistActiveAccount({ id: 'p1', email: 'me@test.test' });
    await store.persistActiveAccount({ id: 't1', email: 'team@test.test' });
    await store.forgetAccount('t1');
    expect(store.accounts.map((a) => a.id)).toEqual(['p1']);
    expect(store.activeAccountId).toBe('p1');
  });

  it('hydrateAccounts restores the active account with its own token and plan', async () => {
    await saveSessionToken('session-p1', 'p1');
    await saveIndex({
      accounts: [
        {
          id: 'p1',
          email: 'me@test.test',
          subscription: { plan: 'pro' },
          planLimits: { historyDays: 30 },
        },
        { id: 't1', email: 'team@test.test', subscription: { plan: 'team' } },
      ],
      activeAccountId: 'p1',
    });

    const store = useAccountStore();
    await store.hydrateAccounts();

    expect(store.accounts.map((a) => a.id)).toEqual(['p1', 't1']);
    expect(store.activeAccountId).toBe('p1');
    expect(store.token).toBe('session-p1');
    expect(store.status).toBe('authenticated');
    expect(store.plan).toBe('pro');
    expect(store.historyDays).toBe(30);
  });

  it('never parks a leaving account token in the store', async () => {
    const store = useAccountStore();
    await store.persistActiveAccount({ id: 'p1', email: 'me@test.test' });

    // A refresh can land after the user switched away; the token belongs to the
    // account that made the call, not to whichever one is active by then.
    store.setToken('leaving-account-token', 't1');
    expect(store.token).toBeNull();

    store.setToken('p1-token');
    expect(store.token).toBe('p1-token');
  });

  it('gates history on the plan and passkeys on the official server', () => {
    const store = useAccountStore();
    store.serverUrl = 'https://notes.example.test';
    expect(store.isOfficialServer).toBe(false);
    store.serverUrl = 'https://api.beavernotes.com';
    expect(store.isOfficialServer).toBe(true);

    store.status = 'authenticated';
    store.token = 't';
    store.planLimits = { historyDays: 0 };
    expect(store.canUseHistory).toBe(false);
    store.planLimits = { historyDays: 30 };
    expect(store.canUseHistory).toBe(true);
    store.planLimits = null;
    expect(store.canUseHistory).toBe(true);
    store.token = null;
    expect(store.canUseHistory).toBe(false);
  });

  it('ignores an account id the index does not know', async () => {
    const store = useAccountStore();
    await store.persistActiveAccount({ id: 'p1', email: 'me@test.test' });

    await store.activateAccount('nope');

    expect(store.activeAccountId).toBe('p1');
    expect(store.accounts.map((a) => a.id)).toEqual(['p1']);
  });

  it('fail-closed when subscription missing/undefined/error', () => {
    const store = useAccountStore();
    store.setStatus('authenticated');
    store.setToken('tok');
    store.accounts = [{ id: 'a1', organizations: [] }];
    store.activeAccountId = 'a1';
    store.subscription = null;
    expect(store.plan).toBe('free');
    expect(store.isPaidPlan).toBe(false);
    expect(store.canUseCloudSync).toBe(false);
    store.subscription = undefined;
    expect(store.isPaidPlan).toBe(false);
  });

  it('fail-closed shows locked UI when API unreachable (no subscription)', () => {
    const store = useAccountStore();
    // Simulates failed profile fetch: status stays anonymous or subscription null
    store.setStatus('authenticated');
    store.setToken('tok');
    store.accounts = [{ id: 'a1', organizations: [{ id: 'o1', subscription: null, workspaces: [] }] }];
    store.activeAccountId = 'a1';
    store.activeOrgId = 'o1';
    expect(store.isPaidPlan).toBe(false);
    expect(store.canUseCloudSync).toBe(false);
    // unauthenticated also locked
    store.setStatus('anonymous');
    expect(store.canUseCloudSync).toBe(false);
  });
});

describe('refreshPlanQuietly: sole-org auto-selection (residual 13)', () => {
  it('auto-selects the only org an org-less account gained and adopts its plan', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    try {
      const store = useAccountStore();
      await store.hydrateAccounts();
      await saveSessionToken('session-t1', 't1');
      await store.persistActiveAccount({
        id: 't1',
        email: 'team@test.test',
        organizations: [],
        activeOrgId: null,
        subscription: null,
      });
      expect(store.plan).toBe('free');

      getAccount.mockResolvedValue({
        organizations: [{ id: 'o9', subscription: { plan: 'team' } }],
      });
      getPlans.mockResolvedValue({ historyDays: 90 });

      await refreshPlanQuietly();

      expect(store.activeOrgId).toBe('o9');
      expect(store.plan).toBe('team');
      expect(store.historyDays).toBe(90);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not auto-select when the fetched list has two orgs', async () => {
    // 61 minutes past the other test's throttle stamp so the 60 s guard passes.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T01:01:00Z'));
    try {
      const store = useAccountStore();
      await store.hydrateAccounts();
      await saveSessionToken('session-t1', 't1');
      await store.persistActiveAccount({
        id: 't1',
        email: 'team@test.test',
        organizations: [
          { id: 'oA', subscription: { plan: 'team' } },
          { id: 'oB', subscription: { plan: 'pro' } },
        ],
        activeOrgId: null,
        subscription: null,
      });
      expect(store.plan).toBe('free');

      getAccount.mockResolvedValue({
        organizations: [
          { id: 'oA', subscription: { plan: 'team' } },
          { id: 'oB', subscription: { plan: 'pro' } },
        ],
      });
      getPlans.mockResolvedValue({ historyDays: 90 });

      await refreshPlanQuietly();

      // Two orgs give no safe default: the org plans must not be adopted
      // without an explicit selection.
      expect(store.activeOrgId).toBeNull();
      expect(store.plan).toBe('free');
    } finally {
      vi.useRealTimers();
    }
  });
});
