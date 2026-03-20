import { ref, computed, onUnmounted } from 'vue';
import {
  checkPermission,
  getStatus,
  pauseRecording,
  requestPermission,
  resumeRecording,
  startRecording,
  stopRecording,
} from 'tauri-plugin-audio-recorder-api';

function useAudioRecorder(props, backend, storage, path) {
  const isRecording = ref(false);
  const isPaused = ref(false);
  const minutes = ref(0);
  const seconds = ref(0);

  let statusInterval = null;

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

  async function toggleRecording() {
    if (isRecording.value) {
      try {
        const result = await stopRecording();
        stopStatusPolling();
        resetState();

        if (result?.filePath) {
          const filename = path.basename(result.filePath);
          const audioPath = `file-assets://${props.id}/${filename}`;
          props.editor.commands.setAudio(audioPath);
        }
      } catch (error) {
        console.error('Failed to stop recording.', error);
      }
      return;
    }

    try {
      const hasPermission = await ensurePermission();
      if (!hasPermission) {
        console.error('Microphone permission denied.');
        return;
      }

      const dataDir = await storage.get('dataDir');
      const assetsPath = path.join(dataDir, 'file-assets', props.id);
      await backend.invoke('fs:ensureDir', assetsPath);

      await startRecording({
        outputPath: path.join(assetsPath, generateRecordingStem()),
        quality: 'medium',
        maxDuration: 0,
      });

      isRecording.value = true;
      isPaused.value = false;
      setElapsedTime(0);
      startStatusPolling();
    } catch (error) {
      console.error('Failed to start recording.', error);
      resetState();
      stopStatusPolling();
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

  onUnmounted(cleanup);

  return {
    isRecording,
    isPaused,
    formattedTime,
    toggleRecording,
    pauseResume,
  };
}

export default useAudioRecorder;
