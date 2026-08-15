import ActivityKit
import Tauri
import UIKit
import WebKit

/// Payload for `live_activity_start`.
struct LiveActivityStartPayload: Decodable {
    let title: String
}

/// Payload for `live_activity_update`.
struct LiveActivityUpdatePayload: Decodable {
    let timeSeconds: Int
    let isPaused: Bool
}

/// Tauri plugin that mirrors the audio recorder into an iOS Live Activity.
///
/// The frontend drives these commands from `useAudioRecorder`, gated behind
/// `isIOSRuntime()`. Rendering happens through the widget extension registered
/// by `RecordingActivityWidgetBundle`.
@available(iOS 16.1, *)
class LiveActivityPlugin: Plugin {
    private var activity: Activity<RecordingActivityAttributes>?

    /// Starts a new Live Activity for the recording, carrying the note title.
    @objc public func live_activity_start(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(LiveActivityStartPayload.self)
        let attributes = RecordingActivityAttributes(title: args.title)
        let initialState = RecordingActivityAttributes.ContentState(timeSeconds: 0, isPaused: false)

        // The `content:` request overload is gated to iOS 16.2 in the current
        // SDK; the `contentState:` variant is the iOS 16.1 entry point (deprecated
        // in 16.2 only because Apple prefers the richer `ActivityContent` form).
        let activity: Activity<RecordingActivityAttributes>
        do {
            activity = try Activity.request(
                attributes: attributes,
                contentState: initialState,
                pushType: nil
            )
        } catch {
            invoke.reject("Failed to start the Live Activity: \(error.localizedDescription)")
            return
        }

        self.activity = activity
        invoke.resolve()
    }

    /// Pushes a new snapshot of the recording time and pause state.
    @objc public func live_activity_update(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(LiveActivityUpdatePayload.self)
        guard let activity = self.activity else {
            invoke.reject("No active recording Live Activity")
            return
        }

        let state = RecordingActivityAttributes.ContentState(
            timeSeconds: args.timeSeconds,
            isPaused: args.isPaused
        )
        Task {
            await activity.update(using: state)
            invoke.resolve()
        }
    }

    /// Ends the Live Activity for the recording.
    @objc public func live_activity_end(_ invoke: Invoke) throws {
        guard let activity = self.activity else {
            invoke.resolve()
            return
        }

        let state = activity.contentState
        self.activity = nil
        Task {
            await activity.end(using: state, dismissalPolicy: .immediate)
            invoke.resolve()
        }
    }
}

/// No-op fallback so the plugin can still register on iOS < 16.1.
class UnsupportedLiveActivityPlugin: Plugin {
    @objc public func live_activity_start(_ invoke: Invoke) throws {
        invoke.reject("Live Activities require iOS 16.1 or later")
    }

    @objc public func live_activity_update(_ invoke: Invoke) throws {
        invoke.reject("Live Activities require iOS 16.1 or later")
    }

    @objc public func live_activity_end(_ invoke: Invoke) throws {
        invoke.reject("Live Activities require iOS 16.1 or later")
    }
}

@_cdecl("init_plugin_live_activity")
func initPlugin() -> Plugin {
    if #available(iOS 16.1, *) {
        return LiveActivityPlugin()
    }
    return UnsupportedLiveActivityPlugin()
}
