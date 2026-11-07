# Bumper playback prototype

This is an isolated prototype, not yet connected to the desktop application. No bumper audio, music, or placeholder assets are supplied. A host may select up to five existing local MP3, M4A, WAV, or OGG files; individual files and codecs still need to be playable by the app's media engine. The catalog stores the originals' paths in a private JSON file in the app's user-data directory. Removing an entry does not change or delete the original audio file. The renderer must only receive `list()` results, which contain IDs and names, never filesystem paths.

`BumperController` is a single authority for bumper playback. A host explicitly starts music once an output is available. When a track naturally ends, playback continues through the saved list; a stale ended event is ignored. The controller never starts music at launch, after output recovery, or after karaoke ends without a new host action.

## Integration contract

1. Construct one `BumperCatalog` in Electron's main process, plus one controller using `catalog.forPlayback()` and an adapter that plays through the chosen singer-display audio output. Keep source paths in the main process and expose at most an opaque, generation-bound media URL to the display. Never let the renderer supply a path or URL.
2. Restrict add, remove, start, and stop IPC to the authenticated host window. Add files only through the native picker, and use `controller.removeTrack(id, () => catalog.remove(id))` so removal and playback transitions are serialized. The picker needs to support multiple files while clearly reporting duplicate, missing, unsupported, and over-limit results.
3. Only mark the output available when the intended singer display is ready; set it unavailable and await the stop when that display is lost. Do not choose an operating-system output device automatically or fall back to a different destination.
4. Before starting **or resuming** karaoke, call `await controller.karaokeStarting()`. Start karaoke only if this succeeds. Call `karaokeEnded()` when karaoke is no longer active; do not call it on pause. Do not start bumper audio when the destination is uncertain.
5. The adapter's `stop()` must resolve only after the singer renderer acknowledges that its audio element is paused or has been destroyed. If acknowledgment times out, fail closed: prevent karaoke start rather than assume silence. Adapter `start()` must reject decode/playback errors and route generation-specific ended events back to `controller.ended(generation)`. Treat renderer loss and late acknowledgments as generation-bound events.
6. On application shutdown, await `controller.close()`. On restart, load the catalog but leave playback stopped. Present actual errors to the host. A future bundled catalog requires actual licensed, installed assets; no bundled options exist in this prototype.

Unit tests exercise catalog limits, persistence, preserving original files, stale events, start/stop races, failures, and output loss. They use a fake adapter; real Electron media playback, output routing, recovery, IPC authentication, and speaker/HDMI behavior remain untested until integration.
