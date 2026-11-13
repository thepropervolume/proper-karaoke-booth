# Installing The Proper Volume Karaoke Booth

The current development version is **0.4.3**. Windows installer/ZIP, the actual Windows upgrade, and Linux AppImage/Debian packages passed the checks below. The official release target remains **1.0.0**. Several focused commits delivered together may share one version.

## Available packages

| Platform | Package | Current verification |
| --- | --- | --- |
| Windows 64-bit | Assisted installer and extractable ZIP | 0.4.3 from `d14bfb2`; installed upgrade, three public metadata sources, exact Store SKU/artist, file retention, CLI privacy, policy, no-autoplay and payload checks passed. Seven original show/configuration hashes preserved. |
| Linux 64-bit | AppImage and Debian | 0.4.3 from verified `d14bfb2` archive; 52 focused tests, payload/branding and actual public search/CLI/profile-clear checks passed. Linode product-detail HTTP 403 produces explicit unknown artist; identity and safe fallback passed. Non-root desktop, installation and hardware remain unverified. |
| macOS Intel and Apple silicon | `.dmg` and ZIP build targets | Must be built and verified on a Mac. No macOS package claimed yet. |

Generated files live in the repository's `release` folder and are not committed to Git. Windows development packages are **unsigned**. Version 0.4.1 uses the owner-selected [Microphone Play](app-icon-options.md) identity: the original navy microphone on a white rounded tile is the default installed icon, with no visible text. Matching light/dark masters and exports are retained; the full logo reads **TPV / KARAOKE BOOTH**. All 69 generated hashes, both ICO/ICNS sets and actual Windows icon resources passed verification. Assisted NSIS setup includes proportional 150×57 header and 164×314 sidebar artwork in 24-bit BMP files. Earlier installers retain their previous identity, including 0.4.0 Velvet Script. Windows may identify unsigned packages as an unrecognized publisher. Only use packages from a trusted project build. Native macOS/Linux desktop appearance, physical show behavior and platform signing remain release gates.

## Windows

Finish or stop the current show and close the app normally before replacing an installed version. Run `Proper-Karaoke-Booth-0.4.3-windows-x64-setup.exe` and follow the installation wizard. It defaults to installation for the current user, allows choosing a destination, and creates a Start menu shortcut. It does not automatically start the app after installation. Administrator elevation and a desktop shortcut are disabled by default.

Alternatively, extract the entire `Proper-Karaoke-Booth-0.4.3-win-x64.zip` to a folder and open `proper-karaoke-booth.exe`. Keep its supporting files together. The ZIP uses the same application profile as the installer; it is not a separate show profile.

The show database, settings and keybindings stay in the existing `proper-karaoke-booth` user-data directory (normally `%APPDATA%\proper-karaoke-booth` on Windows). An explicit `--user-data-dir` or a custom startup profile is honored before the single-instance check. Uninstalling is configured to preserve application data. Back up the show before upgrading; uninstalling is not a backup procedure.

On 13 November, the existing installation on this PC was upgraded silently from 0.2.0 to 0.4.1. Before installation, an owner/SYSTEM-only backup was saved at `C:\tmp\tpv-karaoke-backups\before-0.4.1-20261113-021951`, including a consistent SQLite backup and configuration files. The original show database and configuration bytes were unchanged afterward. The installed path is `%LOCALAPPDATA%\Programs\proper-karaoke-booth\proper-karaoke-booth.exe`; its version is 0.4.1.0. The Start menu shortcut and uninstall registry entry point to the installed icon resources. This verifies one actual upgrade, not uninstall behavior or physical-show readiness.

The installer includes the app, Electron runtime and default silent TPV lyric backdrop. It does not bundle song media files, account credentials, a shared catalog database, `yt-dlp`, FFmpeg, or LibreOffice. Fresh 0.4.0 source uses public read-only catalog discovery without a private configuration file; optional private profiles can be selected in Preferences. Earlier packages retain their version-specific setup requirements. Internet Remote Sessions also require separately provisioned per-host private configuration; self-service provisioning is not available. The Windows host used for development has been provisioned separately. Public HTTPS relay/browser end-to-end rehearsals passed in 0.3.0; physical-phone and venue-network checks remain. YouTube downloads require `yt-dlp` and its media-processing dependencies on the host; see [YouTube downloads](youtube-downloads.md). LibreOffice is only needed to generate planning documents, not to run the karaoke app.

## Linux

Version 0.4.3 Linux packages include the selected Microphone Play icon, default lyric backdrop, public catalog discovery, Sunfly Store search and bundled CLI. No 0.3.1 Linux build was produced. For an AppImage, save it in a folder you want to keep, allow it to run as a program in your file manager, and open it. From a terminal:

```sh
chmod +x Proper-Karaoke-Booth-0.4.3-linux-x86_64.AppImage
./Proper-Karaoke-Booth-0.4.3-linux-x86_64.AppImage
```

For Debian or Ubuntu, install the downloaded `.deb` through your software installer or use:

```sh
sudo apt install ./Proper-Karaoke-Booth-0.4.3-linux-amd64.deb
```

Run the app as your regular desktop user. Some distributions require AppImage/FUSE support libraries. The app's established profile is normally `~/.config/proper-karaoke-booth`, respecting the desktop's configuration location. Keep private catalog configuration and media separate from the downloaded package. Linux audio outputs, codecs, desktop launch, upgrade and removal still need verification on the intended show computer.

## Building packages

Use a clean checkout with a supported Node.js installation and the committed lockfile:

```sh
npm ci
npm run package:win
```

On Linux, use `npm run package:linux` for x64 AppImage and `.deb` packages. On a Mac, use `npm run package:mac` for Intel and Apple silicon DMG and ZIP packages. macOS builds are rejected on other operating systems. AppImage support libraries may be required by the target Linux distribution. Windows/Linux publisher signing and Apple Developer ID signing/notarization are not configured for this development release.

### macOS Build Workflow

The manually dispatched **Package macOS development build** GitHub Actions workflow uses the standard `xcode-27` Apple silicon runner and checks the actual OS version before building. It uses the committed lockfile, runs source tests and branding checks, builds both architectures, and verifies DMG/ZIP payloads. Native launch checks use empty, muted disposable profiles. Intel payload checks on that runner do not establish Intel runtime compatibility. It never publishes a GitHub Release or changes a real show profile. Verified artifacts are retained for 14 days; download them before expiry.

Version 0.4.4 changes the Mac bundles from disabled signing to **ad-hoc integrity signing** and declares macOS 13 as the runtime minimum for Electron 45. The receipt retains `signed: false` to indicate there is no publisher certificate, and records `codeSigning: "ad-hoc"` and `notarized: false` separately. Deep/strict signature verification must pass before a Mac build receipt is issued. This does not establish Apple Developer ID certification or Gatekeeper approval. Native package and installation evidence is recorded separately below after a successful build.

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

An installed/extracted Linux package includes the executable `tpv-karaoke` wrapper beside `proper-karaoke-booth`. To use an AppImage's bundled wrapper, extract it to a persistent folder with `./Proper-Karaoke-Booth-0.4.3-linux-x86_64.AppImage --appimage-extract` and run `./squashfs-root/tpv-karaoke --help`; keep the entire extracted folder together. The wrapper is not installed into the shell PATH automatically. macOS wrapper layout is configured but remains unbuilt. See [API/CLI commands and limits](local-control-api.md).

Historical Windows 0.4.0 receipts identify source `0e90733`, with `sourceRevisionChangedDuringBuild: false`. Their dirty flag records only the three pre-existing untracked deployment drafts, which packaging excludes. Version 0.4.0 full tests passed 679 checks with seven platform/environment skips; source UI/shortcut/ratings rehearsals and actual Windows packaged checks passed. Those muted synthetic checks did not verify installer execution, physical audio/displays or native desktop launcher surfaces.

Those receipts describe the historical 0.4.0 build. The 0.4.1 Windows receipt identifies frozen runtime source `24f5f15`, with no source revision change during packaging. Its dirty flag includes documentation/QA work and the three excluded deployment drafts. The integrated safety base passed 685 Windows tests with seven environment/platform skips, type checking and build; the policy-lock rehearsal and new actual-package/installed-branding checks also passed. Application runtime files in the ZIP and installed copy match the tested package. No physical audio/display or uninstall check is implied.

Linux 0.4.0 came from a SHA-verified Git archive of `0e90733` (archive SHA256 `2ea093afc52be978c98f2ca59e21481a43073bb2332a2a30c0d11d5812d1451c`). Its unaltered builder receipt has no Git checkout identity; the companion verification receipt records the verified archive/commit provenance and unchanged tracked files. Extracted AppRun and the executable LF wrapper passed private-profile checks, including a CLI-only PATH without Node and a loopback-only network namespace. Actual Debian installation, desktop integration and CDG conversion on Linux remain unverified. Existing services were unchanged.

## 0.4.1 Linux Evidence And Service Recovery

Linux 0.4.1 uses the frozen `24f5f15` archive with SHA256 `25259ac98c198b74b79ac1aa7cb5a7c4ad9e96e639b8c60925fb6e6b8fddbd8c`. All tracked source bytes remained unchanged. The companion `release/Proper-Karaoke-Booth-0.4.3-linux-verification.json` records 115 targeted passes with zero failures/skips, 69 branding hashes, matching AppImage/Debian payloads, ten default light PNG sizes, packaged Day/Night header logos/favicon, extracted AppRun restart/no-autoplay and public-catalog checks, bundled CLI/API lifecycle/navigation, and the packaged staged-policy rehearsal. Root/Xvfb launches used test-only `--no-sandbox` and `--disable-gpu` flags; shipping defaults were unchanged. Non-root desktop sandbox, Linux installation/upgrade/removal and physical show devices remain unverified.

An unattended MySQL upgrade had left the existing catalog, queue-relay and ratings services stopped. Linode III confirmed MySQL health, started only those three existing services and verified public health/search/empty-rating responses. No code, schema, credentials, provider configuration or website changes were made for recovery. A prevention proposal remains unapplied; no production MySQL restart was used as a test.

## 0.4.2 Provider Catalog Search

Windows installer/ZIP were built from runtime source `e501475`. The actual packaged and installed application passed live public KaraFun/Party Tyme library search, inactive partner status, search-only controls, disable/save and restored-show-policy checks in empty, muted private profiles. No song entered the queue or started playback. The full suite passed 723 tests with seven platform/environment skips; type checking and all 69 branding hashes passed. The app/setup still contain all nine approved icon frames.

This PC upgraded from 0.4.1 to 0.4.2 after a private backup at `C:\tmp\tpv-karaoke-backups\before-0.4.2-20261113T180532Z`. All seven original show/configuration hashes were unchanged afterward. Installed executable/ASAR and ZIP payloads match the tested unpacked application. The final build receipt records frozen runtime source and no source revision change during packaging; uncommitted documentation is excluded from application code. Packages are unsigned.

KaraFun/Party Tyme metadata needs internet for the first query in each app process and no account credentials. Complete public snapshots are cached in memory for up to 24 hours; restarting loses those provider snapshots. Stingray and Sunfly require provider-issued developer profiles. This does not connect subscription playback. See [provider catalog search and configuration](provider-catalog-search.md). Final Linux 0.4.2 AppImage/Debian packages from `e501475` passed matching payload, public search and compiled-CLI privacy checks. Twenty-one focused control/privacy tests passed; 119 unaffected earlier checks are retained by source comparison. The verification receipt records exactly what was rerun. Real-user Linux installation, sandbox, physical show hardware and macOS remain unverified.

## 0.4.3 Public Sunfly Store Search

Windows installer/ZIP use frozen runtime source `d14bfb2`. The actual packaged and installed application passed live KaraFun/Party Tyme search and Sunfly Store exact-SKU search (`SF1124621`), displaying the verified artist credit for Our Song. It also passed profile-mode clearing without deleting the selected synthetic file, inactive Stingray status, restrictive policy and preference guards, no queue/play promotion, and actual compiled-CLI private-path redaction. The full Windows suite passed 736 tests with seven environment/platform skips; type checking and all 69 branding hashes passed.

This PC upgraded from 0.4.2 to 0.4.3 after a protected backup at `C:\tmp\tpv-karaoke-backups\before-0.4.3-20261113T183618Z`; all seven original show/configuration hashes were unchanged. Public Store metadata does not connect subscriptions or playback. Store results cover at most five first-page title/SF-SKU matches, with optional verified artist metadata; artist search is not established. See [Sunfly Store behavior](sunfly-store-catalog.md). Linux 0.4.3 AppImage/Debian package checks passed from the same frozen runtime, including 52 focused tests and actual search/CLI/profile-clear checks, and physical show checks and native macOS remain open.
