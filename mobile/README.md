# TPV Karaoke Mobile

The Ionic React singer workspace lives in `src/mobile/SingerWorkspace.tsx`, shared by the PWA and the Capacitor Android/iOS projects here. Use it to browse public catalogs, save an on-device profile and playlists, then join a desktop host for song requests. Full Host is paused and its previous implementation and stored shows are preserved. See the [mobile requirements and status](../docs/mobile-requirements.md), [singer guide](../docs/mobile-app.md), and [earlier QA reports](../docs/qa/mobile-090-summary.md).

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

Android uses Java 21, SDK 36 and the committed Gradle wrapper. Build the committed iOS Xcode project and pinned Capacitor Swift package on a Mac. `@capacitor/core`, Android, iOS and CLI are pinned to 8.6.2. The bundle contains the local app code and narrowly allowlisted native HTTP to the queue authority. Join credentials live in memory. The display name, optional email, and playlists use a dedicated IndexedDB store. Source selection and the last room code stay in on-device preferences. Public browsing needs network access to the relay, and desktop-owned provider operations stay at the host.

`TPVRoomDiscovery` uses Android NSD and iOS Bonjour to find advertised public relay rooms. The app verifies discovered rooms with the relay and asks which room to join. iOS declares its local-network purpose and Bonjour service. Permission denial or network isolation falls back to same-egress hints and manual room entry. A trusted LAN-only invitation opens in the device browser. The desktop beacon uses verified private interfaces, including Windows Private classification.

The [mobile build workflow](../.github/workflows/mobile.yml) creates a development Android APK, unsigned release AAB and unsigned iOS Simulator ZIP. These are not store releases or an installable signed iPhone IPA. Google Play needs a stable signing/upload key and developer account; SIMPLE DIGITAL, LLC is enrolled with Apple. TestFlight/App Store requires an app record and signing/provisioning. See the [paired store release process](../docs/releasing.md#coordinate-ios-and-android-store-releases). CI's temporary debug key can require uninstalling an earlier development APK; back up metadata/media first. Do not distribute these as a production update mechanism.

Run `npm run typecheck` in both the root and this directory, and `node --import tsx --test tests/mobile/*.test.ts` from the root. Real Chromium storage tests run when a supported browser is installed. Use the browser rehearsal with isolated profiles and a local relay to exercise singer search, admission, requests and persistence. `TPV_CHROME` overrides the rehearsal browser path.

Keep native versions aligned with the application release. Rebuild `dist/mobile` before `cap sync`. Generated web/config files and private keystores are ignored. Generate native/PWA icon slots from the approved text-free mark with `python scripts/sync-mobile-icons.py` (Pillow required). The main branding generator also includes these outputs. Real phones still need discovery, keyboard, accessibility, reconnect and store acceptance checks.
