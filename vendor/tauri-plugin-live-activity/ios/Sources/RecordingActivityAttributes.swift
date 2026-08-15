import ActivityKit

/// Attributes of the recording Live Activity. Shared by the app (which starts,
/// updates and ends the activity) and the widget extension (which renders it).
struct RecordingActivityAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        /// Elapsed recording time in seconds (rounded down).
        var timeSeconds: Int
        /// True while the recorder is paused.
        var isPaused: Bool
    }

    /// The note being recorded, shown in the activity's expanded views.
    var title: String
}
