# The Proper Volume Karaoke

Development **0.7.0** makes library search the main workspace: one readable result list combines local files, Karaoke Nerds, curated YouTube, connected native KaraFun and public service metadata. The sidebar search stays visible; Ctrl/Cmd+F or its assigned shortcut focuses it from any workspace. Provider labels and narrow colored borders distinguish sources without separate result panels. Context menus work across providers, with unavailable actions disabled.

Approved requests prepare and stage automatically. Press Play to start the show; by default completion or confirmed Skip advances after the configured gap and media readiness. Bumper music starts on launch and between songs, with a 1000 ms fade and optional custom tracks. Stop/Pause cancels delayed advancement; restarting always leaves karaoke paused. One hidden singer renderer supplies preview and audio even when the singer window is closed. Booth name, adjustable logo and an expiring scrolling banner customize the display.

Native KaraFun remains experimental. Complete the official sign-in under **Sources → KaraFun**, then search and queue through the usual singer dialog. Remembered sessions use operating-system encryption where available, retain their account cache identity and are checked before reuse. Sign-out forgets them. Each start/resume still needs current authorization. Physical audio, full-song synchronization, device recovery, native Linux/macOS provider playback and distribution/venue terms remain open. Other paid services expose search-only metadata until their playback integration is connected. See [source status](docs/source-status.md).

Windows/Linux/macOS **0.6.0** packages were verified from frozen source `6bcb7d5`; that historical evidence does not establish a built or installed 0.7.0 package. See [installation evidence](docs/installation.md) for delivered artifacts and limits. Updates use `0.x.y`; **1.0.0** is reserved for the approved official release.

## Run or Install

Active development uses `C:\Users\hello\Projects\proper-karaoke-booth`. The owner maintains Dropbox separately. Generated installers, receipts and planning files belong in the ignored local `release` directory. Node.js/npm are development prerequisites:

```bash
npm ci
npm run build
npm start
```

The app stores the show in local SQLite under Electron user data, separately from this checkout and the shared MySQL catalog/ratings services. Back up before schema-4 upgrades; downgrade requires a pre-upgrade profile/database backup. **File → Back up show…** saves the show database to a new path; media, preferences, keybindings, logos and private profiles require separate backup. In-app restore remains planned.

Private credentials, song media, yt-dlp, FFmpeg and LibreOffice are not bundled. yt-dlp/FFmpeg are needed for permanent YouTube acquisition and CDG conversion; LibreOffice is only for rendering generated documentation. The default silent lyric backdrop is bundled. Windows packages are unsigned; current Mac packages use ad-hoc signing without notarization.

## Host a Rehearsal

1. Import MP4 files/folders or same-name MP3+CDG/single-pair ZIP through **File → Import** or the library icons. Recursive imports report duplicates, failures and progress; cloud-only files must become readable. Originals remain in place. CDG converts through FFmpeg over the chosen backdrop.
2. Search, select a playable recording and double-click or use **Add to Queue**. Choose an existing singer or enter a new name. Auto-approval is the default; pending requests in moderation mode wait for Accept. Approved YouTube/Karaoke Nerds recordings download immediately through serial yt-dlp jobs. Failed downloads offer Retry.
3. Press **Play/Pause** once the first track is ready. The singer window opens on its remembered connected display, otherwise the closest non-host monitor, otherwise the current one. The next approved turn is prepared automatically; completion/Skip advances after the gap when enabled. Missing/failed media keeps its turn for recovery. Close hides the singer window while preview/audio continue.
4. Use Previous to restart the same song, scrub the bottom timeline, adjust volume or edit/reorder future requests. A staged request can change track/singer while keeping its identity and place; a playing performance is protected. Stop returns the current request to the queue and cancels advancement. Restart restores it paused.
5. Set the booth name, logo size and scrolling announcement under **Preferences → Singer Display**. Logo selection has an immediate preview. Banners can expire; persistence across launches is opt-in. Configure launch/interlude music and a 0–300-second gap in Audio Controls.

Right-click rows for queue, playlist, rating, metadata, file/relink or blacklist actions where supported. Hearts are per recording: source-less files use local SHA256 votes; identified recordings use the authenticated shared service. KaraFun catalog/community keys are implemented in 0.7.0; the live rating service requires the matching validator deployment before accepting them. Failure is reported rather than saved under a fake local identity.

## Remote and Configuration

**Remote Sessions** can create custom-slug internet request links at `queue.thepropervolume.com` using a separately provisioned private host profile. Experimental local request rooms require trusted venue HTTPS/DNS. These use the same host authority; neither opens a second SQLite writer. Physical phones, real venue networks and long-show reliability remain acceptance work.

**LAN Singer Screens** is a separate opt-in silent visual mirror on port 4051. The listener binds concrete private interface addresses plus loopback, rather than all interfaces. On Windows, private-range addresses must also have verified Private network classification; unknown/Public profiles stay loopback-only. A 30-second network recheck and bounded 5-second classification timeout remove lost trust. The app never installs a firewall rule or changes an organisation-managed policy. See [LAN sharing](docs/singer-screen-sharing.md).

Preferences stores validated editable JSON and registered shortcuts support multiple bindings, capture, conflicts and reset. Ctrl/Cmd/Alt+Comma opens Preferences; Ctrl/Cmd+Slash or F1 opens Keyboard Shortcuts; F/Shift+F toggles singer fullscreen. Space controls playback without stealing text entry. `--settings`/`--keybindings` target the existing app or open a new stopped instance at that view. The opt-in authenticated loopback API/CLI currently supports reads and settings navigation; general mutations remain planned.

Read the [host guide](docs/host-workspace.md), [singer guide](docs/singer-guide.md), [remaining work](docs/remaining-work.md), [architecture](docs/architecture.md) and [canonical specification](docs/product-specification.md). Generate all planning formats from that Markdown; mockups represent designs, not screenshots or hardware evidence.

## Verification Limits

Version 0.7.0 focused tests and isolated muted Electron rehearsals cover hidden preview, default-output startup bumper, fades, automatic staging/advancement, gap/download waits, Stop/Pause fencing, paused restart, concurrent Play, Previous, monitor-placement persistence and player-readiness recovery. Windows safeStorage was checked across independent disposable launches for remembered sign-in and explicit forgetting. These checks do not prove audible mixer output, physical hot-plug, native platform installations or provider rights. Verify those before a live show.
