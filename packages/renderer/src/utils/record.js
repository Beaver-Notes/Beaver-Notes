import { ref, computed, onUnmounted } from 'vue';
import RecordRTC from 'recordrtc';

function useAudioRecorder(props, ipcRenderer, storage, path) {
  const isRecording = ref(false);
  const isPaused = ref(false);
  const minutes = ref(0);
  const seconds = ref(0);

  let recorder = null;
  let stream = null;
  let recordingInterval = null;
  let recordingStartTime = null;
  let totalPausedTime = 0;
  let pauseStartTime = null;

  const formattedTime = computed(() => {
    return `${String(minutes.value).padStart(2, '0')}:${String(
      seconds.value
    ).padStart(2, '0')}`;
  });

  function generateRandomFilename(extension = 'ogg') {
    const randomString = Math.random().toString(36).substring(2, 15);
    const timestamp = Date.now();
    return `${timestamp}_${randomString}.${extension}`;
  }

  function updateElapsedTime() {
    if (isRecording.value && !isPaused.value) {
      const now = Date.now();
      const rawElapsedTime = now - recordingStartTime - totalPausedTime;
      const elapsedSeconds = Math.floor(rawElapsedTime / 1000);
      minutes.value = Math.floor(elapsedSeconds / 60);
      seconds.value = elapsedSeconds % 60;
    }
  }

  async function toggleRecording() {
    if (isRecording.value) {
      recorder.stopRecording(async () => {
        const blob = recorder.getBlob();
        const filename = generateRandomFilename('ogg');
        await handleBlob(blob, filename);
        cleanup();
      });
      isRecording.value = false;
      isPaused.value = false;
      clearInterval(recordingInterval);
      recordingInterval = null;

      // Reset timing variables
      recordingStartTime = null;
      totalPausedTime = 0;
      pauseStartTime = null;
      minutes.value = 0;
      seconds.value = 0;
    } else {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: false,
        });
        recorder = RecordRTC(stream, {
          type: 'audio',
          mimeType: 'audio/ogg',
          recorderType: RecordRTC.StereoAudioRecorder,
        });
        recorder.startRecording();
        isRecording.value = true;
        isPaused.value = false;

        // Initialize timing variables
        recordingStartTime = Date.now();
        totalPausedTime = 0;
        pauseStartTime = null;

        recordingInterval = setInterval(updateElapsedTime, 1000);
      } catch (err) {
        console.error('Error accessing media devices.', err);
      }
    }
  }

  function pauseResume() {
    if (!recorder || !isRecording.value) return;

    if (isPaused.value) {
      // Resuming - calculate how long we were paused and add to total
      if (pauseStartTime) {
        totalPausedTime += Date.now() - pauseStartTime;
        pauseStartTime = null;
      }
      recorder.resumeRecording();
      isPaused.value = false;
    } else {
      // Pausing - mark when we started the pause
      pauseStartTime = Date.now();
      recorder.pauseRecording();
      isPaused.value = true;
    }
  }

  async function handleBlob(blob, filename) {
    const dataDir = await storage.get('dataDir');
    const assetsPath = path.join(dataDir, 'file-assets', props.id);
    await ipcRenderer.callMain('fs:ensureDir', assetsPath);
    const destPath = path.join(assetsPath, filename);
    const contentUint8Array = await readFile(blob);
    await ipcRenderer.callMain('fs:writeFile', {
      path: destPath,
      data: contentUint8Array,
    });
    const audioPath = `file-assets://${props.id}/${filename}`;
    props.editor.commands.setAudio(audioPath);
  }

  function readFile(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(new Uint8Array(reader.result));
      reader.onerror = reject;
      reader.readAsArrayBuffer(blob);
    });
  }

  function cleanup() {
    if (recordingInterval) clearInterval(recordingInterval);
    if (recorder) {
      if (recorder.stream) {
        recorder.stream.getTracks().forEach((track) => track.stop());
        recorder.stream = null;
      }
      if (typeof recorder.destroy === 'function') recorder.destroy();
      recorder = null;
    }
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      stream = null;
    }
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
