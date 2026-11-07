# The Proper Volume Karaoke

A local-first desktop karaoke rehearsal foundation. This is early development software, not yet ready to run a live show. It does not contact the marketing site or require an account or internet connection after installation.

## Run on this laptop

Prerequisites: Node.js and npm. Automated rehearsals have run on Linux and Windows with Electron 45; macOS and physical audio/display devices still need testing. Install dependencies once (internet required), then build and start:

```bash
npm ci
npm run build
npm start
```

Electron may download its runtime on first use. The app keeps its SQLite database in Electron's user-data directory, outside this checkout; imported media remains at its original location. Back up the SQLite database and its WAL/SHM files together while the application is closed. Do not move a source file yet: relinking is not implemented.

## Rehearse

1. Use **Import Video File** or **Import Custom Directory** to add MP4 files. A directory scan includes subfolders; duplicate contents are skipped and originals stay in place.
2. Double-click a song, choose an existing singer or enter a new name, and select **Add to Queue**. A single click only selects the song. Requests are auto-approved by default; with moderation enabled, accept them in **Requests**.
3. Open **Singer Display** and choose the monitor. **Play/Pause** stages the next eligible song if necessary and starts it, or pauses/resumes an active performance. Stop and confirmed skip are available. Select a waiting queue item and press **Delete** to remove it; the active performance is not removed.
4. On restart the interrupted show is restored paused; open the singer display and deliberately resume. Stopping returns the current request to the queue; skipping consumes its turn.

Use the search icon or **Ctrl+F** to open library search, including from the singer display. Search matches artist and title. **Space** runs Play/Pause in either window when the host is not typing or operating a focused control. See [keyboard shortcuts](docs/keyboard-shortcuts.md) for defaults and customization.

Right-click a library song to add it to a playlist or the queue, edit its local metadata, or show the source file in the file manager. **Playlists** contains host-managed singer lists, KJ Picks, artist browsing and completed/skipped performance history. Genre browsing is not available until genre metadata exists. If a song is missing, use **Can't Find a Song?**; the request is saved for review and does not enter the rotation. There is no remote singer app yet. See the [singer guide](docs/singer-guide.md).

Use your system's existing audio output. Explicit device selection and reliable audio-device loss handling are not implemented; do not rely on this build to prevent operating-system rerouting. Singer-display and audio recovery need further testing on real hardware. Disconnecting a display previously used by the singer window may conservatively pause playback even after the window has moved elsewhere. Other MP4 codecs may not be playable even though the container is `.mp4`.

## Preferences

Open the **Preferences** gear for collapsible Appearance, Library Settings, Queue Management, Audio Controls and Singer Display groups. **Rotate singers fairly** gives each singer a turn before their next song; when unchecked, songs follow request order. A staged song remains locked until released or removed. Switching approval mode affects new requests only. Playback volume also appears below the transport; Singer Display can show upcoming singers and a host-selected PNG/JPEG logo.

Preferences are saved in `settings.json` in Electron's user-data directory. Use **Configuration Files** to reveal it or `keybindings.json` in the file manager; hover for the full path. Close the app before editing either file and restart to apply changes. Settings include appearance, layout, auto-approval, rotation mode, filename fallback, ordered `metadataTemplates`, master volume and singer-display options. Missing fields use defaults; invalid values or unknown fields are rejected. Back up these files with the show database.

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

- Local MP4 only. Paired MP3/CDG, ZIP, background import progress, relinking, seek UI, key/tempo, filler and output selection are not implemented. Import hashes files without copying; larger libraries need a dedicated background job and progress/cancellation UX.
- Library metadata comes from configurable filename parsing and local host edits; embedded tags, write-back, alias indexing and detailed version information remain planned. Ratings and policy are domain foundations, not a finished host policy interface; no guest catalog is exposed.
- Queue moderation, simple rounds, staged lock, generation checks and SQLite recovery are in place. Holds, attendance, manual reorder and richer rotation rules remain unimplemented.
- The local API, companion apps, cloud relay, profiles, providers and billing are not enabled or implemented. The command domain is an early foundation, not an externally accessible service. No local or LAN server is started.
- Night, Day and system theme work in the host; the singer display keeps source video colors unchanged. A full accessibility and multi-platform audit is still needed.

See [current handoff](docs/handoff.md), [product review and work list](docs/feature-review.md), [architecture and progress](docs/architecture.md), [roadmap](docs/roadmap.md), and [provider research](docs/provider-research.md).
