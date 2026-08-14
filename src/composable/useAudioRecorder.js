import { ref, computed } from 'vue';
import {
  checkPermission,
  getStatus,
  pauseRecording,
  requestPermission,
  resumeRecording,
  startRecording,
  stopRecording,
} from 'tauri-plugin-audio-recorder-api';
import { backend, path, addCloseHandler } from '@/lib/tauri-bridge';
import { getAppDirectory } from '@/lib/native/app';

// Module-scope singleton state: the recorder survives note navigation and
// stays alive until the recording is explicitly stopped.
const isRecording = ref(false);
const isPaused = ref(false);
const minutes = ref(0);
const seconds = ref(0);
const targetNoteId = ref(null);
const cursorPos = ref(null);

let statusInterval = null;
const stoppedCallbacks = new Set();
let closeHandlerBound = false;

const formattedTime = computed(() => {
  return `${String(minutes.value).padStart(2, '0')}:${String(
    seconds.value
  ).padStart(2, '0')}`;
});

function generateRecordingStem() {
  const randomString = Math.random().toString(36).slice(2, 15);
  const timestamp = Date.now();
  return `${timestamp}_${randomString}`;
}

function setElapsedTime(durationMs = 0) {
  const elapsedSeconds = Math.max(
    0,
    Math.floor(Number(durationMs || 0) / 1000)
  );
  minutes.value = Math.floor(elapsedSeconds / 60);
  seconds.value = elapsedSeconds % 60;
}

function resetState() {
  isRecording.value = false;
  isPaused.value = false;
  setElapsedTime(0);
  targetNoteId.value = null;
  cursorPos.value = null;
}

function stopStatusPolling() {
  if (statusInterval) {
    clearInterval(statusInterval);
    statusInterval = null;
  }
}

function startStatusPolling() {
  stopStatusPolling();
  statusInterval = setInterval(async () => {
    try {
      const status = await getStatus();
      isRecording.value = status.state !== 'idle';
      isPaused.value = status.state === 'paused';
      setElapsedTime(status.durationMs);

      if (status.state === 'idle') {
        stopStatusPolling();
      }
    } catch (error) {
      console.error('Failed to read recorder status.', error);
      stopStatusPolling();
    }
  }, 250);
}

async function ensurePermission() {
  const permission = await checkPermission();
  if (permission?.granted) return true;

  if (!permission?.canRequest) return false;

  const requested = await requestPermission();
  return Boolean(requested?.granted);
}

async function start(noteId, cursor = 0) {
  if (isRecording.value || !noteId) return;

  try {
    const hasPermission = await ensurePermission();
    if (!hasPermission) {
      console.error('Microphone permission denied.');
      return;
    }

    const appDirectory = await getAppDirectory();
    const assetsPath = path.join(appDirectory, 'assets', noteId);
    await backend.invoke('fs:ensureDir', assetsPath);

    await startRecording({
      outputPath: path.join(assetsPath, generateRecordingStem()),
      quality: 'medium',
      maxDuration: 0,
    });

    targetNoteId.value = noteId;
    cursorPos.value = cursor;
    isRecording.value = true;
    isPaused.value = false;
    setElapsedTime(0);
    startStatusPolling();
  } catch (error) {
    console.error('Failed to start recording.', error);
    stopStatusPolling();
    resetState();
  }
}

async function pauseResume() {
  if (!isRecording.value) return;

  try {
    if (isPaused.value) {
      await resumeRecording();
      isPaused.value = false;
    } else {
      await pauseRecording();
      isPaused.value = true;
    }
  } catch (error) {
    console.error('Failed to change recording state.', error);
  }
}

async function stop() {
  const noteId = targetNoteId.value;
  const cursor = cursorPos.value;

  if (!isRecording.value) return null;

  let filePath = null;
  try {
    const result = await stopRecording();
    filePath = result?.filePath || null;
  } catch (error) {
    console.error('Failed to stop recording.', error);
  }

  stopStatusPolling();
  resetState();

  if (filePath) {
    const payload = { filePath, noteId, cursorPos: cursor };
    stoppedCallbacks.forEach((callback) => {
      try {
        callback(payload);
      } catch (error) {
        console.error('Recording stop handler failed.', error);
      }
    });
    return payload;
  }
  return null;
}

function onStopped(callback) {
  stoppedCallbacks.add(callback);
  return () => stoppedCallbacks.delete(callback);
}

function cleanup() {
  stopStatusPolling();
  void getStatus()
    .then((status) => {
      if (status.state !== 'idle') {
        return stopRecording().catch(() => {});
      }
      return null;
    })
    .finally(() => {
      resetState();
    });
}

if (
  typeof window !== 'undefined' &&
  typeof addCloseHandler === 'function' &&
  !closeHandlerBound
) {
  closeHandlerBound = true;
  addCloseHandler(() => cleanup());
}

export function useAudioRecorder() {
  return {
    isRecording,
    isPaused,
    formattedTime,
    targetNoteId,
    start,
    pauseResume,
    stop,
    onStopped,
    cleanup,
  };
}
