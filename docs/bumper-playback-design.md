# Experimental bumper playback

The desktop app has an experimental host-controlled bumper player in **Preferences → Audio Controls**. The app generates three short original instrumental WAV themes locally. A host can also select up to five local MP3, M4A, WAV or OGG files; individual codecs still depend on the media engine. The custom catalog persists in a private JSON file in the app user-data directory. Removing an entry does not delete or modify the original file.

To play bumper music, open the singer display, save a specific audio output (the system-default option is not accepted for this feature), select a track and choose **Play bumper**. The player continues through its list until explicitly stopped or karaoke starts. Playback must be started by a host action; it does not begin on launch, after a song ends, or after output recovery. A paused karaoke performance still owns playback and prevents bumper music. The main volume control applies to both players. Automatic scheduling and fades are future work.

## Ownership and safety design

- The main process owns `BumperCatalog` and `BumperController`; renderer-facing catalog data contains IDs and names rather than source paths. The display receives an opaque, generation-bound media URL, not an arbitrary renderer-provided path.
- Host IPC is limited to the host window. Custom files are selected through a native picker; track removal and playback transitions are serialized by the controller. The five-file limit applies to custom files, in addition to the three generated themes.
- Bumper playback requires an explicit selected sink and a ready singer display. The display player mutes during output changes. Loss or change of output stops bumper playback and requires a deliberate new host action; a system-level reroute can happen before the app receives a device-change event.
- Before karaoke starts or resumes, the main process awaits `karaokeStarting()`. The output adapter must acknowledge that its media element has stopped, or playback fails closed rather than assuming silence. Karaoke pause does not release ownership. Generation-specific events prevent a stale bumper callback from advancing the list.
- Display destruction invalidates pending output acknowledgments and makes the output unavailable. Preferences output changes pause an active performance; resumed playback requires a deliberate host action. Paths to source media stay private to the main process.

Unit tests cover catalog limits, persistence, original file preservation, generation checks, start/stop races and output failures. Integration and muted synthetic rehearsals do not establish that sound reaches the intended physical device or that the operating system cannot reroute it. Verify speakers, external mixers, HDMI, actual unplug/reconnect, shutdown, and cross-platform packaging before live use; do not treat software tests as proof of those behaviors.
