# The Proper Volume Karaoke

A local-first desktop karaoke rehearsal foundation. This is early development software, not yet ready to run a live show. It does not contact the marketing site or require an account or internet connection after installation.

## Run on this laptop

Prerequisites: Node.js and npm. Automated rehearsals have run on Linux and Windows with Electron 45; macOS and physical audio/display devices still need testing. Install dependencies once (internet required), then build and start:

```bash
npm ci
npm run build
npm start
```

Electron may download its runtime on first use. The app keeps its SQLite database in Electron's user-data directory, outside this checkout; imported media remains at its original location. Use **Back up show…** to save a checked show database while the app is running. Choose a new filename; the app will not replace existing files. Video files, settings, keybindings, logos and other external files are not included. Back those up separately, and choose a private destination because the database contains singer information and library paths. Restore in the app is not available yet.

## Rehearse

1. Use **Import Video File** or **Import Custom Directory** to add MP4 files. A directory scan includes subfolders; duplicate contents are skipped and originals stay in place. The import panel shows current-file progress and paged results. You can cancel while continuing to use playback controls; songs already imported stay in the library. The current file is reported as cancelled and files not yet discovered are not processed. Results remain visible until the next import or app exit; folder totals grow during the scan.
2. Double-click a song, choose an existing singer or enter a new name, and select **Add to Queue**. A single click only selects the song. Requests are auto-approved by default; with moderation enabled, accept or reject them in **Requests**. The host can inspect recent rejected, withdrawn, removed, completed and skipped requests in **Request history**.
3. Open **Singer Display** and choose the monitor. Use the **Toggle singer display fullscreen** icon to expand or restore the singer window. **Play/Pause** stages the next eligible song if necessary and starts it, or pauses/resumes an active performance. Stop and confirmed skip are available. Select a waiting queue item and press **Delete** to remove it; the active performance is not removed.
4. On restart the interrupted show is restored paused; open the singer display and deliberately resume. Stopping returns the current request to the queue; skipping consumes its turn.
5. Use **Back up show…** in the workspace to save a database snapshot to a new file. If temporary cleanup needs attention, use **Retry backup cleanup**; the message says whether the backup was already saved. Filesystem support for hard links is required; some external or network drives may not support it.

Use the search icon or **Ctrl+F** to open library search, including from the singer display. Search matches title, artist, filename, DJ code and track number; the Sort and Filter controls narrow or order the visible library. Filenames are available only in the host window. **Space** runs Play/Pause in either window when the host is not typing or operating a focused control. See [keyboard shortcuts](docs/keyboard-shortcuts.md) for defaults and customization.

Right-click a library song to add it to a playlist or the queue, edit its local metadata, or show the source file in the file manager. **Playlists** contains host-managed singer lists, KJ Picks, artist browsing and completed/skipped performance history recorded from this version onward; earlier performances are not backfilled. Genre browsing is not available until genre metadata exists. If a song is missing, use **Can't Find a Song?**; the request is saved for review and does not enter the rotation. In **Requests**, the host can mark unavailable-song requests Pending, Reviewing, Fulfilled or Declined. See the [singer guide](docs/singer-guide.md).

If a source video moves, right-click the song and choose **Relink File…**, then select the original MP4. The replacement must match the complete imported file fingerprint; a different or edited file is refused, and neither file is changed. Reimport a different recording as a new song. Before a song starts, the app checks its full fingerprint and refuses a missing or changed source; large videos or slow drives can take longer to start. A normal pause/resume uses a quick identity check and rechecks the full file if it changed or the app restarted. The app cannot guarantee detection of a file modified after the check or during playback.

Experimental **Remote Queueing** is off until a host explicitly opens a local room. It requires a private IPv4 interface, a hostname resolving only to that interface, and a certificate and private key already trusted by Node and singers' devices. In Preferences, select the interface and TLS files, open the room, create an invitation and share its link privately. Singers can join, browse loaded songs, request one or ask for a missing song. They can withdraw their own pending or accepted requests; staged and playing songs remain locked. Close the room to revoke invitations and guest access. The room is not restarted automatically. Internet access, certificate provisioning and IPv6 hosting are not implemented; browser/phone trust, real venue DNS, firewall and device behavior still require physical testing. See [remote host controls](docs/remote-host-controls.md).

Choose an audio output in **Preferences → Audio Controls**, or use the system default. Changing the output pauses an active song. The player mutes and pauses on a reported device change, then requires deliberate resume; real device unplugging and OS-level rerouting still need physical verification. If the singer display closes or disconnects during playback, the host is warned and can reopen it before resuming. Disconnecting a display previously used by the singer window may conservatively pause playback even after the window has moved elsewhere. Playback errors are reported to the host, including a suggestion to check the file or codec. Other MP4 codecs may not be playable even though the container is `.mp4`.

## Preferences

Open the **Preferences** gear for collapsible Appearance, Library Settings, Karaoke Nerds Video Cache, Queue Management, Audio Controls and Singer Display groups. **Rotate singers fairly** gives each singer a turn before their next song; when unchecked, songs follow request order. A staged song remains locked until released or removed. Switching approval mode affects new requests only. Playback volume also appears below the transport; Singer Display can show upcoming singers and a host-selected PNG/JPEG logo. **Open singer display fullscreen** applies when the display is next opened; the host fullscreen icon affects only the current window. The host may limit each singer’s pending, accepted and staged future requests; playback and existing requests are not removed if the limit is lowered.

**Karaoke Nerds Video Cache** saves a base directory and optional brand and artist lists for a planned feature. Enter an absolute path on the host computer. Automatic caching is off by default; the checkbox records a future preference and does not start downloads. For future artist selection, a yt-dlp upload date may be used as an approximation when a verified publication date is unavailable; incomplete coverage or undated alternatives need review. No videos are downloaded or imported through this setting and the app does not yet browse the Karaoke Nerds catalog. An initial metadata snapshot was saved privately for development; the feed's YouTube watch links are not downloadable video files. The target path for a future eligible video is `BASE/PROVIDER/Brands/BRAND_SLUG/ARTIST/ARTIST - TRACK_NAME.EXT`, using the brand-page slug, subject to safe file handling and source permissions.

**Pause Interval** sets a 0–300 second gap after a song completes or is skipped. You may stage the next song during the gap; the host must press Play after the countdown, so there is no automatic playback. Pause, resume and stop do not begin a gap. The deadline survives restart and elapsed time while the app is closed counts. The default is zero.

**Bumper music** is an experimental host-controlled feature in Audio Controls. Open the singer display and save an explicit audio output first; the system-default choice is unavailable for bumper playback. Choose from three locally generated instrumental themes or add up to five of your own MP3, M4A, WAV or OGG files. Start and stop music manually; it continues through the list until stopped or karaoke starts. It does not start automatically after a song, at launch, or after an output change. Removing a custom entry does not delete the source file. Supported containers still depend on available codecs. Audio output and transitions require physical testing before live use.

Preferences are saved in `settings.json` in Electron's user-data directory. Use **Configuration Files** to reveal it or `keybindings.json` in the file manager; hover for the full path. Close the app before editing either file and restart to apply changes. Settings include appearance, layout, auto-approval, rotation mode, filename fallback, ordered `metadataTemplates`, master volume, output device, pause interval and singer-display options. Missing fields use defaults; invalid values or unknown fields are rejected. Back up these files with the show database.

Filename templates apply to new imports in priority order. Examples include `${DJ Code} - ${Artist} - ${Title}`, `${Track Number}.${Artist} - ${Title}`, `${Artist}/${Track Name}.mp4` and `${Title} - ${Artist}`. Fields cannot be repeated or adjacent without a separator; use `/` between folder components. Ambiguous matches are marked for metadata review. If nothing matches, the fallback format is used. Right-click and choose **Edit Metadata** to correct a local entry. Embedded tags are not read or written yet; originals remain unchanged.

## Verify

```bash
npm test
npm run build
./scripts/make-rehearsal-fixture.sh /tmp/tpv-rehearsal-fixture.mp4
xvfb-run -a node scripts/rehearsal-smoke.mjs /tmp/tpv-rehearsal-fixture.mp4
node scripts/interaction-smoke.mjs . /tmp/tpv-rehearsal-fixture.mp4
```

The fixture script needs FFmpeg with H.264/AAC encoders and refuses to overwrite an existing file. The smoke scripts need a graphical session (or Xvfb on Linux), use isolated temporary profiles and mute audio. They cover import, requests, queue removal, playlists/history, transport, display closure, forced termination and recovery. They do not verify speakers, an external mixer, HDMI hot-plug or audio-device failure. Delete the synthetic fixture when finished.

## Current boundaries

- Local MP4 karaoke video only. Paired MP3/CDG, ZIP, seek UI and key/tempo are not implemented. Import hashes files in a worker without copying them; actual large-library, network-drive and Dropbox behavior still needs testing. Experimental bumper playback has no fade or automatic intermission scheduling. Audio output selection has automated coverage but requires physical device-loss verification.
- Library metadata comes from configurable filename parsing and local host edits; embedded tags, write-back, alias indexing and detailed version information remain planned. Ratings and policy are domain foundations, not a finished host policy interface. The experimental local singer page exposes a policy-filtered guest catalog.
- Queue moderation, simple rounds, staged lock, generation checks and SQLite recovery are in place. Holds, attendance, manual reorder and richer rotation rules remain unimplemented.
- The general local API, companion apps, internet relay, profiles, playable provider integrations and billing are not implemented. The Karaoke Nerds metadata catalog has a local prototype; the owner chose a separate MySQL 8 database on the Linode for the future shared catalog, but that service is not deployed or connected to the desktop app. The experimental singer-only HTTPS service is off by default and opens only when the host explicitly starts a local room.
- Night, Day and system theme work in the host; the singer display keeps source video colors unchanged. A full accessibility and multi-platform audit is still needed.

See [current handoff](docs/handoff.md), [product review and work list](docs/feature-review.md), [architecture and progress](docs/architecture.md), [roadmap](docs/roadmap.md), and [provider research](docs/provider-research.md).
