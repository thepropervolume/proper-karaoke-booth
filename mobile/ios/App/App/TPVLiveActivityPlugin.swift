import ActivityKit
import Capacitor
import Foundation
import UIKit

@objc(TPVLiveActivityPlugin)
public class TPVLiveActivityPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "TPVLiveActivityPlugin"
    public let jsName = "TPVLiveActivity"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "status", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "update", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clear", returnType: CAPPluginReturnPromise)
    ]

    @objc func status(_ call: CAPPluginCall) {
        call.resolve(["status": currentStatus()])
    }

    @objc func update(_ call: CAPPluginCall) {
        guard #available(iOS 16.2, *), currentStatus() == "available" else {
            call.resolve(["status": currentStatus()])
            return
        }

        let title = text(call, "title", limit: 110)
        guard !title.isEmpty else {
            call.reject("Now Playing needs a track title.")
            return
        }
        let room = text(call, "room", limit: 80)
        let progress = call.getInt("progress").flatMap { (0...100).contains($0) ? $0 : nil }
        let state = TPVRoomActivityAttributes.ContentState(
            title: title, artist: text(call, "artist", limit: 85), singer: text(call, "singer", limit: 85),
            paused: call.getBool("paused") ?? false, progress: progress)

        Task { @MainActor in
            // A suspended WebView can't supply room updates. ActivityKit marks this
            // snapshot stale after the last local update, even when Booth is locked.
            let content = ActivityContent(state: state, staleDate: Date().addingTimeInterval(75))
            var existing: Activity<TPVRoomActivityAttributes>?
            for activity in Activity<TPVRoomActivityAttributes>.activities {
                if activity.attributes.room == room && existing == nil {
                    existing = activity
                } else {
                    await activity.end(nil, dismissalPolicy: .immediate)
                }
            }
            if let existing {
                await existing.update(content)
            } else {
                guard UIApplication.shared.applicationState == .active else {
                    call.resolve(["status": "blocked"])
                    return
                }
                do {
                    // This bridge has no APNs token or server registration.
                    _ = try Activity.request(attributes: TPVRoomActivityAttributes(room: room),
                                             content: content, pushType: nil)
                } catch {
                    call.resolve(["status": "blocked"])
                    return
                }
            }
            call.resolve(["status": "available"])
        }
    }

    @objc func clear(_ call: CAPPluginCall) {
        guard #available(iOS 16.2, *) else { call.resolve(); return }
        Task { @MainActor in
            for activity in Activity<TPVRoomActivityAttributes>.activities {
                await activity.end(nil, dismissalPolicy: .immediate)
            }
            call.resolve()
        }
    }

    private func currentStatus() -> String {
        guard #available(iOS 16.2, *) else { return "unsupported" }
        return ActivityAuthorizationInfo().areActivitiesEnabled ? "available" : "blocked"
    }

    private func text(_ call: CAPPluginCall, _ key: String, limit: Int) -> String {
        let value = call.getString(key) ?? ""
        let clean = value.unicodeScalars.prefix(limit).map {
            CharacterSet.controlCharacters.contains($0) ? " " : String($0)
        }.joined()
        return clean.trimmingCharacters(in: .whitespacesAndNewlines)
    }
}
