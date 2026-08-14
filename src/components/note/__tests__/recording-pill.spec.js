import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';

vi.mock('tauri-plugin-audio-recorder-api', () => ({
  checkPermission: vi.fn().mockResolvedValue({ granted: true, canRequest: true }),
  requestPermission: vi.fn().mockResolvedValue({ granted: true, canRequest: true }),
  getStatus: vi.fn().mockResolvedValue({ state: 'idle', durationMs: 0 }),
  startRecording: vi.fn().mockResolvedValue({}),
  pauseRecording: vi.fn().mockResolvedValue({}),
  resumeRecording: vi.fn().mockResolvedValue({}),
  stopRecording: vi.fn().mockResolvedValue({ filePath: '/app/assets/n1/abc.wav' }),
}));

vi.mock('@/lib/tauri-bridge', () => ({
  backend: {
    isMobileRuntime: () => true,
    invoke: vi.fn().mockResolvedValue(),
  },
  path: {
    join: (...parts) => parts.join('/'),
    basename: (file) => file.split('/').pop(),
  },
  addCloseHandler: vi.fn(),
}));

vi.mock('@/lib/native/app', () => ({
  getAppDirectory: vi.fn().mockResolvedValue('/app'),
}));

vi.mock('@/store/note', () => ({
  useNoteStore: () => ({
    getById: (id) => ({ id, title: `Note ${id}` }),
  }),
}));

vi.mock('@/utils/assets/audioInsert', () => ({
  insertAudioIntoClosedNote: vi.fn().mockResolvedValue(),
}));

const { mockRoute, mockPush } = vi.hoisted(() => ({
  mockRoute: { value: { name: null, params: {} } },
  mockPush: vi.fn(),
}));

vi.mock('vue-router', () => ({
  useRouter: () => ({ currentRoute: mockRoute, push: mockPush }),
}));

import { insertAudioIntoClosedNote } from '@/utils/assets/audioInsert';

async function freshRecorder() {
  vi.resetModules();
  const mod = await import('@/composable/useAudioRecorder.js');
  return mod.useAudioRecorder();
}

async function mountPill() {
  const { default: Pill } = await import('../RecordingPill.vue');
  return mount(Pill, {
    global: { stubs: { 'v-remixicon': true } },
  });
}

describe('RecordingPill insertion ownership', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRoute.value = { name: null, params: {} };
  });

  it('defers to the note page when the route already points at the target note (I1 race)', async () => {
    const rec = await freshRecorder();
    await mountPill();

    // The note page registers its onStopped subscription in setup() scope,
    // before the router/route settles; simulate that subscriber here.
    const pageHandleRecordingStopped = vi.fn();
    rec.onStopped(pageHandleRecordingStopped);

    // Navigation to the target note has already settled when the user
    // taps stop while the page is still mounting.
    mockRoute.value = { name: 'Note', params: { id: 'n1' } };
    await rec.start('n1', 0);
    await rec.stop();

    expect(insertAudioIntoClosedNote).not.toHaveBeenCalled();
    expect(pageHandleRecordingStopped).toHaveBeenCalledTimes(1);
  });

  it('appends into the closed note when the route is not on the target note', async () => {
    const rec = await freshRecorder();
    await mountPill();

    mockRoute.value = { name: 'Home', params: {} };
    await rec.start('n1', 0);
    await rec.stop();

    expect(insertAudioIntoClosedNote).toHaveBeenCalledWith(
      'n1',
      '/app/assets/n1/abc.wav',
      expect.any(Object)
    );
  });
});
