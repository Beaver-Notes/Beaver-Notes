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

const { removePathMock, dialogAlertMock } = vi.hoisted(() => ({
  removePathMock: vi.fn().mockResolvedValue(),
  dialogAlertMock: vi.fn(),
}));

vi.mock('@/lib/native/fs', () => ({ removePath: removePathMock }));
vi.mock('@/lib/dialog', () => ({ useDialog: () => ({ alert: dialogAlertMock }) }));

import {
  checkPermission,
  startRecording,
  stopRecording,
  pauseRecording,
  resumeRecording,
  getStatus,
} from 'tauri-plugin-audio-recorder-api';
import { backend, addCloseHandler } from '@/lib/tauri-bridge';
import { removePath } from '@/lib/native/fs';

async function freshRecorder() {
  vi.resetModules();
  const mod = await import('../useAudioRecorder.js');
  return mod.useAudioRecorder();
}

describe('useAudioRecorder singleton', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    checkPermission.mockResolvedValue({ granted: true, canRequest: true });
    startRecording.mockResolvedValue({});
    stopRecording.mockResolvedValue({ filePath: '/app/assets/n1/abc.wav' });
    getStatus.mockResolvedValue({ state: 'idle', durationMs: 0 });
    backend.invoke.mockResolvedValue();
    isIOSRuntimeMock.mockReturnValue(false);
  });

  it('tracks the target note and exposes recording state', async () => {
    const rec = await freshRecorder();
    await rec.start('n1', 42);

    expect(rec.targetNoteId.value).toBe('n1');
    expect(rec.isRecording.value).toBe(true);
    expect(rec.isPaused.value).toBe(false);
  });

  it('records the cursor position captured at start', async () => {
    const rec = await freshRecorder();
    await rec.start('n1', 7);

    const payload = await rec.stop();
    expect(payload.cursorPos).toBe(7);
  });

  it('writes the recording into the note assets directory', async () => {
    const rec = await freshRecorder();
    await rec.start('n1', 0);

    expect(backend.invoke).toHaveBeenCalledWith('fs:ensureDir', '/app/assets/n1');
    const [config] = startRecording.mock.calls[0];
    expect(config.outputPath).toMatch(/^\/app\/assets\/n1\/[0-9]+_[a-z0-9]+$/);
    expect(config.quality).toBe('medium');
  });

  it('does not start when microphone permission is denied', async () => {
    checkPermission.mockResolvedValue({ granted: false, canRequest: false });

    const rec = await freshRecorder();
    await rec.start('n1', 0);

    expect(rec.isRecording.value).toBe(false);
    expect(startRecording).not.toHaveBeenCalled();
  });

  it('alerts the user when microphone permission is denied', async () => {
    checkPermission.mockResolvedValue({ granted: false, canRequest: false });

    const rec = await freshRecorder();
    await rec.start('n1', 0);

    expect(dialogAlertMock).toHaveBeenCalledWith({
      title: 'Microphone access needed',
      body: 'Allow microphone access to record audio notes.',
      okText: 'OK',
    });
    expect(startRecording).not.toHaveBeenCalled();
  });

  it('removes the orphaned file when no handler consumes the stop payload', async () => {
    const rec = await freshRecorder();
    rec.onStopped(() => {});

    await rec.start('n1', 0);
    const payload = await rec.stop();

    expect(removePath).toHaveBeenCalledWith('/app/assets/n1/abc.wav');
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

  it('allows only one recording at a time', async () => {
    const rec = await freshRecorder();
    await rec.start('n1', 0);
    await rec.start('n2', 10);

    expect(startRecording).toHaveBeenCalledTimes(1);
    expect(rec.targetNoteId.value).toBe('n1');
  });

  it('stop resolves the file path and fires onStopped subscribers', async () => {
    const rec = await freshRecorder();
    const cb = vi.fn();
    rec.onStopped(cb);

    await rec.start('n1', 3);
    const payload = await rec.stop();

    expect(payload).toEqual({
      filePath: '/app/assets/n1/abc.wav',
      noteId: 'n1',
      cursorPos: 3,
    });
    expect(cb).toHaveBeenCalledWith(payload);
    expect(rec.isRecording.value).toBe(false);
    expect(rec.targetNoteId.value).toBe(null);
  });

  it('onStopped unsubscribe prevents the callback from firing', async () => {
    const rec = await freshRecorder();
    const cb = vi.fn();
    const off = rec.onStopped(cb);
    off();

    await rec.start('n1', 0);
    await rec.stop();

    expect(cb).not.toHaveBeenCalled();
  });

  it('pauseResume toggles pause state via the native recorder', async () => {
    const rec = await freshRecorder();
    await rec.start('n1', 0);

    await rec.pauseResume();
    expect(rec.isPaused.value).toBe(true);
    expect(pauseRecording).toHaveBeenCalled();

    await rec.pauseResume();
    expect(rec.isPaused.value).toBe(false);
    expect(resumeRecording).toHaveBeenCalled();
  });

  it('stop with a failed native stop clears state and fires nothing', async () => {
    stopRecording.mockRejectedValue(new Error('boom'));

    const rec = await freshRecorder();
    const cb = vi.fn();
    rec.onStopped(cb);

    await rec.start('n1', 0);
    const payload = await rec.stop();

    expect(payload).toBeNull();
    expect(cb).not.toHaveBeenCalled();
    expect(rec.isRecording.value).toBe(false);
    expect(rec.targetNoteId.value).toBe(null);
  });

  it('formattedTime starts at zero', async () => {
    const rec = await freshRecorder();
    await rec.start('n1', 0);

    expect(rec.formattedTime.value).toBe('00:00');
  });

  it('registers a window close handler to stop and clean up', async () => {
    await freshRecorder();
    expect(addCloseHandler).toHaveBeenCalled();
  });
});
