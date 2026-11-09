# Architecture and progress

## First milestone

The Electron main process owns the local show. The host UI and singer display are isolated renderers with narrow preload bridges. The host sends validated commands to pure show rules; SQLite commits show changes and private media locations before the host is notified. The singer window is the only media player. It reports its clock and completion with a playback generation; preparing a staged request does not start audio. The native media element is an experiment, not the final engine decision.

State is currently stored as a serialized show in SQLite, with media locations and playback checkpoints in private tables. SQLite uses WAL and synchronous FULL. A new host epoch is issued on restart, and an interrupted performance is restored paused. Command receipts and expected revisions exist in the domain, but the host bridge currently generates command IDs itself: end-to-end client retry and outcome-unknown semantics are not yet implemented. No remote transport or local API is listening. A future authenticated service must use these same rules rather than expose the raw database.

The host renderer gets no arbitrary filesystem or generic IPC access. Imports go through a native file picker, SHA-256 fingerprints are stored, and the video is delivered through a generation-scoped local protocol. This is a rehearsal implementation requiring further adversarial security, permission, renderer and output-loss testing. Avoid adding remote content to either renderer.

Metadata corrections currently update the local library only; embedded tag reading and write-back are not yet implemented. Product direction is a per-edit choice: local-only by default, or explicitly request writing supported embedded tags as well. A failed or unsupported file update must be reported without discarding the local correction. Import, rescan, and ordinary edits must never implicitly modify source media. See the [write-back plan](metadata-writeback-plan.md) for the preservation and concurrency requirements.

New requests default to automatic approval, with optional moderation. This supersedes the original handoff's moderated-by-default direction. A setting change affects new requests rather than silently approving pending ones. FIFO and singer-round choices operate on the same durable queue; staged requests remain locked.

## Media investigation

On this laptop, FFmpeg advertises CDG decoding, H.264/AAC/MP3 codecs, rubberband/atempo and fades; mpv 0.37, GStreamer and PipeWire are installed. Their presence does not establish a working synchronized player. Evaluate paired CDG/audio timing and seek reconstruction, independent real-time pitch/tempo, output-device selection and loss, single-audio ownership, filler transitions and packaging/licensing on each platform before choosing an engine. MP4 is a container; codec support varies.

Automated Linux rehearsal used Electron with a generated 20-second H.264/AAC fixture and muted audio. It checked real video dimensions and advancing media time, not physical sound output. No Windows or macOS runtime has been tested. A real second-monitor unplug and audio-device unplug remain unverified. The host chooses a monitor when opening the display. A disconnect of any monitor previously used by that open window can conservatively pause playback, even after the window moves to another monitor.

## Known limitations and next steps

See the [roadmap](roadmap.md). In particular, song restrictions need owner controls, richer evidence and enforcement at every eventual API boundary. Do not treat the current non-age-restricted local catalog as proof that guest policy is complete. The current domain captures a small subset of rotation behavior; future additions require transactional and concurrency tests. No customer service, external storage, billing or provider credentials are used by the desktop application. A separate local Karaoke Nerds catalog prototype accepts a privately supplied credential and is not deployed or connected to the app. The owner chose a dedicated MySQL 8 database on the Linode for its future shared catalog, with a private central updater, authenticated client service and independent backups. Preserve the local SQLite show database and keep both provider and database credentials out of clients; see [catalog groundwork](karaokenerds-catalog.md).
