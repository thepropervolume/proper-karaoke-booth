# TPV Karaoke Mobile

The real mobile web interface lives in `src/mobile`, shared by the PWA and Capacitor Android/iOS projects here. It replaces the earlier disconnected Expo preview. See the [mobile guide](../docs/mobile-app.md), [reference research](../docs/mobile-research.md) and [QA reports](../docs/qa/mobile-090-summary.md).

From the repository root:

```sh
npm ci
npm run build:mobile
npm ci --prefix mobile
cd mobile
npx cap sync
npm run android
# On a Mac: npm run ios
```

Android uses Java 21, SDK 36 and the committed Gradle wrapper. iOS uses the committed Xcode project and pinned Capacitor Swift package; build it on a Mac. `@capacitor/core`, Android, iOS and CLI are pinned to 8.6.2. The bundle is local app code, with narrowly allowlisted native HTTP to the queue authority; no room/provider key is embedded. A fixed HTTPS YouTube player document supplies a web origin for the native iframe and uses a source/origin/channel-checked public-player bridge. Offline local files remain in IndexedDB; the remote player requires the internet.

`TPVRoomDiscovery` uses Android NSD and iOS Bonjour, advertises only the public HTTPS room address, validates found rooms with the relay, and offers an explicit join prompt. iOS declares its local-network purpose and Bonjour service. Denial or isolation falls back to same-egress hints/manual room entry. The desktop beacon is separately guarded by verified private interfaces, including Windows Private classification. No app changes OS firewall policy.

The [mobile build workflow](../.github/workflows/mobile.yml) creates a development Android APK, unsigned release AAB and unsigned iOS Simulator ZIP. These are not store releases or an installable signed iPhone IPA. Google Play needs a stable signing/upload key and developer account; TestFlight/App Store needs Apple Developer enrollment and signing/provisioning. CI's temporary debug key can require uninstalling an earlier development APK; back up metadata/media first. Do not distribute these as a production update mechanism.

Run `npm run typecheck` in both the root and this directory, and `node --import tsx --test tests/mobile/*.test.ts` from root. Real Chromium storage/lock tests run if a supported local browser is installed; otherwise that group explicitly skips. `scripts/mobile-browser-smoke.mts` uses two isolated browser contexts, a real local relay and synthetic catalog/video. Generate `release/mobile-test.mp4` using FFmpeg and run it with `node --import tsx scripts/mobile-browser-smoke.mts`. `TPV_CHROME` overrides the rehearsal browser path.

Keep native versions aligned with the application release. Rebuild `dist/mobile` before `cap sync`; generated web/config files and private keystores are ignored. Generate native/PWA icon slots from the approved text-free mark with `python scripts/sync-mobile-icons.py` (Pillow required); the main branding generator also includes these outputs. No new image source is edited in native asset slots. Device playback, discovery permissions, casting, battery/background behavior, store review and long-show acceptance remain separate from a successful compilation.
