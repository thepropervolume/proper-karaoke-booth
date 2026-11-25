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

With manual signing, use the same Apple Distribution identity for both targets.
Set `TPV_TESTFLIGHT_WIDGET_PROFILE_NAME` for the extension in addition to the app’s
`TPV_TESTFLIGHT_PROFILE_NAME` and include both bundle IDs and profile UUIDs in the
archive export options. The current single-profile TestFlight fallback must be
extended for the second profile before distributing this patch. Provisioning and
signing are separate from the unsigned check.
[Apple’s App Store profile instructions](https://developer.apple.com/help/account/provisioning-profiles/create-an-app-store-provisioning-profile/)
