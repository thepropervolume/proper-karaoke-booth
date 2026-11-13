# Crash and second-instance rehearsal

Build the app with platform-native Electron, then run the following with a generated synthetic MP4 long enough for the test; do not use a real song:

```text
node scripts/second-instance-smoke.mjs . <synthetic-mp4>
```

The script creates and verifies a disposable user-data profile, copies the fixture into its own temporary directory, and mutes audio. It imports the fixture, creates a singer and request, opens the singer display, and starts playback. It then starts a second Electron process with the same disposable profile and verifies that it exits while the original show, playback generation and windows remain unchanged. It forcibly terminates only its own first test process, restarts against the same profile, and checks that the same performance and queue are recovered paused under a new host epoch, without opening a singer display or automatically starting playback. Its temporary files are removed when the run finishes.

This tests the operating-system single-instance path and one interrupted-performance recovery scenario. It does not establish that every crash point, power loss, database corruption, physical audio device, external display or operating-system account has been tested. A separate profile is a separate application instance; this check does not coordinate independent profiles that happen to refer to the same source media. See `scripts/rehearsal-smoke.mjs` for the separate synthetic playback, display-close and stale-media-event rehearsal.
