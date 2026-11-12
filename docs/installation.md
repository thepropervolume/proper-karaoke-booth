# Installing The Proper Volume Karaoke Booth

The current development version is **0.3.1**. The target for the approved official release is **1.0.0**. Each delivered app update will have a version in the app and package filenames; small commits delivered together may share a version.

## Available packages

| Platform | Package | Current verification |
| --- | --- | --- |
| Windows 64-bit | Assisted installer (`windows-x64-setup.exe`) and extractable ZIP (`win-x64.zip`) | Final 0.3.0 built from application source `7730814`, including bounded import recovery. Packaged launch/version/restart, real-folder import and public remote workflow passed. Actual 0.3 installation and upgrade testing remain. The owner reports the earlier 0.2 installers worked; platform was not specified. |
| Linux 64-bit | AppImage (`linux-x86_64.AppImage`) and Debian (`linux-amd64.deb`) | Final 0.3 packages built from `f1e7836`, which contains the same app plus server changes. Final AppImage launch/restart/persistence and 76 targeted checks passed. Linux installation and show hardware remain unverified. |
| macOS Intel and Apple silicon | `.dmg` and ZIP build targets | Must be built and verified on a Mac. No macOS package claimed yet. |

Generated files live in the repository's `release` folder and are not committed to Git. Windows development packages are **unsigned** and currently use Electron's default app icon. Windows may identify them as an unrecognized publisher. Only use packages from a trusted project build. The current [icon variations](app-icon-options.md) are available for review, but none has been selected; official distribution still needs an approved icon and platform signing.

## Windows

Finish or stop the current show and close the app normally before replacing an installed version. Run `Proper-Karaoke-Booth-0.3.0-windows-x64-setup.exe` and follow the installation wizard. It defaults to installation for the current user, allows choosing a destination, and creates a Start menu shortcut. It does not automatically start the app after installation. Administrator elevation and a desktop shortcut are disabled by default.

Alternatively, extract the entire `Proper-Karaoke-Booth-0.3.0-win-x64.zip` to a folder and open `proper-karaoke-booth.exe`. Keep its supporting files together. The ZIP uses the same application profile as the installer; it is not a separate show profile.

The show database, settings and keybindings stay in the existing `proper-karaoke-booth` user-data directory (normally `%APPDATA%\proper-karaoke-booth` on Windows). An explicit `--user-data-dir` or a custom startup profile is honored before the single-instance check. Uninstalling is configured to preserve application data. Back up the show before upgrading; uninstalling is not a backup procedure.

The installer includes the app, Electron runtime and default silent TPV lyric backdrop. It does not bundle song media files, account credentials, a shared catalog database, `yt-dlp`, FFmpeg, or LibreOffice. Configure the shared catalog through Preferences using a private connection file supplied separately. Internet Remote Sessions also require separately provisioned per-host private configuration; self-service provisioning is not available. The Windows host used for development has been provisioned separately. Public HTTPS relay/browser end-to-end rehearsals passed in 0.3.0; physical-phone and venue-network checks remain. YouTube downloads require `yt-dlp` and its media-processing dependencies on the host; see [YouTube downloads](youtube-downloads.md). LibreOffice is only needed to generate planning documents, not to run the karaoke app.

## Linux

The examples below refer to the verified 0.3.0 Linux packages; 0.3.1 Linux builds with the new bundled CDG backdrop have not been produced yet. For an AppImage, save it in a folder you want to keep, allow it to run as a program in your file manager, and open it. From a terminal:

```sh
chmod +x Proper-Karaoke-Booth-0.3.0-linux-x86_64.AppImage
./Proper-Karaoke-Booth-0.3.0-linux-x86_64.AppImage
```

For Debian or Ubuntu, install the downloaded `.deb` through your software installer or use:

```sh
sudo apt install ./Proper-Karaoke-Booth-0.3.0-linux-amd64.deb
```

Run the app as your regular desktop user. Some distributions require AppImage/FUSE support libraries. The app's established profile is normally `~/.config/proper-karaoke-booth`, respecting the desktop's configuration location. Keep private catalog configuration and media separate from the downloaded package. Linux audio outputs, codecs, desktop launch, upgrade and removal still need verification on the intended show computer.

## Building packages

Use a clean checkout with a supported Node.js installation and the committed lockfile:

```sh
npm ci
npm run package:win
```

On Linux, use `npm run package:linux` for x64 AppImage and `.deb` packages. On a Mac, use `npm run package:mac` for Intel and Apple silicon DMG and ZIP packages. macOS builds are rejected on other operating systems. AppImage support libraries may be required by the target Linux distribution. Signing and notarization are not configured for this development release.

Packaging type-checks the source, builds into a temporary directory, and copies only bundled app assets, the package manifest and generated dependency license notices. The silent default TPV lyric-backdrop video is copied to `resources/backdrops` outside `app.asar` so FFmpeg can read it; do not copy a user’s private video folder into the package. It does not clean the `dist` folder used by a running development app. Platform targets are defined in `electron-builder.config.mjs`; dependencies are pinned by `package-lock.json`. The build writes a JSON receipt with the source revision, dirty status, runtime/builder versions, and SHA-256 hashes, plus a `SHA256SUMS.txt` file next to the packages. These make builds traceable; package timestamps mean two builds are not guaranteed to be byte-identical.

To check a Windows package without opening the real show:

```sh
node scripts/packaged-app-smoke.mjs release/win-unpacked/proper-karaoke-booth.exe
```

This launches the actual packaged app using a new disposable profile, checks its version and packaged identity, verifies persistence after restart, and cleans up only the profile it created. It does not run the installer or change the normal show.

## Previous 0.2.0 build verification

Windows packages contain the final application at `f60e073`; Linux packages use `7bfa5f7`, whose only additional application-packaging change declares Debian runtime dependencies. Both include the same cache-access fix. The Windows receipt flags that Linux-only commit occurring during its build; no Windows payload changed. Versioned checksums and build receipts accompany both platforms. The Linux verification receipt records test-only root/virtual-display launch flags; normal packages retain their shipping sandbox defaults. Actual non-root desktop sandbox operation still needs checking.

## Before 1.0.0

The release checklist still includes 0.3 installation, upgrade and uninstall tests on each supported operating system; code signing and macOS notarization; an approved application icon; backup/restore compatibility; and actual codecs, audio outputs, external displays, disconnect/reconnect, and recovery checks. A generated installer does not establish those checks as complete.

## Current verification scope

The final Windows package imported all 237 MP4s from the reported folder into a disposable show, and searched the real shared catalog before dispatching an actual yt-dlp download when queued. The public remote rehearsal used isolated host/browser sessions and synthetic media; no real show was modified and no playback started. Linux used a private virtual display and test-only root flags, leaving shipping defaults unchanged. Neither package has undergone a new real-user 0.3 installation or physical hardware check.

## 0.3.1 Lyric Backdrop

New CDG imports use the bundled TPV Version 3 animation by default. Configure **Preferences → Singer Display → Lyric Backdrop** before importing. Choose the default animation, **Solid CDG Background**, or a custom local MP4. Custom videos stay at their chosen path and must remain readable during import. They are not copied into installers. Existing converted CDG songs need reimporting to change their backdrop. Future LRC playback will use the same preference; it is not implemented yet. The original selected TPV asset is unchanged.
