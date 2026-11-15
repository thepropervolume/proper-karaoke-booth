# Installing The Proper Volume Karaoke Booth

Development **0.8.0** adds independent KaraFun instrumental, lead and backing channel volumes, including separate duet/choir parts when supplied. **Vocal Mix** is beside the transport during native playback. Mix changes survive pause/seek/Previous and reset for a new performance; lead starts muted. The official release target remains **1.0.0**.

All packages below use frozen runtime source `c0795b8`. Files and verification receipts are in local `C:\Users\hello\Projects\proper-karaoke-booth\release`. The installed app and Dropbox mirror were not changed by this delivery.

## 0.8.0 Packages and Checks

| Platform | Package | Verified Scope |
| --- | --- | --- |
| Windows x64 | `Proper-Karaoke-Booth-0.8.0-windows-x64-setup.exe` or `Proper-Karaoke-Booth-0.8.0-win-x64.zip` | 1,028 tests passed / 8 skips; packaged launch/restart, branding and official sign-in cancellation; exact source/UI/notices and 19 matching ZIP payloads. A separate muted source rehearsal verifies five decoded synthetic stems, live independent gains without source restart, hidden-window control, seek/reset and sign-out fencing. |
| Linux x64 | `Proper-Karaoke-Booth-0.8.0-linux-x86_64.AppImage` or `Proper-Karaoke-Booth-0.8.0-linux-amd64.deb` | 1,024 tests passed / 12 skips; verified archive/source, matching payloads, packaged launch/restart, branding, search/hidden preview, API/CLI navigation and optional-singer playback/history in private offline namespaces. Four additional TCP cases require a private NIC absent on the build server. |
| macOS Apple silicon | `Proper-Karaoke-Booth-0.8.0-mac-arm64.dmg` or `.zip` | macOS 27.0.1: 1,028 tests passed / 8 skips; native launch/restart/branding and bundled CLI, strict ad-hoc signatures, matching DMG/ZIP payloads. |
| macOS Intel | `Proper-Karaoke-Booth-0.8.0-mac-x64.dmg` or `.zip` | Architecture, payload and ad-hoc signature checks; native Intel execution remains unverified. |

All suites contain 1,036 tests with zero failures. The [macOS workflow](https://github.com/thepropervolume/proper-karaoke-booth/actions/runs/43696706037) passed; all eight Mac artifact hashes and the downloaded GitHub archive digest match. Linux and Windows application ASAR hashes match. The reviewed planning edition contains 41 Word pages and 47 PDF pages across 22 screen families.

These are development packages: Windows/Linux are unsigned, Mac uses ad-hoc signing without Developer ID/notarization, and Linux GUI checks use test-only root sandbox flags. Actual installation/upgrade/removal, ordinary Linux desktop sandbox behavior, physical audio/device/display recovery and real-recording mix listening remain acceptance work. No new database migration is introduced in 0.8.0: existing profiles remain schema 5. When upgrading from an older schema, follow the backup guidance below; media, private configuration and preferences require separate backups.

## Historical 0.7.1 Delivery

Development **0.7.1** adds optional singer assignment and a single outer search focus ring. Windows, Linux and macOS packages are built from frozen source `0c0aa3a`. Packages, build/verification receipts and SHA256 manifests are in local `C:\Users\hello\Projects\proper-karaoke-booth\release`; the Dropbox mirror and the owner's installed app were not modified. The official release target remains **1.0.0**.

## 0.7.1 Packages and Checks

| Platform | Package | Verified Scope |
| --- | --- | --- |
| Windows x64 | `Proper-Karaoke-Booth-0.7.1-windows-x64-setup.exe` or `Proper-Karaoke-Booth-0.7.1-win-x64.zip` | 1,022 tests passed / 8 skips; actual packaged UI blank-singer queueing, assignment/clear, playback, restart and nullable history. Packaged launch/branding/account-window isolation, source/UI/notices/ZIP hashes also pass. |
| Linux x64 | `Proper-Karaoke-Booth-0.7.1-linux-x86_64.AppImage` or `Proper-Karaoke-Booth-0.7.1-linux-amd64.deb` | 1,018 tests passed / 12 skips; exact source archive, both payload formats and isolated packaged checks recorded in the Linux receipt. Four extra TCP cases require an assigned private NIC, absent on this public server; they ran on Windows/macOS. |
| macOS Apple silicon | `Proper-Karaoke-Booth-0.7.1-mac-arm64.dmg` or `.zip` | macOS 27.0.1: 1,022 tests passed / 8 skips, native launch/restart/branding and bundled CLI, strict signatures and matching DMG/ZIP payloads. |
| macOS Intel | `Proper-Karaoke-Booth-0.7.1-mac-x64.dmg` or `.zip` | Payload, architecture and ad-hoc signature checks; native Intel execution remains unverified. |

All platform suites contain 1,030 tests with zero failures. The [macOS workflow](https://github.com/thepropervolume/proper-karaoke-booth/actions/runs/43688738198) passed. Windows is unsigned; Mac apps use ad-hoc signing without Developer ID/notarization. Linux GUI checks use private headless namespaces and test-only root sandbox flags. Installation/upgrade/removal, ordinary desktop sandbox behavior and physical listening/display hot-plug remain separate checks.

**Before installing, back up the show.** This update migrates local history to **schema 5**, allowing genuine null singer ownership. Existing assigned singers and history are preserved transactionally; interrupted-migration rollback and retry passed. Older schema-4 binaries refuse the upgraded database; downgrading requires the pre-upgrade backup. No shared MySQL/catalog/rating migration is involved. Private settings, keybindings, connection files and media require separate backups.

In **Add to Queue**, leave **Singer (optional)** at **No singer — assign later**. The host can assign or clear it through **Edit track or singer…** before playback; prepared request identity/position stays fixed. No placeholder person is created. Named-singer limits and guest ownership remain enforced. The same option works for local, Karaoke Nerds/YouTube and connected native KaraFun songs. Search focus now draws only the outer field ring, checked in both themes and all accent colors.

## Historical 0.7.0 Delivery

Development **0.7.0** has Windows x64 setup/ZIP, Linux x64 AppImage/Debian and separate Apple silicon/Intel macOS DMG/ZIP packages. The official release target remains **1.0.0**. This delivery did not install, upgrade or remove the owner's existing app or modify the Dropbox mirror.

## 0.7.0 Packages and Verification

All files, build receipts, verification receipts and SHA256 manifests are in `C:\Users\hello\Projects\proper-karaoke-booth\release`. Windows/Linux use frozen source `f57fd9a`; macOS uses `9522b0c`, which changes only multi-interface test portability. Runtime source is unchanged between those commits. All three platforms passed **1,007 tests, eight intentional skips and zero failures** (1,015 total). Type checking, focused integration checks and nine document-generator tests also pass.

| Platform | Package | Verified Scope |
| --- | --- | --- |
| Windows x64 | `Proper-Karaoke-Booth-0.7.0-windows-x64-setup.exe` or `Proper-Karaoke-Booth-0.7.0-win-x64.zip` | Actual packaged launch/restart, branding/minimum-width controls, official account-window isolation/cancellation. Three fresh source bundles, 45 UI files, notices and 19 ZIP payload files match. Installer/ZIP/blockmap hashes verified. |
| Linux x64 | `Proper-Karaoke-Booth-0.7.0-linux-x86_64.AppImage` or `Proper-Karaoke-Booth-0.7.0-linux-amd64.deb` | Exact transferred Git archive, complete suite, both payload formats and private AppRun checks; see the Linux verification receipt for precise scope and headless/runtime flags. |
| macOS Apple silicon | `Proper-Karaoke-Booth-0.7.0-mac-arm64.dmg` or `.zip` | macOS 27.0.1 native launch/restart/branding and bundled CLI without Node, matching DMG/ZIP payloads and deep/strict ad-hoc signatures. |
| macOS Intel | `Proper-Karaoke-Booth-0.7.0-mac-x64.dmg` or `.zip` | Payload/architecture/signature checks; native Intel execution remains unverified. |

The [successful macOS 27 build](https://github.com/thepropervolume/proper-karaoke-booth/actions/runs/43685975891) and all downloaded package hashes are verified. Windows is unsigned. Mac apps are ad-hoc signed without Developer ID/notarization; Finder/Gatekeeper installation remains a separate check. Linux headless verification uses a private Xvfb session and root-only test flags; ordinary desktop sandbox/install/upgrade/removal checks remain. Physical listening, mixer routing and display/device hot-plug are unverified by these muted rehearsals.

Source rehearsals additionally passed global sidebar search, unified provider borders/context menus, hidden preview, logo/banner preferences, automatic staging/gaps/next tracks, launch bumper/fade, prepared-request editing, native synthetic KaraFun playback and cancellation of delayed Play/Previous. Windows OS-protected session restoration passed across four independent launches. The shared KaraFun rating validator is deployed on Linode III; live disposable-voter checks passed without altering human ratings.

Launch bumper and between-song music default on, with a 1000 ms fade; **Preferences → Audio Controls** changes them. Approved songs prepare automatically. First Play starts a show; completion/confirmed Skip advances after the configured gap and ready media. **Stop** cancels delayed playback. Restart never starts karaoke. **Sources → KaraFun** remembers an accepted session where secure OS storage is available, validates it on restart, and asks for ordinary sign-in after expiry/revocation. See [host workflow](host-workspace.md) and [native limits](karafun-native-integration.md).

Back up the show before upgrading from older versions and preserve preferences/keybindings/private connection files separately. The show database remains schema 4 in this update; older schema-3 apps refuse it. Downgrading across that boundary requires the pre-upgrade profile backup. yt-dlp and FFmpeg remain external dependencies; LibreOffice is only needed for generating the planning documents.

## Historical 0.6.0 Delivery

Development version **0.6.0** has verified Windows setup/ZIP, Linux AppImage/Debian and separate macOS Apple silicon/Intel DMG/ZIP packages from frozen packaging source `6bcb7d5`. It includes experimental native KaraFun. The official release target remains **1.0.0**. Several focused commits delivered together may share one version. No installed-copy upgrade or removal was performed for this delivery.

## 0.6.0 Packages and Verification

Files are in the local checkout's `release` directory at `C:\Users\hello\Projects\proper-karaoke-booth\release`. The owner maintains the Dropbox checkout separately. Each platform has a build receipt and SHA256 manifest; Linux also records the exact transferred Git archive because its builder ran without a `.git` directory. Application code matches runtime checkpoint `eb1e014`; the later frozen source adds packaging notices and documentation. All three platforms passed the complete suite: **944 passed, eight platform/environment skips, zero failures** (952 total), plus type checking and branding verification.

| Platform | 0.6.0 Package | Verified Scope |
| --- | --- | --- |
| Windows x64 | `Proper-Karaoke-Booth-0.6.0-windows-x64-setup.exe` and `Proper-Karaoke-Booth-0.6.0-win-x64.zip` | Packaged launch/restart/no-autoplay, Day/Night branding, minimum-width controls, official sign-in window isolation/cancellation and unchanged show. Three fresh compiled bundles and 45 UI files match the ASAR; 19 ZIP payload files match unpacked output. |
| Linux x64 | `Proper-Karaoke-Booth-0.6.0-linux-x86_64.AppImage` and `Proper-Karaoke-Booth-0.6.0-linux-amd64.deb` | Both payloads and notices, 112-entry extraction manifest, private offline AppRun restart/branding/CLI/API and synthetic local import/rating checks. Synthetic native-player testing used a separate account fixture; real provider sign-in is unverified. |
| macOS Apple silicon | `Proper-Karaoke-Booth-0.6.0-mac-arm64.dmg` and ZIP | macOS 27.0.1 arm64 native packaged launch/restart/branding/CLI, deep/strict ad-hoc signatures and matching DMG/ZIP payloads. |
| macOS Intel | `Proper-Karaoke-Booth-0.6.0-mac-x64.dmg` and ZIP | Architecture, ad-hoc signatures, image validation and matching DMG/ZIP payloads. Intel native execution remains unverified. |

The [successful Mac workflow](https://github.com/thepropervolume/proper-karaoke-booth/actions/runs/43680264866) built both architectures. Its downloaded archive digest and every package/blockmap hash were checked locally. Windows is unsigned; Mac bundles use ad-hoc integrity signing without Developer ID/notarization. Regular-user Linux sandbox, installation/upgrade/removal and physical show devices remain verification work.

On Windows, a real subscription passed the complete native KaraFun source flow, including rendered lyric pixels after seeking. The test was muted and private; it does not establish audible mixer routing or real provider playback on Linux/macOS. Use **Sources → KaraFun → Sign In to KaraFun**, then search Song Library, choose a singer and queue the recording. Sessions remain in memory and must reconnect after restarting. See [native setup and limits](karafun-native-integration.md).

Before first 0.6.0 launch, make a validated show backup and preserve the private profile/settings/keybindings/connection files separately. The app migrates to schema 4; older versions refuse that database. Downgrading requires the pre-upgrade profile/database backup. Installers preserve the established app-data location, but package rehearsals are not an installed-copy upgrade test.

## Historical 0.5.0 Delivery

The previous Windows/Linux/macOS packages used frozen source `8d4c003`. The following evidence remains version-specific.

## 0.5.0 Source Update

Private, muted source rehearsals cover the refreshed workspace, persisted panel resizing, preview placement, blacklist save/cancel/removal and local heart ratings without a remote writer profile. The new LAN mirror and capture modules have temporal and HTTP integration coverage. The complete Windows and macOS core suites each passed **861 tests with eight platform/environment skips and zero failures** (869 total), and type checking passed; nine documentation-generator tests passed. Actual-app playback of a silent synthetic MP4 produced matching singer-window pixels in the host preview and two isolated LAN browsers; Stop/close clearing, reconnect, port migration and shutdown passed. An owner-rating read-only IPC check reported ready/canVote without submitting a vote or changing its profile hash. These compositor checks do not verify physical audio, venue Wi-Fi or show hardware. Current package evidence follows; real-user Linux installation and desktop sandbox behavior remain unverified.

The application still requires separately installed `yt-dlp` for YouTube search/downloads and FFmpeg for media processing/CDG conversion. Google Takeout subscription files can seed channel approvals; Google account passwords and browser cookies are not imported. LAN singer-screen sharing is off by default and uses port 4051 only when enabled. See [sharing setup and limits](singer-screen-sharing.md).

### 0.5.0 Package Evidence

Windows setup/ZIP receipts identify clean frozen source `8d4c00342d7870669de201e5113cb18f5beb9697`, with no revision change during the build. Actual packaged launch/restart/no-autoplay, Day/Night logos and minimum-width controls passed in private profiles. The bundled CLI/API rehearsal also passed explicit enablement, private discovery, authenticated reads/navigation, unsupported-mutation rejection, token rotation/stale-token denial, restart persistence, disable/quit cleanup and launcher flags. All 20 checked ZIP/unpacked payload files match, and the app/setup executable resources contain all nine selected icon images. The generated `release/Proper-Karaoke-Booth-0.5.0-win-*` receipts and checksums accompany the unsigned packages. This verifies package contents and runtime, not a new installer execution or uninstallation.

[GitHub Actions run 43571138760](https://github.com/thepropervolume/proper-karaoke-booth/actions/runs/43571138760) successfully built both macOS architectures from the same frozen source on macOS 27.0.1 Apple silicon. Both DMG/ZIP pairs passed ad-hoc signatures and matching-payload checks; the native arm64 app passed private-profile launch/restart, branding and bundled CLI help. All eight downloaded package/blockmap hashes and build/verification receipts were checked in `release`. Intel native execution, Finder installation/upgrade/removal, Gatekeeper approval, Developer ID signing/notarization and physical devices remain unverified.

Linux AppImage/Debian packages use the same frozen archive, with all 705 tracked files unchanged. The full suite passed 861 tests with eight skips and zero failures. Both formats passed final static validation and matching runtime/app payload checks; the complete 112-entry AppImage file/mode/link manifest matches the actual extraction used for AppRun QA. Branding, ten default light icons, backdrop and CLI checks passed. Actual private, muted AppRun checks covered restart/no-autoplay, Day/Night logos, minimum width, CLI without Node, authenticated API/navigation/recovery/disable, public catalog IPC/UI and seven-heart local-rating persistence/clear without any shared-rating request. Root/Xvfb sandbox/GPU flags were test-only; no source changes, owner votes, private-credential reads or service changes were made for QA. Non-root desktop, Linux installation/upgrade/removal and physical devices remain unverified. All six Linux checksum entries and the independently supplied verification-receipt hash were validated after transfer. The `-linux-build.json`, `-linux-verification.json`, notes and SHA256 sums in `release` distinguish archive provenance from the raw builder's null Git fields.

The separate optional `TPV-KHost-Bridge-0.1.0.zip` was built from the same source, SHA256 `567d921d5b2c200be5812dcea0cb93662b9ec2a31dcade1766fb69be92c4a9c3`. It is installed explicitly in a separate KHost application, not bundled or enabled by the TPV installer. Actual KHost loading and authenticated search/handoff remain unverified; see [bridge setup](khost-bridge.md).

## Historical 0.5.0 Packages

| Platform | Package | Current verification |
| --- | --- | --- |
| Windows 64-bit | 0.5.0 assisted installer and extractable ZIP | Clean frozen `8d4c003`; actual packaged launch/restart, no-autoplay, Day/Night logos and minimum-width controls passed. All 20 checked ZIP/unpacked payload files match; app/setup contain all nine approved icon frames. Actual 0.5.0 installation/upgrade/removal remains unverified; installed PC is 0.4.3. |
| Linux 64-bit | 0.5.0 AppImage and Debian | Same frozen `8d4c003` archive; 861 tests passed with eight skips and zero failures. Both package payloads/branding match; actual private AppRun restart/no-autoplay, Day/Night/minimum-width, CLI/API, catalog and offline local-rating persistence checks passed. Root/Xvfb flags were test-only; non-root desktop, installation/upgrade/removal and hardware remain unverified. |
| macOS Apple silicon | 0.5.0 `.dmg` and ZIP | Frozen `8d4c003` on macOS 27.0.1; ad-hoc signatures, matching DMG/ZIP payloads, native private-profile launch/restart, Day/Night branding and CLI help passed. Finder installation and physical show hardware remain unverified. |
| macOS Intel | 0.5.0 `.dmg` and ZIP | Same frozen source; ad-hoc signatures, architecture and DMG/ZIP payload checks passed. The x64 app was not launched on the ARM runner. |

Generated files live in the repository's `release` folder and are not committed to Git. Windows development packages are **unsigned**. Version 0.4.1 uses the owner-selected [Microphone Play](app-icon-options.md) identity: the original navy microphone on a white rounded tile is the default installed icon, with no visible text. Matching light/dark masters and exports are retained; the full logo reads **TPV / KARAOKE BOOTH**. All 69 generated hashes, both ICO/ICNS sets and actual Windows icon resources passed verification. Assisted NSIS setup includes proportional 150×57 header and 164×314 sidebar artwork in 24-bit BMP files. Earlier installers retain their previous identity, including 0.4.0 Velvet Script. Windows may identify unsigned packages as an unrecognized publisher. Only use packages from a trusted project build. Native macOS/Linux desktop appearance, physical show behavior and platform signing remain release gates.

## Windows

Finish or stop the current show and close the app normally before replacing an installed version. Run `Proper-Karaoke-Booth-0.5.0-windows-x64-setup.exe` and follow the installation wizard. It defaults to installation for the current user, allows choosing a destination, and creates a Start menu shortcut. It does not automatically start the app after installation. Administrator elevation and a desktop shortcut are disabled by default.

Alternatively, extract the entire `Proper-Karaoke-Booth-0.5.0-win-x64.zip` to a folder and open `proper-karaoke-booth.exe`. Keep its supporting files together. The ZIP uses the same application profile as the installer; it is not a separate show profile.

The show database, settings and keybindings stay in the existing `proper-karaoke-booth` user-data directory (normally `%APPDATA%\proper-karaoke-booth` on Windows). An explicit `--user-data-dir` or a custom startup profile is honored before the single-instance check. Uninstalling is configured to preserve application data. Back up the show before upgrading; uninstalling is not a backup procedure.

### Before First 0.5.0 Launch Or Downgrade

Version 0.5.0 migrates the local database to **schema 3** for source-less recording ratings. Before the first launch, use the existing app's **File → Back up show…**, close it normally, and separately preserve preferences, keybindings and private connection files in a protected backup; media needs its own backup. The database snapshot alone does not include those files. Older clients reject schema 3, so returning to an earlier app requires a validated pre-0.5.0 database/profile backup. Keep that rollback copy intact rather than opening the migrated database with an old app or overwriting a live database.

On 13 November, the existing installation on this PC was upgraded silently from 0.2.0 to 0.4.1. Before installation, an owner/SYSTEM-only backup was saved at `C:\tmp\tpv-karaoke-backups\before-0.4.1-20261113-021951`, including a consistent SQLite backup and configuration files. The original show database and configuration bytes were unchanged afterward. The installed path is `%LOCALAPPDATA%\Programs\proper-karaoke-booth\proper-karaoke-booth.exe`; its version is 0.4.1.0. The Start menu shortcut and uninstall registry entry point to the installed icon resources. This verifies one actual upgrade, not uninstall behavior or physical-show readiness.

The installer includes the app, Electron runtime and default silent TPV lyric backdrop. It does not bundle song media files, account credentials, a shared catalog database, `yt-dlp`, FFmpeg, or LibreOffice. Fresh 0.4.0 source uses public read-only catalog discovery without a private configuration file; optional private profiles can be selected in Preferences. Earlier packages retain their version-specific setup requirements. Internet Remote Sessions also require separately provisioned per-host private configuration; self-service provisioning is not available. The Windows host used for development has been provisioned separately. Public HTTPS relay/browser end-to-end rehearsals passed in 0.3.0; physical-phone and venue-network checks remain. YouTube downloads require `yt-dlp` and its media-processing dependencies on the host; see [YouTube downloads](youtube-downloads.md). LibreOffice is only needed to generate planning documents, not to run the karaoke app.

## Linux

Version 0.5.0 Linux packages include the refreshed host workspace, selected Microphone Play icon, default lyric backdrop, public catalog discovery, provider metadata search, local ratings and bundled CLI. No 0.3.1 Linux build was produced. For an AppImage, save it in a folder you want to keep, allow it to run as a program in your file manager, and open it. From a terminal:

```sh
chmod +x Proper-Karaoke-Booth-0.5.0-linux-x86_64.AppImage
./Proper-Karaoke-Booth-0.5.0-linux-x86_64.AppImage
```

For Debian or Ubuntu, install the downloaded `.deb` through your software installer or use:

```sh
sudo apt install ./Proper-Karaoke-Booth-0.5.0-linux-amd64.deb
```

Run the app as your regular desktop user. Some distributions require AppImage/FUSE support libraries. The app's established profile is normally `~/.config/proper-karaoke-booth`, respecting the desktop's configuration location. Keep private catalog configuration and media separate from the downloaded package. Linux audio outputs, codecs, desktop launch, upgrade and removal still need verification on the intended show computer.

## macOS

For the macOS 27 Apple silicon build, use `Proper-Karaoke-Booth-0.5.0-mac-arm64.dmg`. The separate `Proper-Karaoke-Booth-0.5.0-mac-x64.dmg` is for Intel Macs; its runtime has not been tested on Intel hardware. The declared runtime minimum is macOS 13, but native launch was verified only on **macOS 27.0.1 (26A434), Apple silicon**.

Back up an existing show and close the app normally before replacing it. Open the DMG and drag **proper-karaoke-booth.app** to **Applications**, then eject the disk image and launch the copy in Applications. Alternatively, extract the matching `Proper-Karaoke-Booth-0.5.0-mac-arm64.zip` or `-mac-x64.zip`, keep the `.app` bundle intact and move it to Applications. The established profile is normally `~/Library/Application Support/proper-karaoke-booth`; moving or replacing the application is separate from that profile. An explicit startup profile is still honored.

These development bundles use **ad-hoc integrity signing**, not Apple Developer ID certification, and are **not notarized**. Gatekeeper may prevent first launch. For a trusted project build, consult [Apple's first-launch guidance](https://support.apple.com/en-us/102445). No Gatekeeper approval or Finder installation/upgrade/removal test is claimed.

The app, selected text-free microphone/play ICNS, CLI and silent TPV backdrop are bundled. `yt-dlp` and FFmpeg must be installed separately. Finder-launched applications may not inherit Homebrew's PATH; an absolute yt-dlp executable can be selected in Preferences. CDG conversion currently relies on finding FFmpeg through PATH and has no separate FFmpeg executable picker. Mac media conversion and physical audio/output/display behavior remain unverified.

### 0.4.4 Mac Verification

[GitHub Actions run 43528558467](https://github.com/thepropervolume/proper-karaoke-booth/actions/runs/43528558467) built frozen source `340eca77ce7618dc62dfa506cfeb82daf22d6e08` on the standard `xcode-27` ARM runner. The full suite passed **735 tests, with eight platform/environment skips and zero failures**; type checking and all 69 branding hashes passed. Both architecture bundles passed deep/strict ad-hoc signature checks, Mach-O architecture/metadata checks, icon/backdrop/CLI checks, read-only mounted-DMG verification and matching ZIP payload checks.

The native arm64 app opened with a disposable muted profile, retained a synthetic singer after restart, stayed stopped, displayed both theme logos correctly and kept minimum-width controls visible. Its bundled wrapper returned help with Node absent from PATH. Intel received static validation only. Full Mac app-to-CLI API lifecycle, native Dock appearance, installation/upgrade/removal, Gatekeeper approval and physical show hardware remain open.

The `release` folder contains separate arm64/x64 DMG and ZIP packages and their four `.blockmap` companions, plus `Proper-Karaoke-Booth-0.4.4-mac-build.json`, `-mac-verification.json` and `-mac-SHA256SUMS.txt`. These generated artifacts are excluded from Git. The successful workflow retains its installer artifact for 14 days. Windows/Linux packages were not rebuilt for 0.4.4, and this Windows installation remains 0.4.3.

## Building packages

Use a clean checkout with a supported Node.js installation and the committed lockfile:

```sh
npm ci
npm run package:win
```

On Linux, use `npm run package:linux` for x64 AppImage and `.deb` packages. On a Mac, use `npm run package:mac` for Intel and Apple silicon DMG and ZIP packages. macOS builds are rejected on other operating systems. AppImage support libraries may be required by the target Linux distribution. Windows/Linux publisher signing and Apple Developer ID signing/notarization are not configured for this development release.

### macOS Build Workflow

The manually dispatched **Package macOS development build** GitHub Actions workflow uses the standard `xcode-27` Apple silicon runner and checks the actual OS version before building. It uses the committed lockfile, runs source tests and branding checks, builds both architectures, and verifies DMG/ZIP payloads. Native launch checks use empty, muted disposable profiles. Intel payload checks on that runner do not establish Intel runtime compatibility. It never publishes a GitHub Release or changes a real show profile. Verified artifacts are retained for 14 days; download them before expiry.

Version 0.4.4 changes the Mac bundles from disabled signing to **ad-hoc integrity signing** and declares macOS 13 as the runtime minimum for Electron 45. The receipt retains `signed: false` to indicate there is no publisher certificate, and records `codeSigning: "ad-hoc"` and `notarized: false` separately. Deep/strict signature verification must pass before a Mac build receipt is issued. This does not establish Apple Developer ID certification or Gatekeeper approval. The Unix CLI launcher is sealed as `Contents/Resources/control/tpv-karaoke` inside the app; loose executable scripts in `Contents` prevent valid bundle signing. Native package evidence and remaining installation checks are recorded in the macOS section above.

Packaging type-checks the source, builds into a temporary directory, and copies only bundled app assets, the package manifest and generated dependency license notices. The silent default TPV lyric-backdrop video is copied to `resources/backdrops` outside `app.asar` so FFmpeg can read it; do not copy a user’s private video folder into the package. It does not clean the `dist` folder used by a running development app. Platform targets are defined in `electron-builder.config.mjs`; dependencies are pinned by `package-lock.json`. The build writes a JSON receipt with the source revision, dirty status, runtime/builder versions, and SHA-256 hashes, plus a `SHA256SUMS.txt` file next to the packages. These make builds traceable; package timestamps mean two builds are not guaranteed to be byte-identical.

To check a Windows package without opening the real show:

```sh
node scripts/packaged-app-smoke.mjs release/win-unpacked/proper-karaoke-booth.exe
```

This launches the actual packaged app using a new disposable profile, checks its version and packaged identity, verifies persistence after restart, and cleans up only the profile it created. It does not run the installer or change the normal show.

## Previous 0.2.0 build verification

Windows packages contain the final application at `f60e073`; Linux packages use `7bfa5f7`, whose only additional application-packaging change declares Debian runtime dependencies. Both include the same cache-access fix. The Windows receipt flags that Linux-only commit occurring during its build; no Windows payload changed. Versioned checksums and build receipts accompany both platforms. The Linux verification receipt records test-only root/virtual-display launch flags; normal packages retain their shipping sandbox defaults. Actual non-root desktop sandbox operation still needs checking.

## Before 1.0.0

The release checklist still includes additional Windows install/uninstall scenarios, Linux installation/upgrade/removal, native macOS packaging; code signing and macOS notarization; remaining native icon surfaces; backup/restore compatibility; and actual codecs, audio outputs, external displays, disconnect/reconnect, and recovery checks. One verified Windows upgrade does not establish those checks as complete.

## Previous 0.3 verification scope

The prior Windows 0.3 package imported all 237 MP4s from the reported folder into a disposable show, and searched the real shared catalog before dispatching an actual yt-dlp download when queued. The public remote rehearsal used isolated host/browser sessions and synthetic media; no real show was modified and no playback started. Linux used a private virtual display and test-only root flags, leaving shipping defaults unchanged. Neither package has undergone a new real-user 0.3 installation or physical hardware check.

## 0.3.1 Lyric Backdrop

New CDG imports use the bundled TPV Version 3 animation by default. Configure **Preferences → Singer Display → Lyric Backdrop** before importing. Choose the default animation, **Solid CDG Background**, or a custom local MP4. Custom videos stay at their chosen path and must remain readable during import. They are not copied into installers. Existing converted CDG songs need reimporting to change their backdrop. Future LRC playback will use the same preference; it is not implemented yet. The original selected TPV asset is unchanged.

0.3.1 package receipts record source `33eab78`. Their source-change flag is true because the documentation mockup and this smoke script were improved during packaging; application/runtime code and the backdrop did not change. The ZIP’s `app.asar` and backdrop hashes match the actual package used for the passing rehearsal. Run `node scripts/cdg-import-smoke.mjs /path/to/packaged/executable` for that isolated, muted check. Linux 0.4.0 packages now include the backdrop; no 0.3.1 Linux package was produced.

## Bundled CLI (introduced in 0.4.0)

Windows installs include `tpv-karaoke.cmd` beside the application executable. Use **Preferences → Local API and CLI → Show CLI Tool** to locate it. Enable that preference and save before using `status`, `capabilities`, `state`, `settings`, `shortcuts`, or `open settings` / `open keybindings`. No separate Node installation is required. The direct wrapper flags `--settings` and `--keybindings` also launch/focus the desktop while the API is disabled.

An installed/extracted Linux package includes the executable `tpv-karaoke` wrapper beside `proper-karaoke-booth`. To use an AppImage's bundled wrapper, extract it to a persistent folder with `./Proper-Karaoke-Booth-0.5.0-linux-x86_64.AppImage --appimage-extract` and run `./squashfs-root/tpv-karaoke --help`; keep the entire extracted folder together. The wrapper is not installed into the shell PATH automatically. The macOS 0.5.0 wrapper is inside the app at `Contents/Resources/control/tpv-karaoke`; its help command passed without external Node. Full Mac API lifecycle/navigation checks remain open. See [API/CLI commands and limits](local-control-api.md).

Historical Windows 0.4.0 receipts identify source `0e90733`, with `sourceRevisionChangedDuringBuild: false`. Their dirty flag records only the three pre-existing untracked deployment drafts, which packaging excludes. Version 0.4.0 full tests passed 679 checks with seven platform/environment skips; source UI/shortcut/ratings rehearsals and actual Windows packaged checks passed. Those muted synthetic checks did not verify installer execution, physical audio/displays or native desktop launcher surfaces.

Those receipts describe the historical 0.4.0 build. The 0.4.1 Windows receipt identifies frozen runtime source `24f5f15`, with no source revision change during packaging. Its dirty flag includes documentation/QA work and the three excluded deployment drafts. The integrated safety base passed 685 Windows tests with seven environment/platform skips, type checking and build; the policy-lock rehearsal and new actual-package/installed-branding checks also passed. Application runtime files in the ZIP and installed copy match the tested package. No physical audio/display or uninstall check is implied.

Linux 0.4.0 came from a SHA-verified Git archive of `0e90733` (archive SHA256 `2ea093afc52be978c98f2ca59e21481a43073bb2332a2a30c0d11d5812d1451c`). Its unaltered builder receipt has no Git checkout identity; the companion verification receipt records the verified archive/commit provenance and unchanged tracked files. Extracted AppRun and the executable LF wrapper passed private-profile checks, including a CLI-only PATH without Node and a loopback-only network namespace. Actual Debian installation, desktop integration and CDG conversion on Linux remain unverified. Existing services were unchanged.

## 0.4.1 Linux Evidence And Service Recovery

Linux 0.4.1 uses the frozen `24f5f15` archive with SHA256 `25259ac98c198b74b79ac1aa7cb5a7c4ad9e96e639b8c60925fb6e6b8fddbd8c`. All tracked source bytes remained unchanged. The companion `release/Proper-Karaoke-Booth-0.4.1-linux-verification.json` records 115 targeted passes with zero failures/skips, 69 branding hashes, matching AppImage/Debian payloads, ten default light PNG sizes, packaged Day/Night header logos/favicon, extracted AppRun restart/no-autoplay and public-catalog checks, bundled CLI/API lifecycle/navigation, and the packaged staged-policy rehearsal. Root/Xvfb launches used test-only `--no-sandbox` and `--disable-gpu` flags; shipping defaults were unchanged. Non-root desktop sandbox, Linux installation/upgrade/removal and physical show devices remain unverified.

An unattended MySQL upgrade had left the existing catalog, queue-relay and ratings services stopped. Linode III confirmed MySQL health, started only those three existing services and verified public health/search/empty-rating responses. No code, schema, credentials, provider configuration or website changes were made for recovery. A prevention proposal remains unapplied; no production MySQL restart was used as a test.

## 0.4.2 Provider Catalog Search

Windows installer/ZIP were built from runtime source `e501475`. The actual packaged and installed application passed live public KaraFun/Party Tyme library search, inactive partner status, search-only controls, disable/save and restored-show-policy checks in empty, muted private profiles. No song entered the queue or started playback. The full suite passed 723 tests with seven platform/environment skips; type checking and all 69 branding hashes passed. The app/setup still contain all nine approved icon frames.

This PC upgraded from 0.4.1 to 0.4.2 after a private backup at `C:\tmp\tpv-karaoke-backups\before-0.4.2-20261113T180532Z`. All seven original show/configuration hashes were unchanged afterward. Installed executable/ASAR and ZIP payloads match the tested unpacked application. The final build receipt records frozen runtime source and no source revision change during packaging; uncommitted documentation is excluded from application code. Packages are unsigned.

KaraFun/Party Tyme metadata needs internet for the first query in each app process and no account credentials. Complete public snapshots are cached in memory for up to 24 hours; restarting loses those provider snapshots. Stingray and Sunfly require provider-issued developer profiles. This does not connect subscription playback. See [provider catalog search and configuration](provider-catalog-search.md). Final Linux 0.4.2 AppImage/Debian packages from `e501475` passed matching payload, public search and compiled-CLI privacy checks. Twenty-one focused control/privacy tests passed; 119 unaffected earlier checks are retained by source comparison. The verification receipt records exactly what was rerun. Real-user Linux installation, sandbox, physical show hardware and macOS remain unverified.

## 0.4.3 Public Sunfly Store Search

Windows installer/ZIP use frozen runtime source `d14bfb2`. The actual packaged and installed application passed live KaraFun/Party Tyme search and Sunfly Store exact-SKU search (`SF1124621`), displaying the verified artist credit for Our Song. It also passed profile-mode clearing without deleting the selected synthetic file, inactive Stingray status, restrictive policy and preference guards, no queue/play promotion, and actual compiled-CLI private-path redaction. The full Windows suite passed 736 tests with seven environment/platform skips; type checking and all 69 branding hashes passed.

This PC upgraded from 0.4.2 to 0.4.3 after a protected backup at `C:\tmp\tpv-karaoke-backups\before-0.4.3-20261113T183618Z`; all seven original show/configuration hashes were unchanged. Public Store metadata does not connect subscriptions or playback. Store results cover at most five first-page title/SF-SKU matches, with optional verified artist metadata; artist search is not established. See [Sunfly Store behavior](sunfly-store-catalog.md). Linux 0.4.3 AppImage/Debian package checks passed from the same frozen runtime, including 52 focused tests and actual search/CLI/profile-clear checks, and physical show checks and native macOS remain open.
