import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';

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
    isIOSRuntime: () => false,
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

async function mountPill() {
  // Reset modules, then mount the pill BEFORE reading the recorder: the pill's
  // static import caches the recorder module, so reading it afterwards returns
  // the exact same singleton the pill subscribed to.
  vi.resetModules();
  const { default: Pill } = await import('../RecordingPill.vue');
  const { useAudioRecorder } = await import('@/composable/useAudioRecorder');
  const wrapper = mount(Pill, {
    global: { stubs: { 'v-remixicon': true } },
  });
  return { wrapper, rec: useAudioRecorder() };
}

describe('RecordingPill insertion ownership', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRoute.value = { name: null, params: {} };
  });

  it('defers to the note page when the target note is the open editor (I1 race)', async () => {
    const { rec } = await mountPill();

    // The note page registers its onStopped subscription in setup() scope
    // and marks itself via recorder.openNoteId (authority, not the route);
    // simulate that here.
    const pageHandleRecordingStopped = vi.fn();
    rec.onStopped(pageHandleRecordingStopped);
    rec.openNoteId.value = 'n1';

    await rec.start('n1', 0);
    await rec.stop();

    expect(insertAudioIntoClosedNote).not.toHaveBeenCalled();
    expect(pageHandleRecordingStopped).toHaveBeenCalledTimes(1);
  });

  it('appends into the closed note when the target note is not the open editor', async () => {
    const { rec } = await mountPill();

    await rec.start('n1', 0);
    await rec.stop();

    expect(insertAudioIntoClosedNote).toHaveBeenCalledWith(
      'n1',
      '/app/assets/n1/abc.wav',
      expect.any(Object),
      0
    );
  });

  it('uses the compact pill surface and 36px controls', async () => {
    const { wrapper, rec } = await mountPill();

    await rec.start('n1', 0);
    await nextTick();

    // role="region" is the outer fixed wrapper; the inner surface is the pill.
    const pill = wrapper.find('[role="region"] > div');
    expect(pill.classes()).toContain('rounded-full');
    expect(pill.classes()).toContain('border');
    expect(pill.classes()).toContain('shadow-xl');

    // First button is the tap-to-note title; pause + stop are the 36px
    // circular controls.
    const buttons = wrapper.findAll('button');
    expect(buttons).toHaveLength(3);
    for (const b of buttons.slice(1)) {
      expect(b.classes()).toContain('size-9');
    }

    await rec.stop();
  });
});
