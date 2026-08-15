import ActivityKit
import SwiftUI
import WidgetKit

/// Entry point for the widget extension that renders the recording Live Activity.
///
/// This bundle is intended for a dedicated widget extension target in the
/// generated Xcode project (`gen/apple`). The app target itself only talks to
/// ActivityKit through `LiveActivityPlugin`; rendering belongs to this bundle.
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
