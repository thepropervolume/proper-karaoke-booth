# Mobile 0.9.0 QA and Follow-up

Three specialized reviewers independently audited the initial mobile draft on 17 November 2026. Their original evidence and findings are retained in [protocol](mobile-090-protocol.md), [usability](mobile-090-ux.md) and [native/platform](mobile-090-native.md) reports. The tables below supersede initial “fix requested” statuses without erasing the reproduced failures. Overlapping findings are retained under their original IDs.

| Findings | Resolution and verification |
| --- | --- |
| MP-01–04 | Room close/new generation resets credentials and epoch. Unknown/cancelled opens retain identity for recovery and close late successful opens. Expired reply envelopes resume polling without replaying mutations. Sixteen lifecycle fault tests pass. |
| MP-05 | Lifecycle cancellation is combined with a per-request deadline. Native request timeout exceeds the normal long poll. |
| MP-06 | Mobile catalog reads use the fixed co-hosted loopback public snapshot endpoint, preserving the relay's localhost-only network sandbox. Local adapter tests pass; deployment acceptance is recorded separately. |
| MP-07 | Anonymous owners have a reserved namespace, one reserved slug each and a 50-reservation pool within the relay's 200 total capacity. The globally serialized store check preserves trusted-host capacity. SQLite test-adapter coverage passes; production uses MySQL. |
| MP-08 | Discovery retains room metadata until lease expiry while visibility remains heartbeat-bounded. Controlled outage/two-room recovery test passes. |
| MP-09–10 | Missing-song requests persist in show metadata. Host mutation replies wait for the IndexedDB save barrier; storage failure closes access without acknowledging success. Model and fault tests pass. |
| MP-11 | Anonymous MySQL owner rows are removed only after their lease and open tombstones are gone. Configured desktop owner IDs, including any that use the reserved prefix, are explicitly retained. Disposable MySQL verification is recorded with deployment. |
| M-UX-001–003 | Player state events synchronize controls. Queue dialogs trap keyboard focus, support Escape and restore the trigger. Settings copy only the four supported fields. Browser/model regression coverage passes. |
| M-UX-004–005 | Invalid saved data gets an atomic recovery copy before replacement. A Web Lock guards the host writer, acquired before reading state; a second tab retains singer access. Real Chromium IndexedDB/locking tests pass. |
| M-UX-006 | Dismissal remembers room identity/generation for this app session. |
| M-UX-007 | Imports report successes, per-file failures and skipped items beyond the explicit 20-file batch limit. |
| M-UX-008–009 | Local video menus remove a device copy or relink the same recording ID. Referenced waiting/playing copies cannot be removed. Aggregate storage-usage display remains a usability follow-up. |
| M-UX-010–013 | Chooser shows a still-open host room and offers Return/Close. Informational notices expire. Tabs wrap so Room stays reachable. Unsupported fullscreen offers a visible recovery message. |
| M-UX-014 | Follow-up: retain exact mobile playback position across mode/app restarts. The current request is retained and restored paused at its beginning. |
| N01–03 | iOS scene launch registers the custom discovery plugin; native timeout is compatible with polling; desktop mDNS handles asynchronous errors and profile changes. Six beacon behavior tests pass. |
| N04 | Fixed HTTPS native player document supplies the YouTube client origin and carries public player state only. Physical iOS/Android streaming remains an acceptance gate. |
| N05–07, N13 | Empty/denied native discovery falls back to same-egress hints. Scan callbacks are generation-fenced. DNS labels fit UTF-8 byte limits and same-name rooms receive distinct beacon identities. |
| N08 | Branding validation migrates from removed Expo configuration to committed Capacitor/PWA/native assets. |
| N09 | Android debug APK/unsigned AAB and iOS Simulator builds are development artifacts. Stable signing, TestFlight/App Store/Google Play delivery and real-device upgrades are still required. |
| N10–12 | Native iframe remounts for each performance/channel; play state drives native commands; the inline player has a 200px minimum height. Source and mocked browser evidence; device acceptance remains open. |

## Rehearsal evidence

`scripts/mobile-browser-smoke.mts` runs two phone-sized Chrome contexts against a real local relay with synthetic catalog data and a generated test video. It verifies room publication, consent before joining, real SingerClient queue submission, reorder/singer identity, dialog keyboard behavior, local playback/native controls/timeline, cross-tab host protection and room-close revocation. The 320/390/768px pages have no horizontal overflow. Ignored evidence is in `release/mobile-browser-090/`; no real account or provider key is used. The standalone specialist evidence remains under their recorded ignored paths.

Physical Android/iOS network permissions, DNS-SD over venue Wi-Fi, battery/background suspension, real YouTube creator restrictions, output hardware and long shows remain unverified. Browser tests and native compilation must not be presented as those physical checks. Paid mobile providers, key/tempo, vocal mixing, native casting, app-store signing and synced personal accounts remain product work, with quizzes excluded.
