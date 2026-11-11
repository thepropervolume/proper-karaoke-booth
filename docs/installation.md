# Installing The Proper Volume Karaoke Booth

The current development milestone is **0.2.0**. The target for the approved official release is **1.0.0**. Each delivered app update will have a version in the app and package filenames; small commits delivered together may share a version.

## Available packages

| Platform | Package | Current verification |
| --- | --- | --- |
| Windows 64-bit | Assisted installer (`windows-x64-setup.exe`) and extractable ZIP (`win-x64.zip`) | Both built. Packaged app opened with an isolated profile and preserved a singer after restart. Actual install/upgrade/uninstall and show hardware checks remain to be completed. |
| Linux 64-bit | AppImage and Debian `.deb` build targets | Build recipe provided; no Linux package or hardware verification claimed yet. |
| macOS Intel and Apple silicon | `.dmg` and ZIP build targets | Must be built and verified on a Mac. No macOS package claimed yet. |

Generated files live in the repository's `release` folder and are not committed to Git. Windows development packages are **unsigned** and currently use Electron's default app icon. Windows may identify them as an unrecognized publisher. Only use packages from a trusted project build. Official distribution still needs the approved app icon and platform signing.

## Windows

Finish or stop the current show and close the app normally before replacing an installed version. Run `Proper-Karaoke-Booth-0.2.0-windows-x64-setup.exe` and follow the installation wizard. It defaults to installation for the current user, allows choosing a destination, and creates a Start menu shortcut. It does not automatically start the app after installation. Administrator elevation and a desktop shortcut are disabled by default.

Alternatively, extract the entire `Proper-Karaoke-Booth-0.2.0-win-x64.zip` to a folder and open `proper-karaoke-booth.exe`. Keep its supporting files together. The ZIP uses the same application profile as the installer; it is not a separate show profile.

The show database, settings and keybindings stay in the existing `proper-karaoke-booth` user-data directory (normally `%APPDATA%\proper-karaoke-booth` on Windows). An explicit `--user-data-dir` or a custom startup profile is honored before the single-instance check. Uninstalling is configured to preserve application data. Back up the show before upgrading; uninstalling is not a backup procedure.

The installer includes the app and Electron runtime. It does not bundle media files, account credentials, a shared catalog database, `yt-dlp`, FFmpeg, or LibreOffice. Configure the shared catalog through Preferences using a private connection file supplied separately. YouTube downloads require `yt-dlp` and its media-processing dependencies on the host; see [YouTube downloads](youtube-downloads.md). LibreOffice is only needed to generate planning documents, not to run the karaoke app.

## Building packages

Use a clean checkout with a supported Node.js installation and the committed lockfile:

```sh
npm ci
npm run package:win
```

On Linux, use `npm run package:linux` for x64 AppImage and `.deb` packages. On a Mac, use `npm run package:mac` for Intel and Apple silicon DMG and ZIP packages. macOS builds are rejected on other operating systems. AppImage support libraries may be required by the target Linux distribution. Signing and notarization are not configured for this development release.

Packaging type-checks the source, builds into a temporary directory, and copies only bundled app assets, the package manifest and generated dependency license notices. It does not clean the `dist` folder used by a running development app. Platform targets are defined in `electron-builder.config.mjs`; dependencies are pinned by `package-lock.json`. The build writes a JSON receipt with the source revision, dirty status, runtime/builder versions, and SHA-256 hashes, plus a `SHA256SUMS.txt` file next to the packages. These make builds traceable; package timestamps mean two builds are not guaranteed to be byte-identical.

To check a Windows package without opening the real show:

```sh
node scripts/packaged-app-smoke.mjs release/win-unpacked/proper-karaoke-booth.exe
```

This launches the actual packaged app using a new disposable profile, checks its version and packaged identity, verifies persistence after restart, and cleans up only the profile it created. It does not run the installer or change the normal show.

## Before 1.0.0

The release checklist still includes real installation, upgrade and uninstall tests on each supported operating system; code signing and macOS notarization; an approved application icon; backup/restore compatibility; and actual codecs, audio outputs, external displays, disconnect/reconnect, and recovery checks. A generated installer does not establish those checks as complete.
