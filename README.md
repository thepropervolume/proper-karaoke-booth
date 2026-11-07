# The Proper Volume Karaoke

A local-first desktop karaoke rehearsal foundation. This is early development software, not yet ready to run a live show. It does not contact the marketing site or require an account or internet connection after installation.

## Run on this laptop

Prerequisites: Node.js and npm. Development has been checked on Pop!_OS 24.04 Linux with Node 26.13 and Electron 45. Windows and macOS are targets, not yet tested. Install dependencies once (internet required), then build and start:

```bash
npm ci
npm run build
npm start
```

Electron may download its runtime on first use. The app keeps its SQLite database in Electron's user-data directory, outside this checkout; imported media remains at its original location. Back up the SQLite database and its WAL/SHM files together while the application is closed. Do not move a source file yet: relinking is not implemented.

## Rehearse

1. Select **Import MP4** to choose files, or **Import folder** to scan a folder and its subfolders for MP4 files. Files are fingerprinted and duplicate contents are skipped; the file is not copied. Filename `Artist - Title.mp4` is split into artist and title.
2. Select the song in the library and choose a singer, or add a new singer in the request form. Add the request. Requests are approved automatically by default; if auto-approval is disabled, accept them in **Requests**.
3. Select **Stage next**, then **Singer display**, and choose the intended monitor. Move the display window as needed. Select **Start** explicitly. Pause, resume, stop and confirmed skip are available.
4. On restart the interrupted show is restored paused; open the singer display and deliberately resume. Stopping returns the current request to the queue; skipping consumes its turn.

Use the search icon or **Ctrl+F** to open library search, including from the singer display. Search matches artist and title. **Space** pauses or resumes an active performance when the singer display is focused; in the host window it also works when focus is not in a text field or on a control. See [keyboard shortcuts](docs/keyboard-shortcuts.md) for defaults and customization.

If a song is missing, enter the singer's name, title and optional artist under **Can't find a song?** in the library. The request is saved locally and appears under **Missing-song requests** on the Requests screen; it does not add a song to the library or rotation. There is no remote singer app yet. See the [singer guide](docs/singer-guide.md) for the current host-assisted experience.

Use your system's existing audio output. Explicit device selection and reliable audio-device loss handling are not implemented; do not rely on this build to prevent operating-system rerouting. Singer-display and audio recovery need further testing on real hardware. Disconnecting a display previously used by the singer window may conservatively pause playback even after the window has moved elsewhere. Other MP4 codecs may not be playable even though the container is `.mp4`.

## Preferences

Open **Preferences** to choose the host appearance and layout, the filename format for newly imported songs, automatic request approval, and queue order. Singer rotation allocates requests to rounds, giving each singer a turn before their next song; first requested, first played uses the order in which requests arrived, even when they are approved out of order. A staged song remains locked until released. Switching approval mode affects new requests only; existing pending requests still need approval.

Preferences are saved in `settings.json` in Electron's user-data directory; the full path appears in the dialog. Close the app before editing this UTF-8 JSON file by hand and restart it to load changes. The available fields are `appearance` (`system`, `night`, or `day`), `autoApprove` (boolean), `rotationMode` (`singer` or `fifo`), `layout` (`standard`, `rotation`, or `library`), and `metadataFormat` (`artist-title`, `title-artist`, or `filename`). Missing fields use defaults; invalid values or unknown fields are rejected rather than silently changing settings. Back up this file with the show database. This file currently covers these preferences, not every application setting or keyboard shortcut.

The filename-format preference applies to newly imported files and does not rewrite existing library entries. Use **Edit** next to a song to correct its displayed title or artist in the local database. Reading embedded tags and writing edits back to media files are not yet supported; the original video remains unchanged. The intended future behavior is to let the host choose on each edit whether to update supported embedded tags as well, with local-only selected by default and a clear result if file writing fails.

## Verify

```bash
npm test
npm run build
./scripts/make-rehearsal-fixture.sh /tmp/tpv-rehearsal-fixture.mp4
xvfb-run -a node scripts/rehearsal-smoke.mjs /tmp/tpv-rehearsal-fixture.mp4
```

The fixture script needs FFmpeg with H.264/AAC encoders and refuses to overwrite an existing file. The Linux smoke test needs Xvfb and uses an isolated temporary profile and muted audio. It checks import, request, staging, video decoding and clock, transport, display closure, forced termination, paused recovery, completion, and rejection of stale media events. It does not verify speakers, external mixer, HDMI hot-plug or audio-device failure. Delete the synthetic fixture when finished.

## Current boundaries

- Local MP4 only. Paired MP3/CDG, ZIP, background import progress, relinking, seek UI, key/tempo, filler and output selection are not implemented. Import hashes files without copying; larger libraries need a dedicated background job and progress/cancellation UX.
- Library metadata comes from configurable filename parsing and local host edits; embedded tags, write-back, alias indexing and detailed version information remain planned. Ratings and policy are domain foundations, not a finished host policy interface; no guest catalog is exposed.
- Queue moderation, simple rounds, staged lock, generation checks and SQLite recovery are in place. Holds, attendance, manual reorder and richer rotation rules remain unimplemented.
- The local API, companion apps, cloud relay, profiles, providers and billing are not enabled or implemented. The command domain is an early foundation, not an externally accessible service. No local or LAN server is started.
- Night, Day and system theme work in the host; the singer display keeps source video colors unchanged. A full accessibility and multi-platform audit is still needed.

See [current handoff](docs/handoff.md), [product review and work list](docs/feature-review.md), [architecture and progress](docs/architecture.md), [roadmap](docs/roadmap.md), and [provider research](docs/provider-research.md).
