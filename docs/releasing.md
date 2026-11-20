# Automatic releases

The **Release on version change** GitHub Actions workflow builds the desktop and mobile development packages and publishes verified artifacts to [Karaoke Booth downloads](https://release.thepropervolume.com/booth/). Anyone with the link can download the files; no preview sign-in is required. A successful run publishes a complete desktop, mobile and planning set from one source commit directly to Linode. Cloudflare points the release hostname to `apps.thepropervolume.com`.

## Publish an update

1. Increase the root and mobile package versions and platform version metadata together. Use semantic `0.x.y` versions; **1.0.0** remains the approved official release target.
2. Commit and push or merge to the default branch. The workflow compares the package version with the preceding push; unchanged versions skip packaging and downgrades fail.
3. Windows, Linux, macOS, Android, iOS Simulator and planning jobs build the same commit. Each job stages verified artifacts directly on Linode using the restricted SSH deploy key. The publisher verifies the complete set and publishes it only when every required job for that attempt has passed.
4. Inspect the workflow and hosted release before announcing availability. Use **Re-run all jobs** after a failed attempt so all staged batches belong to the same run attempt.

Before release, add reviewed notes at `docs/release-notes/vVERSION.md`. The workflow includes that text as `RELEASE_NOTES.md` in the verified release; if the file is absent it uses an explicit no-notes message.

CI uses `BOOTH_RELEASE_SSH_KEY` and the pinned `BOOTH_RELEASE_KNOWN_HOST`. The key is for restricted uploads and publication, not for download access. GitHub Actions does not need to store the mobile artifacts. See the [server runbook](../deploy/booth-downloads/README.md) for operation and recovery.

## What the downloads contain

The hosted set contains Windows x64 setup and portable ZIP; Linux x64 AppImage and Debian packages; macOS Apple silicon and Intel DMG/ZIP files; Android debug APK and unsigned Android App Bundle; an unsigned iOS Simulator ZIP; generated Word specification and mockup PDF; plus checksums and build verification receipts. The Android App Bundle is not a directly installable APK. The iOS Simulator ZIP runs only in the simulator and cannot be installed on an iPhone. Physical-device testing, production signing and store distribution remain separate work. Windows/Linux desktop builds are unsigned; macOS uses ad hoc signing without notarization.

Each retained release has an immutable page under `/vVERSION/`. The `/latest/` aliases redirect to the latest verified files and are suitable for sharing stable download links. Only the five newest release download sets are retained on Linode. When a release ages out, its installers are removed, but the release history and available notes and metadata remain accessible. A version-specific installer URL for a pruned release no longer downloads a file.

Stable links remove the version component from a verified artifact name. They issue a temporary HTTP redirect to its current `/vVERSION/` file. Examples:

- [Windows setup](https://release.thepropervolume.com/booth/latest/Proper-Karaoke-Booth-windows-x64-setup.exe)
- [Linux AppImage](https://release.thepropervolume.com/booth/latest/Proper-Karaoke-Booth-linux-x86_64.AppImage)
- [macOS Apple silicon DMG](https://release.thepropervolume.com/booth/latest/Proper-Karaoke-Booth-mac-arm64.dmg)
- [Android debug APK](https://release.thepropervolume.com/booth/latest/Proper-Karaoke-Booth-android-debug.apk)
- [iOS Simulator ZIP](https://release.thepropervolume.com/booth/latest/Proper-Karaoke-Booth-ios-simulator.zip)
- [Checksums](https://release.thepropervolume.com/booth/latest/SHA256SUMS.txt) and [release manifest](https://release.thepropervolume.com/booth/latest/release-manifest.json)

Archived versions are listed on the download page and their records are kept under `/archive/vVERSION/`. The archive page explains when installers have been pruned. Existing written release notes, including the v0.8.0 GitHub release text, are preserved; versions that never had written notes retain their available metadata without invented summaries.

The server verifies filenames, platform receipts, commit identity, required architectures and SHA-256 hashes before publication. Automated packaged launch and archive checks do not replace install/upgrade testing, physical audio and display checks, provider acceptance or signed-store review. Run `npm run test:release` for package rules and `python3 deploy/booth-downloads/test-release-command.py -v` on Linux for the server publisher tests.

## Historical GitHub release

The [v0.8.0 GitHub release](https://github.com/thepropervolume/proper-karaoke-booth/releases/tag/v0.8.0) was published on 15 November 2026. New release downloads are hosted on Linode. Past failed mobile artifact uploads to GitHub reflected the old separate workflow and do not establish that a later hosted release is available.
