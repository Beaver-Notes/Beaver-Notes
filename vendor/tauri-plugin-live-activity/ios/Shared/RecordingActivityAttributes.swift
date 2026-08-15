import ActivityKit

/// Attributes of the recording Live Activity. Lives in a shared library so the
/// app (which starts, updates and ends the activity) and the widget extension
/// (which renders it) resolve the SAME type — ActivityKit requires that.
public struct RecordingActivityAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        /// Elapsed recording time in seconds (rounded down).
        public var timeSeconds: Int
        /// True while the recorder is paused.
        public var isPaused: Bool

        public init(timeSeconds: Int, isPaused: Bool) {
            self.timeSeconds = timeSeconds
            self.isPaused = isPaused
        }
    }

    /// The note being recorded, shown in the activity's expanded views.
    public var title: String

    public init(title: String) {
        self.title = title
    }
}
