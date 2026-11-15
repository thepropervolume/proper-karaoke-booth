# Show reliability rehearsals

Use platform-native Electron and a generated H.264/AAC MP4 at least 20 seconds long. Never use a real song or a host's existing profile. Run desktop checks in a desktop session, or under `xvfb-run` on Linux. Audio is muted; these checks do not verify physical speakers or displays.

Build the current source before running the following scripts:

```text
npm run build
node scripts/rehearsal-smoke.mjs <synthetic-mp4>
node scripts/interaction-smoke.mjs . <synthetic-mp4>
node scripts/singer-availability-smoke.mjs
node scripts/second-instance-smoke.mjs . <synthetic-mp4>
node scripts/queue-edit-smoke.mjs
```

These scripts create and verify disposable profiles, disable external provider requests, and remove only their own temporary directories. The playback rehearsal covers the request dialog, automatic preparation, global search and Space shortcuts, uninterrupted playback when the visible singer window is closed, forced termination, paused recovery, natural completion, and stale decoder events. The interaction rehearsal checks focus-specific Delete behavior, metadata templates, changed-file refusal and exact-file relinking, bumper transitions, device-loss recovery, gap behavior with automatic advancement explicitly disabled, and persisted history. The availability rehearsal checks absence, early return, confirmation before releasing a prepared singer, persisted deadlines, and timed reintegration when no prepared song is locked. The queue rehearsal checks reordering and editing both waiting and prepared requests.

The second-instance rehearsal launches another process against the same disposable profile during playback. It checks that the duplicate exits without changing the host epoch, revision, queue, playback generation, or windows. It then terminates only its own process tree and verifies that the same performance restores paused under a new host epoch, without allocating a new generation. Recovery creates the hidden singer renderer used for preview and audio; it opens no visible singer window and starts no karaoke playback.

The focused workspace, transport, and automatic-show rehearsals build into isolated temporary directories:

```text
node scripts/search-workspace-smoke.mjs
node scripts/transport-display-smoke.mjs
node scripts/automatic-bumper-smoke.mjs
```

These cover unified source results, global search from dialogs and other workspaces, immediate branding previews, a preview without a visible singer window, automatic gaps/bumper music, concurrent Play, and cancellation of pending playback by Stop or Pause. No script requires the removed **Stage next** button: approved requests prepare automatically. Closing the visible singer window hides its existing renderer; renderer destruction and output loss remain separate recovery cases.

The four updated playback/interaction/availability/second-instance scripts were run successfully on Windows for 0.7.0 with synthetic media and muted audio. They do not establish that every crash point, power loss, database corruption, codec, operating-system account, physical output, or monitor hot-plug scenario has been verified. Separate profiles are independent application instances, even when they refer to the same media.
