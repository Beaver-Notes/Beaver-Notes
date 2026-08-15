import ActivityKit
import SwiftUI
import WidgetKit

/// Brand amber for the recording accent (`#FF9F0A`).
///
/// The accent is scoped to the Live Activity views — the app's own accent color
/// is deliberately left untouched.
enum RecordingActivityAccent {
    static let amber = Color(red: 1.0, green: 0.6235, blue: 0.0392)
}

@available(iOS 16.1, *)
func recordingActivityTimeText(_ seconds: Int) -> String {
    String(format: "%02d:%02d", seconds / 60, seconds % 60)
}

/// Static waveform graphic.
///
/// ActivityKit forbids custom animated views, so the bars are static snapshots.
/// The bar slice is derived from `timeSeconds`, so every content update re-draws
/// a different section of the waveform and the timer's numeric transitions stay
/// smooth while nothing actually animates.
@available(iOS 16.1, *)
struct RecordingWaveformBars: View {
    let timeSeconds: Int
    let isPaused: Bool

    private static let amplitudes: [CGFloat] = [
        0.35, 0.85, 0.5, 1.0, 0.6, 0.4, 0.9, 0.55, 0.75, 0.45, 0.95, 0.6,
    ]
    private static let barCount = 9

    var body: some View {
        HStack(alignment: .center, spacing: 3) {
            ForEach(0..<Self.barCount, id: \.self) { index in
                Capsule()
                    .fill(
                        isPaused
                            ? Color.secondary.opacity(0.5)
                            : RecordingActivityAccent.amber
                    )
                    .frame(
                        width: 3,
                        height: 16 * Self.amplitudes[
                            (index + timeSeconds) % Self.amplitudes.count
                        ]
                    )
            }
        }
        .frame(height: 16)
    }
}

/// Pause/resume affordance. Live Activity lock-screen controls are only
/// interactive on iOS 26+ via App Intents; on earlier systems these render as
/// visual indicators that mirror the recorder state.
@available(iOS 16.1, *)
struct RecordingPauseIndicator: View {
    let isPaused: Bool

    var body: some View {
        Image(systemName: isPaused ? "play.fill" : "pause.fill")
            .font(.system(size: 14, weight: .semibold))
            .foregroundStyle(RecordingActivityAccent.amber)
    }
}

/// Stop affordance (see `RecordingPauseIndicator` for the interactivity note).
@available(iOS 16.1, *)
struct RecordingStopIndicator: View {
    var body: some View {
        Image(systemName: "stop.fill")
            .font(.system(size: 14, weight: .semibold))
            .foregroundStyle(RecordingActivityAccent.amber)
    }
}

/// Lock screen + notification banner presentation.
@available(iOS 16.1, *)
struct RecordingActivityLiveActivityView: View {
    let context: ActivityViewContext<RecordingActivityAttributes>

    var body: some View {
        HStack(spacing: 16) {
            RecordingWaveformBars(
                timeSeconds: context.state.timeSeconds,
                isPaused: context.state.isPaused
            )
            .frame(width: 56)

            VStack(alignment: .leading, spacing: 4) {
                Text(context.attributes.title)
                    .font(.subheadline.weight(.semibold))
                    .lineLimit(1)
                Text(recordingActivityTimeText(context.state.timeSeconds))
                    .font(.system(.title2, design: .rounded).monospacedDigit())
                    .contentTransition(.numericText())
            }

            Spacer()

            HStack(spacing: 12) {
                RecordingPauseIndicator(isPaused: context.state.isPaused)
                RecordingStopIndicator()
            }
        }
        .padding(16)
        .activityBackgroundTint(Color(red: 0.06, green: 0.06, blue: 0.08))
    }
}

/// Dynamic Island presentation: an amber dot when contracted, a timer + waveform
/// with pause/stop when expanded.
///
/// Rendered with the current WidgetKit `DynamicIsland` API (iOS 26 SDK). The
/// previous protocol-based API (`DynamicIslandBody`, `CompactDynamicIslandContent`,
/// ...) was removed from the SDK; the two render identically, so supporting
/// iOS 16.1-25 would require conditionally compiling that legacy shape.
@available(iOS 16.1, *)
struct RecordingActivityDynamicIsland {
    let context: ActivityViewContext<RecordingActivityAttributes>

    private var amberDot: some View {
        Circle()
            .fill(RecordingActivityAccent.amber)
            .frame(width: 10, height: 10)
    }

    var body: WidgetKit.DynamicIsland {
        DynamicIsland(
            expanded: {
                DynamicIslandExpandedRegion(.leading) {
                    HStack(spacing: 6) {
                        amberDot
                        Text(context.attributes.title)
                            .font(.subheadline.weight(.semibold))
                            .lineLimit(1)
                    }
                }
                DynamicIslandExpandedRegion(.trailing) {
                    Text(recordingActivityTimeText(context.state.timeSeconds))
                        .font(.system(.title3, design: .rounded).monospacedDigit())
                        .contentTransition(.numericText())
                }
                DynamicIslandExpandedRegion(.bottom) {
                    HStack {
                        RecordingWaveformBars(
                            timeSeconds: context.state.timeSeconds,
                            isPaused: context.state.isPaused
                        )
                        Spacer()
                        RecordingPauseIndicator(isPaused: context.state.isPaused)
                        RecordingStopIndicator()
                    }
                    .padding(.horizontal, 8)
                    .padding(.bottom, 4)
                }
            },
            compactLeading: {
                amberDot
            },
            compactTrailing: {
                Text(recordingActivityTimeText(context.state.timeSeconds))
                    .font(.system(.caption2, design: .rounded).monospacedDigit())
                    .contentTransition(.numericText())
            },
            minimal: {
                amberDot
            }
        )
    }
}
