import ActivityKit
import RecordingActivityShared
import SwiftUI
import WidgetKit

/// Entry point for the widget extension that renders the recording Live Activity.
///
/// This bundle belongs to the `RecordExtension` target (`gen/apple/Record`).
/// The app target only talks to ActivityKit through `LiveActivityPlugin`;
/// rendering lives here.
@available(iOS 16.1, *)
struct RecordingActivityWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: RecordingActivityAttributes.self) { context in
            RecordingActivityLiveActivityView(context: context)
        } dynamicIsland: { context in
            RecordingActivityDynamicIsland(context: context).body
        }
    }
}

@available(iOS 16.1, *)
@main
struct RecordingActivityWidgetBundle: WidgetBundle {
    var body: some Widget {
        RecordingActivityWidget()
    }
}
