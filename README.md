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

1. Select **Import MP4** and choose a local MP4. Files are fingerprinted and duplicate contents are skipped; the file is not copied. Filename `Artist - Title.mp4` is split into artist and title.
2. Add a singer, select the song in the library and add a request. In **Requests**, accept it.
3. Select **Stage next**, then **Singer display**, and choose the intended monitor. Move the display window as needed. Select **Start** explicitly. Pause, resume, stop and confirmed skip are available.
4. On restart the interrupted show is restored paused; open the singer display and deliberately resume. Stopping returns the current request to the queue; skipping consumes its turn.

Use your system's existing audio output. Explicit device selection and reliable audio-device loss handling are not implemented; do not rely on this build to prevent operating-system rerouting. Singer-display and audio recovery need further testing on real hardware. Disconnecting a display previously used by the singer window may conservatively pause playback even after the window has moved elsewhere. Other MP4 codecs may not be playable even though the container is `.mp4`.

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
- Library metadata is derived from filenames; alias indexing, metadata editing and detailed version information remain planned. Ratings and policy are domain foundations, not a finished host policy interface; no guest catalog is exposed.
- Queue moderation, simple rounds, staged lock, generation checks and SQLite recovery are in place. Holds, attendance, manual reorder and richer rotation rules remain unimplemented.
- The local API, companion apps, cloud relay, profiles, providers and billing are not enabled or implemented. The command domain is an early foundation, not an externally accessible service. No local or LAN server is started.
- Night, Day and system theme work in the host; the singer display keeps source video colors unchanged. A full accessibility and multi-platform audit is still needed.

See [architecture and progress](docs/architecture.md), [roadmap](docs/roadmap.md), and [provider research](docs/provider-research.md).
