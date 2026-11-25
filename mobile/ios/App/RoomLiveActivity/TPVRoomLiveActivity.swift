import ActivityKit
import SwiftUI
import WidgetKit

@main
struct TPVRoomLiveActivity: Widget {
    private let accent = Color(red: 14 / 255, green: 183 / 255, blue: 1)
    private let navy = Color(red: 9 / 255, green: 14 / 255, blue: 24 / 255)

    var body: some WidgetConfiguration {
        ActivityConfiguration(for: TPVRoomActivityAttributes.self) { context in
            VStack(alignment: .leading, spacing: 8) {
                Label(context.attributes.room.isEmpty ? "Karaoke Booth" : context.attributes.room,
                      systemImage: "waveform")
                    .font(.caption.weight(.semibold))
                    .lineLimit(1)
                    .foregroundStyle(accent)
                details(context)
            }
            .padding(16)
            .activityBackgroundTint(navy)
            .activitySystemActionForegroundColor(.white)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Image(systemName: "waveform")
                        .foregroundStyle(accent)
                        .accessibilityLabel("Karaoke Booth")
                }
                DynamicIslandExpandedRegion(.trailing) {
                    Text(status(context)).font(.caption).foregroundStyle(accent)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    details(context, showStatus: false)
                }
            } compactLeading: {
                Image(systemName: "waveform")
                    .foregroundStyle(accent)
                    .accessibilityLabel("Karaoke Booth")
            } compactTrailing: {
                Image(systemName: context.isStale ? "clock" : context.state.paused ? "pause" : "music.note")
                    .foregroundStyle(accent)
                    .accessibilityLabel(status(context))
            } minimal: {
                Image(systemName: "waveform")
                    .foregroundStyle(accent)
                    .accessibilityLabel(status(context))
            }
            .keylineTint(accent)
        }
    }

    private func status(_ context: ActivityViewContext<TPVRoomActivityAttributes>) -> String {
        if context.isStale { return "Last updated in Booth" }
        return context.state.paused ? "Paused" : "Now Playing"
    }

    private func details(_ context: ActivityViewContext<TPVRoomActivityAttributes>, showStatus: Bool = true) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(context.state.title)
                .font(.headline)
                .foregroundStyle(.white)
                .lineLimit(2)
            if !context.state.artist.isEmpty {
                Text(context.state.artist).font(.caption).foregroundStyle(.white.opacity(0.82)).lineLimit(1)
            }
            if !context.state.singer.isEmpty {
                Text("Sung by \(context.state.singer)").font(.caption).foregroundStyle(.white.opacity(0.82))
                    .lineLimit(1).privacySensitive()
            }
            if showStatus {
                Text(status(context)).font(.caption2).foregroundStyle(accent)
            }
            if !context.isStale, let progress = context.state.progress {
                ProgressView(value: Double(progress), total: 100)
                    .tint(accent)
                    .accessibilityLabel("Song progress")
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
