# iOS Room Now Playing

On iOS 16.2 and later, a singer can opt in to a read-only Room Now Playing card
on the Lock Screen and Dynamic Island. It displays the latest song, artist,
singer display name, status, and the reported position when the host supplies
timing. The host still owns playback. The singer’s account email, room credentials,
and queue tokens never enter ActivityKit.

Booth updates the card locally while the app is running and receiving room
snapshots. After 75 seconds without a snapshot the activity marks its information
stale and removes the progress indicator. Leaving a room or turning the feature
off clears the activity. iOS 15, iOS 16.0 and 16.1, and devices with Live Activities
turned off retain the in-app Now Playing screen. Booth does not register ActivityKit
push tokens in this implementation. Updating a card after app suspension needs an
authorized APNs service and a separate, scoped registration flow.
[ActivityKit documentation](https://developer.apple.com/documentation/activitykit/displaying-live-data-with-live-activities)

## Build validation

On a Mac with Xcode, from the repository root:

```sh
bash mobile/ios/App/ci_scripts/ci_post_clone.sh
xcodebuild -project mobile/ios/App/App.xcodeproj -scheme App \
  -configuration Release -sdk iphoneos -destination 'generic/platform=iOS' \
  -derivedDataPath /tmp/tpv-booth-liveactivity-build CODE_SIGNING_ALLOWED=NO build
```

The unsigned iOS device check workflow inspects the built
`App.app/PlugIns/RoomLiveActivity.appex`, its arm64 executable, and matching build
and marketing versions. On a signed physical device, join a playing room, enable
the card, lock the phone, confirm the stale state after suspension, then reopen
Booth and leave the room to verify dismissal.

## Signing

The extension has bundle ID `com.thepropervolume.karaoke.liveactivity` and requires
its own App ID and App Store provisioning profile under the same team as
`com.thepropervolume.karaoke`. The extension’s build and marketing versions inherit
the app’s project values.

The protected TestFlight workflow detects the extension in the reviewed Xcode
project. Its manual fallback requires the extension’s registered App ID, then
requests two distinct `IOS_APP_STORE` profiles for the same runner-generated
Apple Distribution identity. It passes the second profile name to Xcode as
`TPV_TESTFLIGHT_WIDGET_PROFILE_NAME`, alongside the app’s
`TPV_TESTFLIGHT_PROFILE_NAME`. The workflow verifies the embedded profiles and
signing certificates in both bundles and maps the extension’s distinct UUID to
`com.thepropervolume.karaoke.liveactivity` in `provisioningProfiles`.

The private provisioning helper’s optional final input is the second profile
name, after the app’s profile name. The workflow supplies
`Booth TestFlight CI <run-id>-<attempt> Live Activity`. No extra dispatch input
or GitHub secret is needed. A build without the extension uses a single
profile. The same certificate quota guard applies to both paths. Provisioning
and signing are separate from the unsigned check.
[Apple’s App Store profile instructions](https://developer.apple.com/help/account/provisioning-profiles/create-an-app-store-provisioning-profile/)
