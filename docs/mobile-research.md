# Mobile karaoke reference and scope

Reviewed 17 November 2026 against KaraFun's [iPhone](https://www.karafun.com/karaoke-iphone/), [Android](https://www.karafun.com/karaoke-android/) and [feature](https://www.karafun.com/features/) pages.

| Capability | KaraFun reference | TPV mobile direction |
| --- | --- | --- |
| Song discovery and queue | Catalog and editable queue | Search the shared Karaoke Nerds snapshot, save local videos, add YouTube links and manage a touch-friendly queue |
| Guest requests | KaraFun documents smartphone remote catalog browsing and adding songs | Piggyback joins an existing TPV host; phone hosts publish their own room |
| Favorites and history | Both mobile platforms list them | Persist on this device, with show/history export |
| Key, tempo and vocal mix | Provider recordings support these controls | Preserve source capabilities; mobile provider/stem controls are future work |
| TV output | iPhone AirPlay; Android Chromecast | Device mirroring/player fullscreen initially; native casting SDK integration remains planned |
| Offline singing | KaraFun lists offline synchronization | User-selected local videos persist in IndexedDB; licensed provider offline downloads remain planned |
| Quizzes and games | KaraFun advertises these separately | Excluded from TPV scope |
| Nearby room suggestion | No equivalent automatic TPV room discovery assumed | Native DNS-SD and browser same-internet-connection hints, with an explicit Join choice |

KaraFun already documents remote guest queueing. TPV's differentiator is its unified local/community/provider library and the two mobile modes, rather than claiming that KaraFun cannot accept guest requests.

## Platform choices

[Capacitor](https://capacitorjs.com/docs/getting-started) packages the same web interface for Android and iOS. This replaces the disconnected Expo preview. A native project or successful compilation does not establish real-device playback, local-network permission behavior or store acceptance.

[Android NSD](https://developer.android.com/develop/connectivity/wifi/use-nsd) and [Apple NetServiceBrowser](https://developer.apple.com/documentation/foundation/netservicebrowser) discover a public HTTPS room beacon. Discovery grants no role or playback authority. Web browsers do not expose general DNS-SD enumeration; [Chrome's local network permission](https://developer.chrome.com/blog/local-network-access) governs access to known LAN addresses and does not itself locate hosts. Browser suggestions therefore use short-lived, hashed same-egress hints and clearly explain that shared public internet access does not prove the same Wi-Fi or venue.

YouTube playback uses its [IFrame Player API](https://developers.google.com/youtube/iframe_api_reference), including creator embedding restrictions and mobile autoplay rules. Native wrappers load a fixed HTTPS player document to supply a valid [client identity/referrer](https://developers.google.com/youtube/terms/required-minimum-functionality#api-client-identity-and-credentials). This is separate from the desktop's permanent yt-dlp acquisition workflow. No subscription or provider session is copied from the desktop to a phone.

## Authority and data boundaries

The phone owns its show, playback and queue. Optional public mobile rooms receive short-lived random owner capabilities held in memory; they cannot act as configured desktop owners. The existing relay forwards only validated singer operations and stores lease metadata in the existing MySQL database. No second global SQLite database is introduced. Mobile reservations are capped separately so anonymous phone hosts retain only a limited part of relay capacity.

Guest credentials and command receipts are scoped to the room generation, reset at closure, and omitted from IndexedDB, exports, discovery and logs. A host acknowledges a guest mutation only after local persistence. An interrupted opening retries the same owner/open ID, while terminal/expired relay replies have explicit recovery paths. Saved shows reopen paused. Native app/store signing, physical Android/iOS tests, mobile paid-provider sign-in, account synchronization, key/tempo, per-stem mixing and casting remain acceptance or implementation work.
