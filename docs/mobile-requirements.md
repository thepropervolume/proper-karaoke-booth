# Booth mobile requirements and status

The mobile app should feel like the desktop Booth on a phone. A host should be able to search, queue a song, manage the rotation, and see what is playing without leaving the main workspace. A singer should be able to open an invitation, join, and request a song without setting up a show.

## Framework

**Use Ionic React for the mobile interface and keep Capacitor as the iOS and Android runtime.** Ionic gives us platform-aware navigation and controls within the existing React codebase. Capacitor provides the native host and access to platform APIs, including the existing room-discovery bridges. The same mobile interface also serves the web app. [Ionic platform styling](https://ionicframework.com/docs/core-concepts/fundamentals) · [Capacitor](https://capacitorjs.com/docs/)

Reuse the existing player, on-device show and video storage, and room protocol. Keep platform-specific work at the edges for safe areas, system back, sharing, permissions, and playback lifecycle. React Native provides platform-backed views. Moving there now would require rebuilding the current web screens and adapting playback, storage, and browser delivery. Reconsider it if real devices show a specific limitation of the Capacitor approach. [React Native components](https://reactnative.dev/docs/intro-react-native-components)

## Requirements for the first phone beta

| Area | What a host or singer should be able to do |
| --- | --- |
| Start | Choose Full Host or Join a Room without extra setup. Open a known invite when discovery is unavailable or denied. Never join a suggested room automatically. |
| Library | Open directly to song search in Full Host. See title, artist, and source at a glance. Queue a recording with optional performer details, favorite it, or import a supported local video from a reachable action. Preserve query and results when switching destinations. |
| Queue | See who is singing, who is next, and how many songs are waiting. Move or remove a waiting entry without interrupting the current song. Explain a blocked request with its next action. |
| Transport | Keep a compact Now Playing dock and Play/Pause available across host destinations. Open the full player for time, seek, restart, skip, and fullscreen. Switching destinations or closing the player should preserve the current recording and position. Returning from the background should restore a paused show. |
| Collections | Find favorite songs and show history in one destination. Keep favorites, history, and the current show after restarting the app. |
| Room | See whether the room is live, open or close it, copy an invite, review guest photos, manage playback settings and find on-device video copies. Give an explicit action when a room fails or reconnects. |
| Singer | Search the host's published library, request and withdraw eligible songs, and see pending, accepted, or failed status. Prevent duplicate submissions when the network outcome is uncertain. |
| Phone conventions | Use a bottom navigation bar, safe areas, platform-appropriate back behavior, and one-handed controls. Follow the system appearance, preserve readable desktop colors, and keep forms available above the keyboard. |
| Accessibility | Cover VoiceOver and TalkBack, larger text, reduced motion, contrast, and keyboard focus. Provide a spoken label and state for icon controls. Target 44 pt on iOS and 48 dp on Android. [Apple touch targets](https://developer.apple.com/design/tips/) · [Android touch targets](https://developer.android.com/guide/topics/ui/accessibility/views/apps-views) |
| Reliability | Test one full local-video song and one permitted stream per platform. Rehearse lock, background and return, incoming audio interruption, offline recovery and a host/guest network interruption. Keep local playback usable when catalog or room access fails. |
| Distribution | Deliver a signed iOS TestFlight build and a Google Play test build from one source commit and public version. Record the phone models and results before release. Hold the coordinated public release until both stores are ready. [Store process](releasing.md#coordinate-ios-and-android-store-releases) |

## Current status

| Status | Evidence and scope |
| --- | --- |
| Implemented before the redesign | Full Host and Piggyback use one mobile interface. It can join rooms by HTTPS link, search the hosted Karaoke Nerds catalog, use YouTube playback, import supported local videos, enqueue and reorder requests, save favorites, and retain local show history. Storage and relinking, pause recovery, room sharing, and host photo approval are implemented. [Mobile guide](mobile-app.md) |
| First workspace pass in 0.10.11 source | Library, Queue, Collections, and Room use bottom navigation. Collections contains Favorites and History. Room includes Device Storage. Library leads with search and uses desktop-style source color cues. The compact host transport gives access to the player while keeping the workspace visible. |
| Verified before this pass | The 0.10.10 iPhoneOS compile and disposable-key Android bundle verification passed on the same commit. Earlier Chromium rehearsals covered room requests, queue editing, local playback and recovery, and guest photo approval. [Paired build](https://github.com/thepropervolume/proper-karaoke-booth/actions/runs/44964251364) · [QA reports](qa/mobile-090-summary.md) |
| Verified in 0.10.11 development | The Chromium rehearsal covered the 320px and 390px layouts and a landscape tablet. It exercised bottom navigation, playback that continues during tab changes, queue/dialog focus, real local-file playback, room joining, photo review, and paused recovery with synthetic test media. All 46 mobile automated tests passed. |
| Device acceptance open | Repeat the end-to-end flows on the exact candidate on real iPhones and Android phones. Verify native discovery, permission denial, keyboard and system back, video/audio, restart and interruption recovery. The Apple app record and signing setup are still needed for TestFlight. Google Play setup and signed test installation remain separate. [iOS guide](store-ios.md) · [Android guide](store-android.md) |

## Next priorities

1. **Make the beta dependable.** Test a real show from opening the workspace or joining by invite through a completed song. Cover common phone sizes plus landscape, poor connectivity, blocked YouTube embeds, safe relinking and audio interruptions.
2. **Expand desktop parity.** Add playlist creation and editing, better filters and alternate-version selection, queue editing and approval where appropriate, and host management for singers. Document which controls change a phone-host show and which are authorized controls for someone else's desktop show.
3. **Complete store readiness.** Finish signing, physical-device tests, accessibility, support and privacy materials, provider and content review, and the shared App Store and Play release checks.
4. **Add useful phone features after the core works.** Prioritize QR invites with the system share sheet, clear room reconnect status, a queue undo action, and a protected local-show backup and restore flow.
5. **Validate larger native additions separately.** Evaluate AirPlay/Chromecast, external-display controls, larger media libraries, and any authorized paid catalog or offline access. Check real devices and provider terms before promising those features.
