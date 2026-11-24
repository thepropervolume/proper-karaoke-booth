# Booth mobile requirements and status

The mobile app is a singer companion. A singer can plan a set in the public catalogs, save versions to playlists, and join a desktop-hosted karaoke room to request a turn. The desktop remains responsible for playback, media, approval, and rotation. Standalone mobile hosting is paused.

## Framework

Ionic React and Capacitor share one singer workspace across iOS, Android, and the mobile web app. The interface uses the same guest admission and request client as the browser portal, with native DNS-SD discovery where available. [Ionic platform styling](https://ionicframework.com/docs/core-concepts/fundamentals) · [Capacitor](https://capacitorjs.com/docs/)

## Requirements and status

| Area | Requirements and 0.10.18 beta status |
| --- | --- |
| Browse Mode | Start with Welcome, then use Search for title and artist in the public Karaoke Nerds catalog by default. More Karaoke Nerds Results pages through the shared snapshot, including matches beyond the first 50. Public KaraFun CSV and Party Tyme Pro songbook metadata are optional sources. No playback action is offered in Browse Mode. |
| Source choices | Let singers choose public catalogs in Account without provider credentials. After visiting a room, remember the host’s sources that have a public equivalent. Keep the browse choices distinct from the live host’s request policy and any paid catalog access. |
| Join | Accept an internet room code or invitation link, show the last room for quick re-entry and ask before joining a nearby suggestion. Native DNS-SD and same-egress suggestions find relay rooms. LAN-only use hands a trusted local HTTPS invitation to the browser on the host’s network. Native discovery and venue networking still need physical-phone coverage. |
| Connected search | Search the host library and currently enabled, supported provider sources. Respect room policy, source changes, and blacklists. Keep result grants scoped to the guest. A desktop host running 0.10.13 can supply further Karaoke Nerds pages to both local and internet rooms when the singer selects Load More Songs. |
| Requests | Queue the chosen host result, see the request status, withdraw eligible requests, or ask for a song the host lacks. Preserve guest request recovery after connection loss. Applause, photo submission, and temporary absence remain room actions. |
| Account and playlists | Guest entry stays available. Email-first Booth accounts use password sign-in, email verification and optional sign-in and reset links when the queue account service is enabled. Room admission continues to use a display name. Starred Songs and named playlists remain device-local. **Find in Room** searches for an available recording. |
| Playback status | Queue and Now Playing show a scoped, read-only projection from compatible desktop hosts. Earlier hosts still accept requests and show the singer’s own request state. |
| Launch | iOS uses the centered homepage blocks and navy stage haze. The Android system launch uses the offset blocks on solid navy. The blocks are reserved for launch. |
| Hosting boundary | Hide the former Full Host workspace, transport, import, and room creation from the mobile app. Retain its source code and earlier show records for future work. Current mobile sessions request changes only through the host. |
| Phone accessibility | Verify one-handed controls, safe areas, text scaling, VoiceOver, TalkBack, reduced motion, contrast, keyboard behavior, and system Back. Target 44 pt on iOS and 48 dp on Android. [Apple touch targets](https://developer.apple.com/design/tips/) · [Android touch targets](https://developer.android.com/guide/topics/ui/accessibility/views/apps-views) |
| Distribution | Deliver signed TestFlight and Google Play test builds from the same source commit and public version. Hold a coordinated public launch until both stores are ready. [Store process](releasing.md#coordinate-ios-and-android-store-releases) |

## Verification and next steps

1. Exercise a complete desktop-to-phone show on real iPhones and Android phones. Cover internet invites, a denied discovery permission, the LAN invitation handoff, changing enabled sources mid-room, losing the venue connection, and finding a saved song after leaving.
2. Compare provider results with the host on the same search. Test Karaoke Nerds pagination against the deployed snapshot and distinguish public Party Tyme Pro from a host’s authenticated Consumer catalog. Confirm rooms can request only an active host result.
3. Improve glanceable request status and room recovery, then test large text and the native keyboard. Consider QR invitations, the system share sheet, and opted-in upcoming-turn alerts.
4. Complete device signing, TestFlight and Play testing, and the linked store release checks. [iOS guide](store-ios.md) · [Android guide](store-android.md)

The older browser rehearsals and native compile checks are recorded in the [QA reports](qa/mobile-090-summary.md). They cover earlier Full Host versions as well as guest requests. Signed handset builds and real-device acceptance for the redesigned singer workspace remain open.
