# Remaining work

Updated 13 November 2026 from the current checkout. This is the working checklist for the karaoke application; an unchecked item means work or verification remains, and a partial implementation is called out explicitly. Priorities follow the owner's requests: reliable show operation and a playable streaming service first. Time and complexity are not estimates. The broader historical comparison is in [feature review](feature-review.md); [handoff](handoff.md) and [product specification](product-specification.md) explain decisions and current boundaries.

## Current foundation

The host can import local MP4s, search and locally edit artist/title, create singers and queue requests, use FIFO or simple fair rotation, play to a separate singer window, back up the show database, change settings and configure common action shortcuts through the grouped editor. The host has implemented shared catalog connection/preferences and offline query-cache support, with public read-only shared discovery on fresh installs and a legacy local-catalog mode when shared discovery is disabled. Live Windows HTTPS status/search and durable saved-query offline reuse have passed. The deployed dedicated MySQL service is seeded from the recovered 64,261-record raw snapshot, but upstream freshness/retirement state is unknown and refresh is disabled; supported YouTube recordings can be downloaded permanently with yt-dlp and played through the normal local library and queue; a separate preview also remains available. MP3/CDG and single-pair ZIP import convert to managed MP4 through external FFmpeg. An opt-in experimental local-network singer page and an offline synthetic native singer preview exist. None of these establish that the app is ready for a live show. No paid provider is connected for playback.

## Priority 0 — streaming and catalog

- [x] Send KaraFun an OEM content/playback API inquiry (owner submitted through Business support on 11 November 2026; reply pending).
- [x] Inspect the owner-provided Business API specification and test the dashboard token read-only: device listing returned 402 and room-token listing 403; content/playback access remains unverified.
- [ ] Review KaraFun's reply and obtain OEM documentation, developer/sandbox credentials, eligible account-linking rules, applicable usage/territory rights and all fees; the existing consumer subscription has not been proven usable in this app.
- [ ] Implement and test approved KaraFun account linking, secure credential storage, refresh/revocation and entitlement checks.
- [ ] Add KaraFun catalog search and exact recording/version identity.
- [ ] Integrate approved KaraFun playback with the singer display, queue, transport, reporting and permitted offline behavior; handle failures without losing a turn.
- [x] Send Stingray a catalog/playback partnership inquiry covering per-user access, private parties and commercial events (owner sent on 11 November 2026; reply pending).
- [ ] Review Stingray's reply and obtain partner credentials, price, existing-subscription and public-use terms; its fixture-tested developer login/search tools are not a playable service.
- [ ] Verify Stingray login and catalog search with an authorized real account and confirm the applicable API-key/OAuth flow.
- [ ] Add Stingray permitted playback and play reporting; enforce its provider-specific asset-storage restrictions.
- [ ] Obtain Sunfly trial/partner access, Electron playback SDK, quote, public-use and territory terms; its fixture-tested account/catalog tools do not play songs.
- [ ] Verify Sunfly account, change-feed pagination, subscription and withdrawal handling with a real approved account.
- [ ] Integrate Sunfly encrypted media, license acquisition/expiry, SDK playback and required play reporting.
- [ ] Investigate Party Tyme and Karaoke Cloud Pro vendor access, account compatibility and complete costs; evaluate each additional service against the owner's under-$20/month per-service target.
- [ ] Add provider-specific login/logout, connection state, credential redaction, subscription eligibility and clear renewal/outage errors.
- [ ] Keep app billing and each provider subscription separate; do not assume one grants another.
- [x] Unify local and Karaoke Nerds search in Song Library, preserving exact recording identity, host edits, filters and offline local results.
- [x] Queue a catalog recording with singer selection in one host-authority operation; approved requests dispatch serial yt-dlp acquisition without autoplay.
- [ ] Extend unified discovery to approved paid providers when access is granted.
- [ ] Make eligible streaming results requestable and queueable with singer selection and normal rotation rules.
- [ ] Route eligible provider playback to the singer display and selected audio output with stage/play/pause/stop/skip and safe transition handling.
- [ ] Handle expired links, network failure, provider unavailability, rate limits, ads and unsupported or region-blocked recordings without consuming a singer's turn.
- [x] Add permanent yt-dlp downloads, progress/cancel/retry, exact-ID hash-verified reuse and local/offline playback through the regular queue and singer display.
- [ ] Verify the installed application identity, visible-player and referrer requirements for the separate distributed YouTube preview; queued performances now use downloaded local media.
- [ ] Verify download interruption/recovery, cached output selection and physical singer-display behavior on show hardware.
- [ ] Package/test yt-dlp and FFmpeg installation, upgrades and all supported operating systems.
- [x] Deploy the dedicated shared MySQL catalog search service behind HTTPS and verify server backup/scratch restore using the recovered raw snapshot.
- [ ] Finish production monitoring, recovery/rotation operations and real desktop end-to-end verification; deployed search is not a working daily-refresh pipeline.
- [ ] Replace full-snapshot refresh reads with indexed queries and load-test concurrent clients. A 30-second coalesced projection cache now avoids rebuilding the snapshot per request; this is partial progress, not a production throughput guarantee.
- [x] Recover and seed the 64,261-record raw Karaoke Nerds snapshot without a new feed request; expose valid unique recordings including unmapped brands.
- [x] Implement desktop shared HTTPS configuration/preferences and scoped offline query caching (100 entries/20 MiB).
- [x] Verify live Windows HTTPS status/search against the deployed service and durable offline reuse after a simulated connection failure; the legacy local default snapshot remains absent.
- [ ] Verify an actual catalog result download, playback and recovery on the host show system.
- [ ] Locate/reconcile every old Karaoke Nerds refresher and its last attempt/retirement state. The original SQLite/cooldown database was not recovered; lastAttempt/lastSuccess/sqlite_retired_ms remain null and refresh stays disabled.
- [ ] Schedule a single centrally coordinated refresh at most once per day, including failed attempts and recovery after restart; keep the provider key out of clients.
- [ ] Expand desktop network/recovery checks beyond the passed live status/search and saved-query offline test, and define any future remote singer catalog access; singers currently use only the host library.
- [ ] Improve brand mapping and review unknown/conflicting brand codes, creator track codes, and alternate video versions.
- [x] Download individually selected YouTube/catalog videos and attach completed media to the same library identity without overwriting other recordings.
- [ ] Connect the host's opt-in brand/artist selection to reviewed automatic/bulk yt-dlp jobs; individual downloads are available.
- [ ] Select the newest artist/track recording using verified publication dates or labeled yt-dlp upload-date fallback; surface incomplete or ambiguous choices.
- [x] Preserve safe paths, avoid overwrite collisions and test yt-dlp/FFmpeg descendant cancellation for individual downloads.
- [ ] Bring the legacy batch/operator path to the same cancellation/recovery standard and verify on show hardware.

## Priority 0 — dependable show operation

- [x] Build development 0.2.0 Windows installer/ZIP and pass an isolated packaged launch/restart check.
- [x] Rebuild Windows 0.2.0 with the concurrent-access-denial cache fix and repeat packaged launch/version/restart checks.
- [ ] Verify actual install/upgrade/uninstall and representative codecs on Windows show hardware.
- [ ] Verify audible output and routing through the connected sound device/mixer, including loss, reconnect and safe rerouting.
- [ ] Verify the singer display on the external monitor, moving windows, fullscreen, disconnect/reconnect and deliberate recovery.
- [ ] Make missing files, unreadable media, unsupported codecs and decode errors explain how to recover while retaining the singer's turn.
- [ ] Add a guided missing/moved-file review and relinking workflow; current relinking accepts an exact original only.
- [ ] Test fingerprint checking, import responsiveness and relinking on large libraries, Dropbox, removable and network drives.
- [ ] Add restore from a checked backup; existing backup does not restore or include media/settings.
- [x] Add versioned SQLite migrations (current schema v2) with upgrade, interrupted-write and rollback tests.
- [ ] Add automatic pre-upgrade backup and verify upgrade/rollback on installed show systems.
- [ ] Test crash/restart, concurrent instances and interrupted playback on real systems; never unexpectedly autoplay.
- [ ] Extend the existing isolated end-to-end queue, transport, import and shortcut rehearsals to real device loss, display recovery and supported platform combinations.
- [x] Build Linux x64 AppImage and Debian packages, verify dependency metadata and payload, and pass final AppImage launch/restart under an isolated virtual display.
- [ ] Verify Linux desktop installation, upgrade/removal, sandbox behavior and show hardware; build and test macOS on a Mac. Package builds do not establish installation or hardware readiness. Preserve local shows when network services fail.

## Priority 1 — host, queue and library

- [x] Allow the host to promote one waiting request without displacing the staged song.
- [x] Add persisted manual request reordering without unexpectedly changing the staged song.
- [x] Edit a waiting request’s track or singer with next-free-round reassignment and preserved manual slot.
- [ ] Add actor/reason audit history for queue edits.
- [x] Add timed singer absence and return (1–60 minutes), one future request while away, authenticated self-service and tested return fairness.
- [ ] Add indefinite singer hold and skip-turn controls.
- [x] Show current singer, upcoming singers and the ordered queue.
- [ ] Add clearly approximate wait times with assumptions and unavailable states.
- [ ] Support duets and groups with multiple performers on one request.
- [ ] Start, save, restore and end named shows without losing or accidentally replaying requests.
- [x] Make recorded singer/song history searchable by singer, artist and title.
- [x] Export matching recorded singer/song history to CSV with spreadsheet-formula protection and no overwrite.
- [ ] Add folder watching/rescanning and review for duplicates, moved media and alternate versions.
- [ ] Verify and improve search, scrolling, filtering and sorting with a genuinely large library.
- [ ] Add batch metadata review/editing, source provenance, reversible overrides and safe rescan preview.
- [ ] Read embedded metadata and allow the host to set precedence among tags, filename templates and manual overrides.
- [ ] Offer an explicit per-edit choice to update supported embedded artist/title tags; default local-only and retain local edits if writing fails.
- [ ] Finish playlist/favorite management, singer organization and playlist import/export; current playlists/history are partial.
- [ ] Add genre metadata and make the genre browser functional.
- [ ] Verify the existing standard, rotation and library layouts at small and large window sizes and keep critical controls visible.
- [x] Validate and persist the implemented settings in editable JSON with defaults and error messages.
- [ ] Extend settings coverage and migration/recovery guidance as remaining features are implemented.
- [ ] Extend the registered shortcut actions to every remaining specialized command. Multiple bindings, the grouped editor, conflict detection, saved reset and tooltip hints are implemented.
- [x] Add the blue/pink/purple primary-color switch with a persisted choice, day/night palettes, accessible name, tooltip and tested contrast.
- [ ] Complete general CLI actions through the existing authenticated local authority. Initial source provides structured capability/state/settings/shortcut reads and queued settings navigation with stable exit codes; the actual Windows app and compiled CLI passed a private-profile rehearsal. Mutation control remains planned; Windows and Linux bundled-wrapper/package checks passed. Do not introduce another SQLite writer.

## Priority 1 — playback and display

- [x] Import same-name MP3/CDG and single-pair ZIP through bounded cancellable FFmpeg conversion; originals stay unchanged.
- [ ] Package/validate FFmpeg, verify real producer CDG audio synchronization and support multi-song archive imports if useful.
- [ ] Evaluate and add useful KaraFun Player 2 formats separately from MP4 and CDG support.
- [x] Add seek, elapsed/remaining time and acknowledged resume checkpoints; verify audio/sync on real hardware separately.
- [ ] Add pitch/key and tempo controls with per-song and per-singer defaults and reset.
- [ ] Support separate lead and backing vocal controls only when the source provides compatible stems or multiplex audio.
- [x] Add opt-in automatic bumper music after completion/Skip, with saved theme, display-silence acknowledgement and safe stop before karaoke.
- [ ] Verify audible bumper routing on show hardware and add fades, separate volume and richer intermission policies.
- [ ] Verify the inter-song pause interval on physical show hardware for finish, skip and restart.
- [ ] Add configurable idle, now-playing and next-up singer-display screens, and test layouts/fullscreen across monitors.
- [ ] Add keyboard-only, screen-reader, high-contrast and text-scaling accessibility coverage.

## Priority 2 — singers, remote use and administration

- [ ] Define account identity, ownership, sign-in, recovery, retention and privacy rules before exposing profiles remotely.
- [ ] Enforce Host, Co-host, Moderator, Singer and Audience permissions at the service boundary.
- [ ] Add persistent profiles with name, email, favorites, playlists, private host notes and access level; allow self-editing except notes and access level.
- [ ] Add role management and moderation audit history.
- [x] Deploy the experimental authenticated MySQL-backed internet relay with role-limited singer operations, bounded requests, rate limits and same-generation recovery.
- [ ] Complete production load/abuse testing, real-phone/venue checks, owner provisioning and broader account/privacy administration.
- [ ] Test existing local-network singer access with real phones, certificate trust, venue DNS/firewalls and network interruptions.
- [ ] Connect the native singer preview to the real service with secure credentials, admission, browsing, requests and withdrawal.
- [ ] Test native Android/iOS devices, lifecycle, secure storage, certificate validation and uncertain request outcomes.
- [ ] Add personal-data view/export/delete controls and protect host-only notes.
- [ ] Add configurable content policy, rating visibility and explicit-content restrictions at discovery, request and playback boundaries.
- [ ] Add privacy-preserving diagnostic logs and error reporting; redact credentials, private notes, account data and media paths.
- [ ] Add localization and accessible date, time and text formatting.
- [ ] Define product subscription plans, billing, device limits, offline grants and recovery without cutting off an active show.

## Documentation and release

- [ ] Keep this checklist, [handoff](handoff.md), [host README](../README.md), [singer guide](singer-guide.md) and developer/operator guides synchronized with implemented behavior and tested limits.
- [x] Reconcile the [Karaoke Nerds operator guide](karaokenerds-catalog.md) with deployed shared search, private desktop connection, offline query cache and refresh recovery limits.
- [ ] Regenerate the Word specification from [product specification](product-specification.md) and visually verify it; the existing Word edition is outdated.
- [x] Regenerate the 0.4.0 37-page Night/Day mockup PDF from Markdown and visually verify every page; repeat whenever requirements or screens change.
- [ ] Complete platform install/update/uninstall, signing/icon and distribution checks; private catalog configuration and media tools remain separately provisioned. Keep delivery versions 0.x.y until approved 1.0.0.
- [ ] Prepare a release checklist covering backups, migration/rollback, real-hardware tests, privacy and provider/venue terms.

Provider notes: [provider research](provider-research.md), [Sunfly operator](sunfly-account-status.md), [Stingray operator](stingray-catalog.md), and [Karaoke Nerds catalog](karaokenerds-catalog.md). Current automated tests and prior muted rehearsals are useful evidence, but they do not replace real hardware, real accounts or production verification.

## 0.3.0 verification follow-up

- [x] Owner reports the 0.2.0 installers ran successfully; exact platforms were not specified.
- [x] Provide four TPV lettermarks plus vintage microphone/volume and darker headphones options, all with light/dark editions in the preferred palette; later vintage/cursive exploration led to the approved Velvet Script selection.
- [x] Generate the selected Velvet Script dark/light masters, Windows ICO, macOS ICNS, Linux PNGs, web and mobile assets; wire them into the next pre-release packaging and desktop windows. All 66 generated hashes and the Windows executable resource check passed. Previously built installers remain unchanged.
- [ ] Verify the approved icon in the next complete platform packages and on native Start menu/taskbar, launcher and Dock surfaces.
- [x] Rehearse nested directory import in the actual Windows package and fingerprint one selected Dropbox MP4.
- [x] Reproduce the all-file changed error and add bounded complete-hash retries; final packaged app imported all 237 actual MP4s into a disposable library with zero failures.
- [ ] Confirm the owner’s normal installed-session re-import and further investigate transient Windows/cloud metadata behavior if it recurs.
- [x] Add simple custom-slug remote-session controls and bounded singer transport with same-ID uncertain-action recovery.
- [x] Deploy the MySQL relay and verify public packaged-host/browser operations, lost-reply receipt recovery, brief poll outage, End/restart fencing and daily backup/restore.
- [x] Build and smoke final Windows/Linux 0.3.0 packages after import/recovery fixes; keep 0.2 rollback artifacts.
- [ ] Verify real 0.3 installation/upgrade/removal and physical show hardware; macOS remains unbuilt.

The import’s original transient metadata cause is not proven. Remote accounts, broader roles, paid providers, final signing, remaining native icon surfaces, actual phones and show hardware remain unfinished; passing rehearsals do not imply a finished 1.0 release. Windows 0.4.1 package/installed resources and Start menu references are now verified below.

## 0.3.1 default lyric backdrop

- [x] Bundle the owner-selected TPV Version 3 animation as a silent full-duration default for new CDG imports, with custom/solid choices in Singer Display preferences. Existing converted songs require reimporting.
- [ ] Implement timed LRC import and playback using the same default backdrop preference; verify lyric timing, seek, pause/resume and accessibility.
- [ ] Verify real-producer CDG lyric/background composition and synchronization on physical show hardware.

## 0.4.0 Requested Workspace Improvements

- [x] Player F/Shift+F fullscreen; Ctrl/Cmd/Alt+Comma preferences; Ctrl/Cmd+Slash and F1 shortcut help; same-profile launcher --settings/--keybindings.
- [x] Wide grouped shortcut editor with multiple bindings, capture, conflicts, disabled bindings, persisted reset and JSON editing. Specialized actions still need full coverage.
- [x] Repeated known metadata fields and arbitrary ignored custom placeholders; all six supplied formats accepted.
- [x] Play opens the saved or nearest non-host singer display and waits for readiness; Previous restarts the same performance.
- [x] Public catalog discovery fixes missing private configuration on fresh installs; the actual Linux 0.4 package passed public catalog search without a reader configuration.
- [x] Shared 1–10-heart host ratings in search/queue/On Stage with isolated MySQL, per-voter credentials, explicit replacement/clear and public aggregates.
- [ ] Remote singer voting, verified account ownership and cross-device profiles.
- [x] Larger/bolder sidebar, bottom Host Workspace links, Sources with YouTube/Karaoke Nerds/services, native File Import/Backup and View Appearance/Accent/Layout, iconized CDG import, wider preferences and larger section titles.
- [x] Verify the initial local API against the actual Windows app and compiled CLI: reads, settings/shortcut navigation, lifecycle credentials, disable/quit cleanup and persistence without autoplay.
- [ ] Complete authenticated API/CLI mutation control, events, pagination and the remaining app capabilities. The initial off-by-default read/navigation subset passed actual Windows app and compiled CLI checks; Windows and Linux bundled-wrapper/package checks passed.

## 0.4.0 Audited Correctness and Delivery

- [x] Preserve native text editing when an assigned custom shortcut overlaps Select All, clipboard, undo/redo or caret movement; actual Ctrl+A regression passed.
- [x] Merge dirty preference patches against the latest serialized settings; stale volume saves no longer overwrite a newer accent.
- [x] Serve media from an identity-checked open handle; observed file replacement pauses with explicit recovery.
- [x] Verify saved video bytes on explicit Retry and repair corrupt cache entries safely; require Stop for an active recording and never autoplay.
- [x] Verify Windows installer/ZIP payloads and Linux AppImage/Debian payloads from frozen runtime source `0e90733`, with receipts and checksums.
- [x] Verify packaged CLI read/navigation, explicit enablement, per-start credentials, API-off desktop flags and restart without autoplay on Windows and isolated Linux.
- [ ] Finish general authenticated mutations, events, pagination and specialized CLI action coverage; initial capabilities explicitly report partial control.
- [ ] Complete native desktop installation, upgrade/removal, macOS and physical show validation.

## 0.4.1 Selected Desktop Branding

- [x] Prepare the owner-selected Microphone Play mark with no text on the app icon; preserve the reference and previous masters.
- [x] Export matching light/dark SVG/PNG, Windows ICO, macOS ICNS, Linux and web/mobile assets with reproducible hashes.
- [x] Add assisted-installer welcome/sidebar/header branding and theme-selected host logos.
- [x] Verify Windows 0.4.1 installer/ZIP and actual 0.2.0→0.4.1 upgrade on this PC, preserving show/configuration bytes after a private backup. All nine app/setup/uninstaller icon images, Start menu/uninstall icon references and installed Day/Night host logos passed.
- [x] Integrate the laptop's staged-policy lock, relink and retired-bumper-event fixes; Windows safety-base verification passed 685 tests with seven skips, type checking/build and a muted policy-lock rehearsal.
- [x] Complete Linux 0.4.1 AppImage/Debian package verification from frozen `24f5f15`: matching payloads, 115 targeted passes without failures/skips, 69 branding hashes, all ten default light PNGs, packaged logos/favicon and extracted AppRun/catalog/CLI/API/staged-policy rehearsals. Non-root desktop and physical hardware remain unverified.
- [x] Regenerate the 0.4.1 Markdown-based mockup PDF with the selected logo and visually review all 37 pages.
- [ ] Regenerate and visually verify Word when the required bundled renderer is available; the current Word edition remains outdated.
- [x] Restore existing catalog/queue/ratings services left stopped by unattended MySQL maintenance, without changing code, schema, credentials, provider configuration or website behavior.
- [ ] Review and apply a separately proposed service-recovery prevention change; the current proposal remains unapplied.
- [ ] Verify native macOS packaging/Dock and physical Windows/Linux desktop behavior before 1.0.0.
