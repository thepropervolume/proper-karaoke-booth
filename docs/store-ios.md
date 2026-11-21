# Prepare Booth for TestFlight and the App Store

The owner enrolled **SIMPLE DIGITAL, LLC** in the Apple Developer Program.
Start with an internal TestFlight build. The public development downloads
currently offer an unsigned iOS Simulator app. An iPhone build requires Apple
signing and an app record in App Store Connect. Coordinate public iOS and Android
delivery through the [mobile store release process](releasing.md#coordinate-ios-and-android-store-releases).

For an additional unsigned compiler check, manually run the **Verify unsigned
iOS device build** GitHub workflow. It builds an `iphoneos` Release app and
checks its arm64 binary, device platform, bundle metadata and bundled web
assets. The workflow uploads no artifact and needs no signing credentials; its
ephemeral output cannot be installed on an iPhone or submitted to Apple.

## Before building

1. Sign in to [Apple Developer](https://developer.apple.com/account/) and
   select **SIMPLE DIGITAL, LLC**. In **Membership details**, find the
   10-character [Team ID](https://developer.apple.com/help/glossary/team-id/).
   Use that organization for app registration and signing.
2. In **Certificates, Identifiers & Profiles → Identifiers**, check for
   `com.thepropervolume.karaoke`. If absent, [register an explicit App ID](https://developer.apple.com/help/account/identifiers/register-an-app-id/)
   with that bundle ID and description **TPV Karaoke Booth**. Use the same ID
   in [App Store Connect → Apps → New App](https://appstoreconnect.apple.com/apps).
   Select **iOS**, propose **TPV Karaoke Booth** as the name if available,
   **English (U.S.)** as the primary language, and `tpv-karaoke-booth-ios` as
   the internal SKU. App Store Connect requires the Account Holder to accept
   the current Business agreement before a record can be created.
   [Apple app record guide](https://developer.apple.com/help/app-store-connect/create-an-app-record/add-a-new-app/).
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

For the first beta, use Xcode Organizer → **Distribute App → App Store Connect**
and validate the signed archive before uploading to the app's TestFlight tab.
Use standard App Store Connect distribution if the build may later advance to
external testing or App Review. An upload marked TestFlight Internal Only is
restricted to internal testers. Once processing and any export-compliance
questions are complete, add the build to an internal TestFlight group.
[Apple upload guide](https://developer.apple.com/help/app-store-connect/manage-builds/upload-builds/) ·
[internal TestFlight groups](https://developer.apple.com/help/app-store-connect/test-a-beta-version/add-internal-testers/).

A development build can also run on a registered iPhone or iPad for device
verification. Keep signed archives and signing material in the owner's
trusted environment.

## Build with Xcode Cloud

Apple Developer Program membership includes 25 Xcode Cloud compute hours per
month. Use a compatible Mac for the first workflow setup. Later workflow
management is available in App Store Connect from a browser.
[Apple setup and pricing](https://developer.apple.com/xcode-cloud/get-started/) ·
[First workflow](https://developer.apple.com/documentation/xcode/configuring-your-first-xcode-cloud-workflow).

1. Open `mobile/ios/App/App.xcodeproj` in Xcode, select the shared **App** scheme
   and the SIMPLE DIGITAL, LLC team, then start Xcode Cloud setup. Connect the
   Booth GitHub repository and select the existing App Store Connect record.
2. Configure an iOS **Archive** action on the shared **App** scheme using an
   accepted Xcode and iOS SDK. Limit the workflow to reviewed release candidates.
   Choose a TestFlight distribution option for the beta and retain manual
   control of the public release.
3. Xcode Cloud automatically runs the project's
   [post-clone script](../mobile/ios/App/ci_scripts/ci_post_clone.sh) to install
   the pinned JavaScript dependencies, build the same interface Android uses,
   and sync the web bundle into iOS. Record the commit and the resulting
   TestFlight build number against the paired Android candidate.

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
