# Bumper Playback and Automatic Transitions

Version 0.7.0 starts bumper music on launch by default, including when an interrupted karaoke performance is restored paused. Karaoke itself never resumes on launch. The system default audio output is usable; selecting a specific device remains optional. A hidden singer renderer owns both the real player and its silent preview, so opening a visible singer window is unnecessary for bumper audio.

**Preferences → Audio Controls** provides separate launch and between-song choices, both enabled by default. The fade-in defaults to 1000 ms and accepts 500–1700 ms. The automatic track is selectable from three original instrumental themes and up to five custom MP3, M4A, WAV or OGG files. Custom entries persist in private JSON; removing one never deletes its original file. Global volume applies to karaoke and bumper music. Separate filler volume, fade-out and richer scheduling remain planned.

Approved requests prepare and stage automatically. The host presses **Play/Pause** to start the show. With **Automatically start the next song** enabled, natural completion or confirmed Skip schedules the next eligible staged song after the configured 0–300-second gap and after required media is ready. Zero gap allows a seamless next start without a filler flash. A positive gap allows bumper music after the singer renderer confirms that the old karaoke generation is silent. If acquisition takes longer, music may continue until the recording is ready. Pending moderation is never bypassed. With automatic advancement disabled, the host starts each performance manually.

Stop cancels a scheduled start and stops bumper music even during an interlude with no active karaoke generation. Pause cancels advancement and retains the active turn. Output changes/loss, playback errors and loss of a visible singer display cancel delayed advancement and require deliberate recovery. Restoring an output or changing settings alone never starts karaoke. Missing/failed media retains the request and offers Retry or Relink instead of consuming a turn.

## Ownership and Safety

- Main owns `BumperCatalog`, `BumperController`, `AutomaticBumper` and `ShowAdvance`. Renderer-facing catalog data contains IDs/names and generation-bound media URLs instead of file paths.
- One persistent singer renderer produces karaoke, bumper audio and preview pixels. Closing its visible window hides it. Captures use `stayHidden`/`stayAwake`; preview creates no second player or audio sink.
- Every karaoke start/resume awaits bumper-stop acknowledgement. Missing acknowledgement prevents karaoke from starting. Bumper after completion/Skip requires the authorised old-generation silence acknowledgement; launch has no old generation to acknowledge.
- Async starts recheck cancellation, staged identity, policy, media identity and account authorization before commit. Stop/Pause invalidates delayed work at intent time, including during verification. Preparation failure never silently advances to another singer.
- Fade starts from silence, follows live volume changes and cancels before Stop or device-loss muting. Retired players/callbacks cannot affect a newer generation.
- Destroyed renderers invalidate pending acknowledgements. Device changes mute bumper immediately and require deliberate recovery. An operating system can reroute before notification; physical verification is still required.

Settings schema 2 adopts the requested between-song default once for older unversioned/schema-1 files; explicit schema-2 opt-outs persist. Migration never starts karaoke or changes the saved gap.

Focused tests cover fade, default/explicit output, cancellation, moderation, staged locks, download waits, failures and acknowledgements. `scripts/automatic-bumper-smoke.mjs` passed an isolated muted Electron rehearsal of hidden preview, launch music, completion/Skip gaps, Stop and paused restart. `scripts/transport-display-smoke.mjs` passed concurrency, Previous, hidden-window, monitor-placement and readiness-timeout recovery checks. These checks do not verify audible speakers/mixers, physical hot-plug, full-song synchronization or platform packages.
