import ActivityKit
import Foundation

@available(iOS 16.2, *)
struct TPVRoomActivityAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable {
        let title: String
        let artist: String
        let singer: String
        let paused: Bool
        let progress: Int?
    }

    let room: String
}
