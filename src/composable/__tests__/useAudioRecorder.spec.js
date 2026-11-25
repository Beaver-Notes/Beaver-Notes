import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('tauri-plugin-audio-recorder-api', () => ({
  checkPermission: vi.fn().mockResolvedValue({ granted: true, canRequest: true }),
  requestPermission: vi.fn().mockResolvedValue({ granted: true, canRequest: true }),
  getStatus: vi.fn().mockResolvedValue({ state: 'idle', durationMs: 0 }),
  startRecording: vi.fn().mockResolvedValue({}),
  pauseRecording: vi.fn().mockResolvedValue({}),
  resumeRecording: vi.fn().mockResolvedValue({}),
  stopRecording: vi.fn().mockResolvedValue({ filePath: '/app/assets/n1/abc.wav' }),
}));

const { isIOSRuntimeMock } = vi.hoisted(() => ({
  isIOSRuntimeMock: vi.fn().mockReturnValue(false),
}));

vi.mock('@/lib/tauri-bridge', () => ({
  backend: {
    isMobileRuntime: () => true,
    isIOSRuntime: isIOSRuntimeMock,
    invoke: vi.fn().mockResolvedValue(),
  },
  path: {
    join: (...parts) => parts.join('/'),
    basename: (file) => file.split('/').pop(),
  },
  addCloseHandler: vi.fn(),
}));

vi.mock('@/store/note', () => ({
  useNoteStore: () => ({
    getById: () => ({ title: 'Test Note' }),
  }),
}));

vi.mock('@/lib/native/app', () => ({
  getAppDirectory: vi.fn().mockResolvedValue('/app'),
}));

const { removePathMock } = vi.hoisted(() => ({
  removePathMock: vi.fn().mockResolvedValue(),
}));

vi.mock('@/lib/native/fs', () => ({ removePath: removePathMock }));
vi.mock('@/lib/dialog', () => ({ useDialog: () => ({ alert: vi.fn() }) }));

import { stopRecording } from 'tauri-plugin-audio-recorder-api';
import { removePath } from '@/lib/native/fs';

async function freshRecorder() {
  vi.resetModules();
  const mod = await import('../useAudioRecorder.js');
  return mod.useAudioRecorder();
}

// A recording is unrecoverable once deleted: both stop paths must keep the
// file on disk, whether or not a handler consumed the payload.
describe('useAudioRecorder stop keeps the recording', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stopRecording.mockResolvedValue({ filePath: '/app/assets/n1/abc.wav' });
  });

  it('keeps the file even when no handler consumes the stop payload', async () => {
    // A missed listener (navigation race) must not vaporize the recording;
    // the next stop for the same note overwrites it instead.
    const rec = await freshRecorder();
    rec.onStopped(() => {});

    await rec.start('n1', 0);
    const payload = await rec.stop();

    expect(removePath).not.toHaveBeenCalled();
    expect(payload.consumed).toBe(false);
  });

  it('keeps the file when an onStopped handler consumes the payload', async () => {
    const rec = await freshRecorder();
    rec.onStopped((payload) => payload.markConsumed());

    await rec.start('n1', 0);
    const payload = await rec.stop();

    expect(removePath).not.toHaveBeenCalled();
    expect(payload.consumed).toBe(true);
  });
});
