# Installing The Proper Volume Karaoke Booth

The current development version is **0.4.0**. Windows installer/ZIP and Linux AppImage/Debian packages passed isolated package and bundled-wrapper checks. The table records verified artifact versions. The target for the approved official release is **1.0.0**. Each delivered update has a version in the app and package filenames; focused commits delivered together may share a version.

## Available packages

| Platform | Package | Current verification |
| --- | --- | --- |
| Windows 64-bit | Assisted installer (`windows-x64-setup.exe`) and extractable ZIP (`win-x64.zip`) | 0.4.0 built from `0e90733`. Actual packaged version/restart, default/custom/solid CDG backdrop, bundled CLI/API lifecycle and settings-launch flags passed in isolated muted profiles. ZIP app/backdrop/CLI/brand bytes match the rehearsed package; receipt checksums verified. Actual 0.4 installation and upgrade testing remain. The owner reports the earlier 0.2 installers worked; platform was not specified. |
| Linux 64-bit | AppImage (`linux-x86_64.AppImage`) and Debian (`linux-amd64.deb`) | 0.4.0 built from verified `0e90733` archive. Actual extracted AppImage AppRun version/restart, public catalog search without a reader file, exact bundled backdrop, executable LF CLI wrapper/API lifecycle and desktop navigation flags passed. Both package payloads matched the tested assets; 76 targeted checks passed. Root/Xvfb used test-only sandbox/GPU flags; real-user desktop sandbox, installation and show hardware remain unverified. |
| macOS Intel and Apple silicon | `.dmg` and ZIP build targets | Must be built and verified on a Mac. No macOS package claimed yet. |

Generated files live in the repository's `release` folder and are not committed to Git. Windows development packages are **unsigned**. Earlier packages used Electron's default app icon. Version 0.4 uses the owner-selected [Velvet Script](app-icon-options.md), which is configured across Windows, Linux and macOS; the actual Windows 0.4 executable contains all nine approved icon sizes. All 66 generated branding hashes and the Windows executable resource check passed; these source checks do not establish installer or native desktop appearance. The dark microphone icon is the installed identity, with matching light assets included in the repository. Windows may identify unsigned packages as an unrecognized publisher. Only use packages from a trusted project build. Native icon checks and platform signing remain release gates.

## Windows

Finish or stop the current show and close the app normally before replacing an installed version. Run `Proper-Karaoke-Booth-0.4.0-windows-x64-setup.exe` and follow the installation wizard. It defaults to installation for the current user, allows choosing a destination, and creates a Start menu shortcut. It does not automatically start the app after installation. Administrator elevation and a desktop shortcut are disabled by default.

Alternatively, extract the entire `Proper-Karaoke-Booth-0.3.1-win-x64.zip` to a folder and open `proper-karaoke-booth.exe`. Keep its supporting files together. The ZIP uses the same application profile as the installer; it is not a separate show profile.

The show database, settings and keybindings stay in the existing `proper-karaoke-booth` user-data directory (normally `%APPDATA%\proper-karaoke-booth` on Windows). An explicit `--user-data-dir` or a custom startup profile is honored before the single-instance check. Uninstalling is configured to preserve application data. Back up the show before upgrading; uninstalling is not a backup procedure.

The installer includes the app, Electron runtime and default silent TPV lyric backdrop. It does not bundle song media files, account credentials, a shared catalog database, `yt-dlp`, FFmpeg, or LibreOffice. Fresh 0.4.0 source uses public read-only catalog discovery without a private configuration file; optional private profiles can be selected in Preferences. Earlier packages retain their version-specific setup requirements. Internet Remote Sessions also require separately provisioned per-host private configuration; self-service provisioning is not available. The Windows host used for development has been provisioned separately. Public HTTPS relay/browser end-to-end rehearsals passed in 0.3.0; physical-phone and venue-network checks remain. YouTube downloads require `yt-dlp` and its media-processing dependencies on the host; see [YouTube downloads](youtube-downloads.md). LibreOffice is only needed to generate planning documents, not to run the karaoke app.

## Linux

Version 0.4.0 Linux packages include the default lyric backdrop, public catalog discovery and bundled CLI. No 0.3.1 Linux build was produced. For an AppImage, save it in a folder you want to keep, allow it to run as a program in your file manager, and open it. From a terminal:

```sh
chmod +x Proper-Karaoke-Booth-0.4.0-linux-x86_64.AppImage
./Proper-Karaoke-Booth-0.4.0-linux-x86_64.AppImage
```

For Debian or Ubuntu, install the downloaded `.deb` through your software installer or use:

```sh
sudo apt install ./Proper-Karaoke-Booth-0.4.0-linux-amd64.deb
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

The release checklist still includes current-release installation, upgrade and uninstall tests on each supported operating system; code signing and macOS notarization; native verification of the selected application icon; backup/restore compatibility; and actual codecs, audio outputs, external displays, disconnect/reconnect, and recovery checks. A generated installer does not establish those checks as complete.

## Previous 0.3 verification scope

The prior Windows 0.3 package imported all 237 MP4s from the reported folder into a disposable show, and searched the real shared catalog before dispatching an actual yt-dlp download when queued. The public remote rehearsal used isolated host/browser sessions and synthetic media; no real show was modified and no playback started. Linux used a private virtual display and test-only root flags, leaving shipping defaults unchanged. Neither package has undergone a new real-user 0.3 installation or physical hardware check.

## 0.3.1 Lyric Backdrop

New CDG imports use the bundled TPV Version 3 animation by default. Configure **Preferences → Singer Display → Lyric Backdrop** before importing. Choose the default animation, **Solid CDG Background**, or a custom local MP4. Custom videos stay at their chosen path and must remain readable during import. They are not copied into installers. Existing converted CDG songs need reimporting to change their backdrop. Future LRC playback will use the same preference; it is not implemented yet. The original selected TPV asset is unchanged.

0.3.1 package receipts record source `33eab78`. Their source-change flag is true because the documentation mockup and this smoke script were improved during packaging; application/runtime code and the backdrop did not change. The ZIP’s `app.asar` and backdrop hashes match the actual package used for the passing rehearsal. Run `node scripts/cdg-import-smoke.mjs /path/to/packaged/executable` for that isolated, muted check. Linux 0.4.0 packages now include the backdrop; no 0.3.1 Linux package was produced.

## 0.4.0 Bundled CLI

Windows installs include `tpv-karaoke.cmd` beside the application executable. Use **Preferences → Local API and CLI → Show CLI Tool** to locate it. Enable that preference and save before using `status`, `capabilities`, `state`, `settings`, `shortcuts`, or `open settings` / `open keybindings`. No separate Node installation is required. The direct wrapper flags `--settings` and `--keybindings` also launch/focus the desktop while the API is disabled.

An installed/extracted Linux package includes the executable `tpv-karaoke` wrapper beside `proper-karaoke-booth`. To use an AppImage's bundled wrapper, extract it to a persistent folder with `./Proper-Karaoke-Booth-0.4.0-linux-x86_64.AppImage --appimage-extract` and run `./squashfs-root/tpv-karaoke --help`; keep the entire extracted folder together. The wrapper is not installed into the shell PATH automatically. macOS wrapper layout is configured but remains unbuilt. See [API/CLI commands and limits](local-control-api.md).

Windows receipts identify source `0e90733`, with `sourceRevisionChangedDuringBuild: false`. Their dirty flag records only the three pre-existing untracked deployment drafts, which packaging excludes. Version 0.4 full tests passed 679 checks with seven platform/environment skips; source UI/shortcut/ratings rehearsals and actual Windows packaged checks passed. Verification remains muted and synthetic; installer execution, physical audio/displays and native desktop launcher surfaces still need checks.

Linux 0.4.0 came from a SHA-verified Git archive of `0e90733` (archive SHA256 `2ea093afc52be978c98f2ca59e21481a43073bb2332a2a30c0d11d5812d1451c`). Its unaltered builder receipt has no Git checkout identity; the companion verification receipt records the verified archive/commit provenance and unchanged tracked files. Extracted AppRun and the executable LF wrapper passed private-profile checks, including a CLI-only PATH without Node and a loopback-only network namespace. Actual Debian installation, desktop integration and CDG conversion on Linux remain unverified. Existing services were unchanged.
