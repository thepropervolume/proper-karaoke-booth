# Track position and seeking

Version 0.7.0 prepares approved requests automatically. Press **Play/Pause** to begin the staged first turn; it reveals the singer window on its remembered connected monitor, then the closest non-host screen, then the host screen. Preview works before that window is shown because one hidden singer renderer already exists. Closing the visible window hides it and retains the same preview/audio authority.

Natural completion or confirmed Skip automatically starts the next eligible song after the saved gap and required media preparation when automatic advancement is enabled. Pending requests still need acceptance in moderation mode. A positive gap can play bumper music; zero permits a seamless next start. Stop cancels pending advancement and bumper audio even without an active karaoke generation. Pause retains the active turn. Errors and output/display loss require deliberate recovery; launch/restart never starts karaoke. Startup bumper is a separate enabled-by-default preference.

The host's bottom transport includes a playback-position slider, elapsed and remaining time, and Rewind/Forward 10 seconds. Drag the slider or use its arrow, Page Up/Down, Home and End keys. Controls are disabled until the active player reports a finite duration and seekable media.

Seeking a paused performance keeps it paused. Only the current generation may acknowledge a seek; stale events from an earlier performance cannot update the current position. An acknowledged position is saved through the existing authority and is restored paused after restart. Seeking very near the endpoint can still lead naturally to the song ending when it plays.

Imported MP4s and permanently downloaded YouTube videos use the same local player and host timeline. The separate embedded preview remains outside the show transport. Output routing, real-device audio/lyric synchronization and recovery on physical show hardware still require verification.

The singer video fits within the window viewport with preserved aspect ratio and no page scrolling, including portrait and 4:3 videos. Optional branding and singer captions overlay the picture; they do not add height. The viewport regression checks three video shapes across four large, small and portrait window sizes.

Developer notes: `PlaybackTimeline` validates finite positions and duration, serializes seeks, requires decoder/provider acknowledgement and ignores telemetry during a pending seek. Display requests/acknowledgements have an unpredictable request ID and performance generation. Closing the app gives an in-flight seek a bounded chance to settle before the database closes; an unacknowledged seek is not promised durable.
