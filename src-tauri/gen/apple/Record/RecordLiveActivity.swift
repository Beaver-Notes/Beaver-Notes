//
//  RecordLiveActivity.swift
//  Record
//
//  Created by Daniele Rolli on 8/15/26.
//

import ActivityKit
import WidgetKit
import SwiftUI

struct RecordAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        // Dynamic stateful properties about your activity go here!
        var emoji: String
    }

    // Fixed non-changing properties about your activity go here!
    var name: String
}

struct RecordLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: RecordAttributes.self) { context in
            // Lock screen/banner UI goes here
            VStack {
                Text("Hello \(context.state.emoji)")
            }
            .activityBackgroundTint(Color.cyan)
            .activitySystemActionForegroundColor(Color.black)

        } dynamicIsland: { context in
            DynamicIsland {
                // Expanded UI goes here.  Compose the expanded UI through
                // various regions, like leading/trailing/center/bottom
                DynamicIslandExpandedRegion(.leading) {
                    Text("Leading")
                }
                DynamicIslandExpandedRegion(.trailing) {
                    Text("Trailing")
                }
                DynamicIslandExpandedRegion(.bottom) {
                    Text("Bottom \(context.state.emoji)")
                    // more content
                }
            } compactLeading: {
                Text("L")
            } compactTrailing: {
                Text("T \(context.state.emoji)")
            } minimal: {
                Text(context.state.emoji)
            }
            .widgetURL(URL(string: "http://www.apple.com"))
            .keylineTint(Color.red)
        }
    }
}

extension RecordAttributes {
    fileprivate static var preview: RecordAttributes {
        RecordAttributes(name: "World")
    }
}

extension RecordAttributes.ContentState {
    fileprivate static var smiley: RecordAttributes.ContentState {
        RecordAttributes.ContentState(emoji: "😀")
     }
     
     fileprivate static var starEyes: RecordAttributes.ContentState {
         RecordAttributes.ContentState(emoji: "🤩")
     }
}

#Preview("Notification", as: .content, using: RecordAttributes.preview) {
   RecordLiveActivity()
} contentStates: {
    RecordAttributes.ContentState.smiley
    RecordAttributes.ContentState.starEyes
}
