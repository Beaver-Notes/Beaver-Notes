/// iOS Live Activity mirror for the audio recorder (R5).
///
/// The frontend drives these commands from `useAudioRecorder`, gated behind
/// `isIOSRuntime()` so desktop is never affected. On non-iOS targets they are
/// no-ops. On iOS they are stubs for now: the real ActivityKit sink lives in
/// the Swift plugin under `src-tauri/ios` (`live_activity_start/update/end`),
/// which is wired into the iOS build as a manual step (see the task report).
#[tauri::command]
pub(crate) fn live_activity_start(title: String) -> Result<(), String> {
    #[cfg(target_os = "ios")]
    {
        let _ = title;
        Ok(())
    }

    #[cfg(not(target_os = "ios"))]
    {
        let _ = title;
        Ok(())
    }
}

#[tauri::command]
pub(crate) fn live_activity_update(
    time_seconds: u64,
    is_paused: bool,
) -> Result<(), String> {
    #[cfg(target_os = "ios")]
    {
        let _ = (time_seconds, is_paused);
        Ok(())
    }

    #[cfg(not(target_os = "ios"))]
    {
        let _ = (time_seconds, is_paused);
        Ok(())
    }
}

#[tauri::command]
pub(crate) fn live_activity_end() -> Result<(), String> {
    #[cfg(target_os = "ios")]
    {
        Ok(())
    }

    #[cfg(not(target_os = "ios"))]
    {
        Ok(())
    }
}
