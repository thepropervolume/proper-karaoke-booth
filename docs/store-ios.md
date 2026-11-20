# Prepare an iOS device build

The current release workflow builds an **unsigned iOS Simulator app**, not an
iPhone-installable IPA or an App Store submission. This runbook describes a
manual, opt-in device archive using an existing Apple Developer account and
owner-provisioned signing assets. It has not been executed on a Mac or verified
on an iPhone. It does not upload or submit an app.

For an additional unsigned compiler check, manually run the **Verify unsigned
iOS device build** GitHub workflow. It builds an `iphoneos` Release app and
checks its arm64 binary, device platform, bundle metadata and bundled web
assets. The workflow uploads no artifact and needs no signing credentials; its
ephemeral output cannot be installed on an iPhone or submitted to Apple.

## Before building

1. Confirm the Apple Developer Program team and the seller name. Apple uses
   the individual’s legal name or the enrolled organization’s legal entity
   name. An enrolled organization may be able to choose an eligible separate
   developer display name. Membership is currently USD 99 per year in the US.
   [Apple enrollment](https://developer.apple.com/help/account/membership/program-enrollment/),
   [developer name](https://developer.apple.com/help/app-store-connect/create-an-app-record/set-your-developer-name/).
2. Confirm the intended App Store bundle ID and register its explicit App ID in
   that team. The project currently uses `com.thepropervolume.karaoke`. Apple
   says the bundle ID cannot be changed after the first build is uploaded.
   [Apple distribution preparation](https://developer.apple.com/documentation/xcode/preparing-your-app-for-distribution).
3. Use a trusted Mac with a currently accepted Xcode and iOS SDK. Apple requires
   Xcode 26 or later and the iOS 26 SDK or later for uploads as of April 2026.
   Use the latest stable supported Xcode; deployment target and build SDK are
   different choices. [Apple SDK requirements](https://developer.apple.com/news/upcoming-requirements/?id=04282026a).
4. The owner configures an Apple Distribution certificate/private key and
   App Store Connect provisioning for that exact App ID, or uses Xcode-managed
   signing under an authorized team. Keep private keys and profiles in the
   owner's Keychain/Apple account; do not place them in this repository, logs,
   chat, publicly downloadable releases or CI artifacts. [Apple provisioning](https://developer.apple.com/help/account/provisioning-profiles/create-an-app-store-provisioning-profile/).
5. Decide and set an unused, increasing Xcode build number for each upload and
   align the marketing version with the intended release. Confirm the account's
   existing build history before choosing the number. The checked-in values are
   development defaults, not proof of availability in App Store Connect.

## Build the actual device archive

Use a clean, reviewed checkout at the intended commit. At the repository root:

```sh
npm ci
npm ci --prefix mobile
npm run typecheck
npm --prefix mobile run typecheck
npm run build:mobile
cd mobile
npx cap sync ios
npx cap open ios
```

In Xcode, select the **App** target and scheme, confirm the bundle identifier,
marketing version and build number, and choose the authorized team and signing
method under **Signing & Capabilities**. Select an **iOS device** archive
destination, not an iOS Simulator. Choose **Product → Archive** using the Release
configuration. The Organizer archive should contain an `iphoneos` device app;
inspect the signing, entitlements, bundle ID and versions before distribution.
Save the archive in an owner-controlled location, outside public downloads.

For device smoke testing, use a properly provisioned development build on a
registered iPhone/iPad or a TestFlight build once authorized and uploaded.
An App Store Connect distribution IPA is not equivalent to a directly
installable development IPA. If an IPA is needed for later App Store Connect
upload, choose the Organizer's **App Store Connect → Export** option using the
authorized distribution profile; verify the resulting signed bundle and keep it
private. Do not use **Upload**, submit for review, change production release
automation or publish artifacts until the account and release are ready.

## Review and device checks before submission

- Exercise local video import/playback, resume without autoplay, rotation,
  requests, optional photos, room join/host, permission denial, backgrounding,
  reconnect, small screens and accessibility on real iPhone and iPad hardware.
  The native app depends on the hosted public YouTube player document for online
  playback; check it and any required catalog/relay connectivity.
- Verify the local-network purpose string and Bonjour service declarations,
  photo/file-picker permissions as actually used, device entitlements and the
  Xcode privacy report for the archive. The repository includes Capacitor SDK
  privacy manifests; determine whether the app target also uses any required
  reason APIs and include accurate declarations where required.
- Assess singer-submitted images and other user content against Apple's
  filtering, reporting, blocking and contact requirements. Confirm content and
  provider permissions for the intended distribution and storefronts. Avoid
  advertising subscription providers or features the mobile app cannot use.
- Prepare an accurate privacy policy URL, an accessible in-app policy link,
  App Privacy answers covering the app and third parties, age rating, support
  details, real-device screenshots and usable App Review instructions. Determine
  the encryption export-compliance answers rather than guessing.

See [Apple App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/),
[App Privacy](https://developer.apple.com/help/app-store-connect/manage-app-information/manage-app-privacy/),
[export compliance](https://developer.apple.com/help/app-store-connect/manage-app-information/overview-of-export-compliance/),
and [uploading builds](https://developer.apple.com/help/app-store-connect/manage-builds/upload-builds/).
