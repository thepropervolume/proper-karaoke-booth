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

## Upload an internal beta from GitHub Actions

Use **Upload an internal iOS beta to TestFlight** for a manually approved upload from the official repository's `main` branch. First complete the App ID and app record setup above. This workflow uploads an **Internal Only** build. Use a separate upload for external TestFlight testing or the App Store. [Apple distribution options](https://developer.apple.com/documentation/xcode/distributing-your-app-for-beta-testing-and-releases)

In GitHub **Settings → Environments**, create `testflight`. Restrict deployments to the `main` branch. The workflow is manual. You can also add a required reviewer if you want separate approval for each upload. Keep the variables and secrets below in this environment. [GitHub environment protections](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments)

| Name | Where | Value |
| --- | --- | --- |
| `APPLE_TEAM_ID` | Environment variable | The authorized Apple Developer Team ID from Membership Details. |
| `ASC_KEY_ID` | Environment secret | The App Store Connect Team API key ID. |
| `ASC_ISSUER_ID` | Environment secret | The issuer ID on the App Store Connect Team Keys page. |
| `ASC_PRIVATE_KEY` | Environment secret | The full raw contents of the downloaded `.p8` file, including its PEM lines. |

The Account Holder requests App Store Connect API access. An Account Holder or Admin can create a dedicated **Team** key. Team keys apply across the account, so choose the narrowest role that can provision and upload for your team. Apple allows Developer, App Manager, Admin, and Account Holder roles to upload. Cloud-managed signing and Certificates, Identifiers & Profiles access are separate permissions. Individual API keys lack provisioning access. Store the signing key in the protected environment. Revoke a temporary key after TestFlight confirms delivery. [Team API keys](https://developer.apple.com/help/app-store-connect/get-started/app-store-connect-api/) · [Cloud-managed signing](https://developer.apple.com/help/account/certificates/cloud-managed-certificates/) · [Upload roles](https://developer.apple.com/help/app-store-connect/manage-builds/upload-builds/)

1. Review the exact pushed commit and run **Verify paired mobile store candidate** on it. Find the highest build number already uploaded for the version in App Store Connect.
2. Run **Upload an internal iOS beta to TestFlight** against `main`. Enter the full reviewed SHA and an unused build number between 1 and 9999 that is at least as high as the checked-in number. If a reviewer is configured, approve the deployment after confirming the commit and inputs.
3. The job builds the locked mobile web assets and resolves the pinned Swift packages before exposing signing credentials. It uses Xcode automatic signing with `-allowProvisioningUpdates` and the App Store Connect Team key flags `-authenticationKeyPath`, `-authenticationKeyID`, and `-authenticationKeyIssuerID`. It verifies the archive's Apple team, bundle ID, version, and iPhoneOS arm64 binary before using Xcode's `app-store-connect` upload mode and the Internal Only flag. The key, archive, and signing logs stay on the ephemeral runner.
4. When Apple finishes processing, resolve any export-compliance prompt in App Store Connect. Use an internal tester group with automatic distribution disabled if you want to inspect each build first. Add the build to that group and install it from TestFlight. [Build delivery status](https://developer.apple.com/help/app-store-connect/manage-builds/view-builds-and-metadata/) · [Internal TestFlight groups](https://developer.apple.com/help/app-store-connect/test-a-beta-version/add-internal-testers/)

When a new Apple team has no registered development devices, Xcode first reports that it cannot make a development profile. If it also reports no matching profile, the runner can bootstrap a single Apple Distribution certificate and an App Store profile scoped to Booth. That profile needs no registered iPhone. The fallback permits a single additional certificate when one is already listed and Apple has capacity. It leaves previously issued signing assets in place. It imports the private signing key into a temporary runner keychain and verifies the embedded profile and certificate before uploading.

Apple retains the issued certificate and profile after provisioning. Keep them active while the beta is in use. A later runner cannot reuse the discarded private key. Configure reusable signing on a trusted Mac, Xcode Cloud, or register a development device for automatic signing before regular uploads. If Apple does not confirm an upload, check the app's Build Uploads page before retrying or revoking signing assets. [App Store profiles](https://developer.apple.com/help/account/provisioning-profiles/create-an-app-store-provisioning-profile/) · [Apple certificate lifecycle](https://developer.apple.com/help/account/certificates/certificates-overview/)

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
