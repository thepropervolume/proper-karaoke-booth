# Product review and work list

Reviewed 6 November 2026 against the local working files based on commit `d258d12`, and KaraFun's published Windows and Player 2 documentation. The application is an early local rehearsal foundation, not yet a live-show replacement. Items below are independently actionable; unchecked items are proposals or work still to verify, not claims that the feature exists. See the implementation notes in this document and the source for the current state.

## Changes made during this review

On 7 November the host gained collapsible preferences, ordered filename/folder templates with ambiguity indicators, selectable songs and queue items, double-click requests, playlist/history views, volume and output selection, and optional next-singer and logo display. A Windows build and isolated, muted synthetic rehearsals passed; physical output and hot-plug tests remain open. The host can set a 0–300 second inter-song gap and manually start experimental bumper music on an explicitly selected output. Genre metadata and remote queueing are not yet implemented. Bumper audio and device loss still need physical verification.

The working copy now includes singer-display Space and cross-window search shortcuts, accessible transport/display icons, file and recursive folder import, inline singer creation, preferences and three layouts, default auto-approval, FIFO and singer-rotation choices, local artist/title edits and filename parsing options, and host entry of missing-song requests into SQLite. It also creates a keybindings JSON file for search and play/pause. These changes have domain/database tests, type checking and an isolated Windows Electron build and muted rehearsal; they still require real Windows display and audio testing. The checklist retains items that need that verification or further work. In particular, metadata edits do not yet write embedded file tags; missing-song requests are entered locally by the host, not by remote singers; and shortcut customization does not yet cover every action.

## What exists today

- Local MP4 import with content fingerprinting and duplicate detection; filename-derived artist/title; local SQLite state and paused recovery.
- Singer records, pending requests, a three-future-request limit, simple round-based rotation, staged songs and host transport controls.
- A separate singer display, display selection, theme choices, and a policy domain foundation.
- Domain and store tests and isolated Linux and Windows rehearsal scripts. Physical audio routing, device loss, display recovery and macOS still need verification.

## Priority 0 — dependable show operation

- [ ] Verify the Windows build, installer, codecs, sound output, external screen, monitor hot-plug and recovery on actual hardware.
- [x] Make Space pause/resume from the focused singer display and host window without stealing text entry.
- [x] Make Ctrl+F focus library search from the host and singer display and preserve normal text editing shortcuts.
- [x] Give the transport and singer-display buttons accessible names, disabled states and helpful tooltips; combine Play/Pause and use icons.
- [ ] Show decoding, missing-file, permission and unsupported-codec errors with a clear recovery path.
- [ ] Allow missing or moved media to be relinked and check whether a file has changed since import.
- [ ] Make display disconnect/reconnect and moving between monitors predictable; pause safely and offer explicit recovery.
- [ ] Add backup, restore and versioned SQLite migrations, including interrupted-write and upgrade tests.
- [ ] Offer import progress, cancellation, per-file results and nonblocking background hashing for large libraries.
- [ ] Confirm that a crash, restart or second app instance cannot corrupt the show or cause unexpected playback.

## Priority 1 — host workflow requested

- [x] Provide a dedicated settings dialog with collapsible groups and move Appearance into it.
- [ ] Store and validate all application settings in a documented, editable JSON or YAML file, with defaults, migration and useful error messages.
- [x] Offer auto-approval of song requests, enabled by default, with a manual moderation option.
- [x] Offer FIFO and fair singer rotation modes with a locked staged song and tested round behavior.
- [ ] Add a file-or-folder MP4 import choice, including recursive scan, duplicate reporting and inaccessible-file handling.
- [x] Allow a new singer's name to be entered while selecting a song, with a way to select an existing singer.
- [x] Add a search icon available throughout the host UI and focus search from the singer display.
- [ ] Add host-selectable metadata sources and precedence: embedded tags, configurable filename pattern, and manual overrides; preview and rescan safely.
- [ ] Edit artist and title locally, with a per-edit choice to also write supported embedded file tags. Default to local-only; report read-only or unsupported files and keep the local edit if an explicitly requested write fails. Local editing exists; the choice and file write-back do not yet exist.
- [ ] Define and enforce Host, Co-host, Moderator, Singer and Audience permissions at the service boundary, not only in the UI.
- [ ] Add persistent user profiles with name, account email, favorites, playlists, private notes and access level; allow self-editing except notes and access level.
- [ ] Add an unavailable-song request form and a persistent local requests table with host review and status.
- [ ] Offer useful host layouts: show/rotation focused, library focused, and compact single-screen; persist selection and keep critical controls visible.
- [ ] Provide a text keybindings file listing defaults and overrides for every actionable command, with conflict detection and a reset path.
- [ ] Provide a CLI for all app actions through one authenticated local authority, with help, structured output and stable exit codes; avoid a second SQLite writer.

## Priority 1 — queue and library depth

- [ ] Reject, withdraw and remove requests with clear status and history.
- [ ] Reorder accepted requests, promote a request, and move requests between singers without silently changing the staged track.
- [ ] Add singer hold, absence, return and skip-turn controls, with an explicit fairness policy for returning singers.
- [ ] Show current singer, next singers, queue position and a clearly approximate wait time.
- [ ] Make per-singer future-request limits configurable and explain why a request is rejected.
- [ ] Support duets/groups and multiple performers on a request.
- [ ] Start, save, restore and end shows; retain searchable singer and song history and export it to CSV.
- [ ] Search filenames as well as artist/title; add sort, filtering and responsive large-library navigation.
- [ ] Support watch/rescan of chosen folders, missing-file review, duplicate review and alternate song versions.
- [ ] Add batch metadata review and editing, including source/provenance and reversible local overrides.
- [ ] Add playlists and favorites with import/export and per-singer organization.
- [ ] Add paired MP3+CDG and ZIP support, with pairing and error diagnostics; evaluate other Player 2 formats separately.

## Priority 2 — playback and display

- [ ] Add a seekable timeline, elapsed/remaining time and reliable resume position.
- [ ] Add volume and explicit audio-output device selection, with loss and rerouting behavior tested on real hardware.
- [ ] Add pitch/key and tempo controls, with per-song and per-singer defaults and reset.
- [ ] Support independent lead/backing vocal controls only for sources that actually provide separate stems or compatible multiplex audio.
- [ ] Extend the experimental, manually started bumper music with automatic intermission scheduling, transitions and fade controls; verify playback and output changes on real hardware. Three synthesized themes and up to five custom files are available in Audio Controls.
- [ ] Verify the configurable inter-song gap on actual show hardware, including completion, skip and restart. The current countdown requires the host to start the next song manually.
- [ ] Offer fullscreen, monitor selection and configurable idle/now-playing/next-up singer screens.
- [ ] Add accessibility coverage for keyboard-only use, focus order, screen readers, high contrast and text scaling.
- [ ] Add automated integration tests for display focus, shortcuts, recovery, import and end-to-end queue flows.

## Priority 2 — users, remote use and administration

- [ ] Define identity, account ownership, sign-in/recovery and privacy rules before exposing user profiles remotely.
- [ ] Add singer browsing and requests on both local Wi-Fi and the internet with authentication, role checks, rate limits, reconnect behavior and a secure internet relay.
- [ ] Give users a clear way to view, export and delete their personal data; protect host-only notes.
- [ ] Add host management of roles and moderation actions with an audit trail.
- [ ] Add configurable content policy controls, including rating visibility and explicit-content restrictions.
- [ ] Add logs and diagnostics that avoid exposing media paths, account information or private notes unnecessarily.
- [ ] Add localization and accessible date, time and text formatting.

## Longer-term product opportunities

- [ ] Evaluate authorized catalog providers, search and entitlement/licensing rules rather than assuming access to KaraFun's catalog.
- [ ] Evaluate legal offline downloads, device synchronization, parental controls and cross-device playlists if a provider supports them.
- [ ] Consider quizzes, games, green-screen display and other entertainment modes after core show reliability.

## Comparison notes

KaraFun's current Windows application advertises catalog search, playlists, favorites, offline use and history; its [Windows page](https://www.karafun.com/karaoke-windows/) and [rotation documentation](https://www.karafun.com/help/windows_448.html) describe relevant benchmarks. Its [remote-control documentation](https://www.karafun.com/help/windows_404.html), [second-screen instructions](https://www.karafun.com/help/windows_405.html), and [keyboard shortcuts](https://www.karafun.com/help/windows_791.html) cover additional workflows. Current KaraFun and legacy Player 2 have different local-media capabilities: KaraFun says [version 3 no longer plays local files directly](https://www.karafun.com/help/general_97.html), while [Player 2 supports several local audio, karaoke and video formats](https://www.karafun.com/help/features_102.html). Player 2's [metadata settings](https://www.karafun.com/help/advanced_170.html) describe tags and filename patterns. Catalog, subscription and stem-dependent features require separate sources and rights; local MP4 playback alone does not provide them.
