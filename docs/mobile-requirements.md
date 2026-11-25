# Booth mobile requirements and status

The mobile app is a singer companion. A singer can plan a set in the public catalogs, save versions to playlists, and join a desktop-hosted karaoke room to request a turn. The desktop remains responsible for playback, media, approval, and rotation. Standalone mobile hosting is paused.

## Framework

Ionic React and Capacitor share one singer workspace across iOS, Android, and the mobile web app. The interface uses the same guest admission and request client as the browser portal, with native DNS-SD discovery where available. [Ionic platform styling](https://ionicframework.com/docs/core-concepts/fundamentals) · [Capacitor](https://capacitorjs.com/docs/)

## Requirements and status

| Area | Requirements and 0.10.19 candidate status |
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

## Changes in 0.10.19

- The compact player opens Now Playing with the host’s current song, singer, and progress. Singers can applaud, star the current recording, or add it to a playlist.
- Rooms can share an internet invitation through the device share sheet. Custom karaoke requests open the existing website form. Photo casting follows the host’s room setting and holds the image in show memory.
- The private singing profile supports a photo, pronouns and bio after the account schema is applied. Playlists includes completed requests seen on this device. Stage avatars and shared performance history remain open.
- Native local alerts can follow queue position, Wi-Fi discovery and availability while Booth receives updates. Android has ongoing status. The separate iOS Live Activity requires signing. APNs and FCM delivery while Booth is suspended remains pending.

## Planned payments and identity

| Offer | Proposed US price and fulfillment |
| --- | --- |
| Applause pack | $1 for 100 credits. Preserve the purchased balance across shows and enforce host applause settings and audio limits. |
| Custom karaoke | $20 for one request or $50 for three. Reserve a credit when the request is accepted by the shared production intake and track fulfillment there. |
| Jump the line | $5 at most once per verified account per calendar month in UTC. Confirm the eligible room and reserve its promotion before purchase. The host authorizes the move and protects the song in progress. |
| Singer subscription | Consider extra queue slots and applause where the host opts in. Include one or two fulfilled requests each month only if production can meet that commitment. |
| Host subscription | Consider advanced room management, back-office moderation and staff permissions. Subscriber hosting on mobile needs a separate design and authorization model. |

Use StoreKit and Google Play Billing for in-app digital purchases under applicable store rules. Evaluate Stripe for desktop and web plans. Verify transactions on the server, grant each purchase exactly once, preserve balances across devices, restore eligible purchases and reconcile refunds and subscription expiry. Start with store test products. [Apple’s payment rules](https://developer.apple.com/app-store/review/guidelines/#payments) · [Google Play’s payments policy](https://support.google.com/googleplay/android-developer/answer/9858738)

Facebook, Google and Apple sign-in require provider app registrations and private relay configuration. Use native or system-browser authorization, verify each provider’s identity and require proof of existing account ownership before linking. Webcam capture and delegated playback are future host features. Record only with explicit consent and use host-revocable room permissions for delegated controls.

## Verification and next steps

1. Exercise a complete desktop-to-phone show on real iPhones and Android phones. Cover internet invites, a denied discovery permission, the LAN invitation handoff, changing enabled sources mid-room, losing the venue connection, and finding a saved song after leaving.
2. Compare provider results with the host on the same search. Test Karaoke Nerds pagination against the deployed snapshot and distinguish public Party Tyme Pro from a host’s authenticated Consumer catalog. Confirm rooms can request only an active host result.
3. Test the native share sheet, notification permission, local alerts and lock screen on physical devices. Verify expiry after suspension and dismissal on room exit. Provision remote push and test devices for closed-app delivery.
4. Complete device signing, TestFlight and Play testing, and the linked store release checks. [iOS guide](store-ios.md) · [Android guide](store-android.md)

The older browser rehearsals and native compile checks are recorded in the [QA reports](qa/mobile-090-summary.md). They cover earlier Full Host versions as well as guest requests. Signed handset builds and real-device acceptance for the redesigned singer workspace remain open.
