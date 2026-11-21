# Android Google Play release preparation

Use the same release commit and public version as iOS. Android keeps its own
increasing `versionCode` and upload signing key. See the
[paired store release process](releasing.md#coordinate-ios-and-android-store-releases)
for coordinating Play testing and public release with TestFlight and the App
Store.

This is an opt-in build and signing workflow. It does not create a Play Console account, upload anything, publish an app, or change the existing debug APK / unsigned AAB release workflow. A signed AAB is an upload artifact, not an installable APK; Google Play produces signed APKs for a selected test or release track.

Run the manual **Verify Android Play bundle build** GitHub workflow to exercise the Android SDK build and signing with a disposable key. The workflow requires no store credentials and keeps the test bundle on its temporary runner.

The project currently uses package ID `com.thepropervolume.karaoke` and targets Android API 36. Decide and verify the final package ID and incrementing `versionCode` in Play Console before the first upload; the package identity and signing lineage affect future updates. Do not use the temporary CI debug key as the Play upload key. Install Java 21, the Android SDK 36/build tools 36, Git and Node dependencies (`npm ci` at the root and `npm ci --prefix mobile`). Build from a clean committed checkout. The wrapper may download Gradle dependencies.

The account owner must provision a dedicated upload keystore outside the repository and keep its backup and passwords private. Choose the Play App Signing setup in Play Console separately: Google can manage the app-signing key while this upload key authenticates submitted bundles. Do not commit keys, passwords, private configuration, or a synthetic test key. Environment variables are inherited by child processes and can be visible to sufficiently privileged software on the machine; use a trusted session and clear them after the run. The build script removes its four signing variables from the mobile/Gradle build subprocesses and passes passwords to `jarsigner` using its environment-variable option, not command-line values.

On Windows PowerShell, for example:

```powershell
$env:JAVA_HOME = 'C:\Path\To\JDK-21'
$env:TPV_PLAY_KEYSTORE = 'C:\Private\Keys\tpv-upload.p12'
$env:TPV_PLAY_KEY_ALIAS = Read-Host 'Upload key alias'
$env:TPV_PLAY_STORE_PASSWORD = Read-Host 'Keystore password' -MaskInput
$env:TPV_PLAY_KEY_PASSWORD = Read-Host 'Key password' -MaskInput
node scripts/build-play-aab.mjs --execute
Remove-Item Env:TPV_PLAY_KEYSTORE, Env:TPV_PLAY_KEY_ALIAS, Env:TPV_PLAY_STORE_PASSWORD, Env:TPV_PLAY_KEY_PASSWORD
```

Without `--execute`, the command only prints usage. With it, the script verifies a clean source checkout and matching version metadata, builds the mobile assets, syncs Capacitor, invokes `bundleRelease`, and signs a separate temporary copy. A Java verifier reads every payload entry and requires a valid signature from the selected keystore certificate. Only after verification does it copy the signed file to `release/play/Proper-Karaoke-Booth-VERSION-play-upload.aab`; an existing output is never overwritten. It checks for the expected bundle configuration and base manifest, but this is not a substitute for Google Play validation or device testing. The usual Gradle unsigned build output is regenerated; existing publishing and CI jobs are unchanged. If signing fails, check the keystore, alias, password and JDK without exposing credentials. Secure the whole environment and signing material according to the account owner's policies.

For initial Play readiness, the owner needs a verified [Play Console account](https://support.google.com/googleplay/android-developer/answer/6112435), an upload key and a decision about app signing, privacy policy and data-safety disclosures. New personal accounts created after 13 November 2023 face Google's [closed-test requirement](https://support.google.com/googleplay/android-developer/answer/14151465) of at least 12 opted-in testers for 14 continuous days before applying for production; verify current rules in Play Console. An organization account normally requires a D-U-N-S number and verified business details. Review YouTube/third-party policies and any required app-review access, then test the Play-distributed internal build on real Android devices, including media playback, discovery, offline recovery and upgrades. Store review and physical-device readiness have not yet been established.
