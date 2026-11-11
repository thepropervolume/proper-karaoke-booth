# Remaining work

Updated 11 November 2026 from the current checkout. This is the working checklist for the karaoke application; an unchecked item means work or verification remains, and a partial implementation is called out explicitly. Priorities follow the owner's requests: reliable show operation and a playable streaming service first. Time and complexity are not estimates. The broader historical comparison is in [feature review](feature-review.md); [handoff](handoff.md) and [product specification](product-specification.md) explain decisions and current boundaries.

## Current foundation

The host can import local MP4s, search and locally edit artist/title, create singers and queue requests, use FIFO or simple fair rotation, play to a separate singer window, back up the show database, and choose settings and limited shortcuts. The host can search a previously saved local Karaoke Nerds snapshot; its separate experimental YouTube preview plays outside the show queue. An opt-in experimental local-network singer page and an offline synthetic native singer preview exist. None of these establish that the app is ready for a live show. No paid provider is connected for playback.

## Priority 0 — streaming and catalog

- [ ] Obtain KaraFun OEM documentation, developer/sandbox credentials, eligible account-linking rules, commercial/territory rights and a price; the existing consumer subscription has not been proven usable in this app.
- [ ] Implement and test approved KaraFun account linking, secure credential storage, refresh/revocation and entitlement checks.
- [ ] Add KaraFun catalog search and exact recording/version identity.
- [ ] Integrate approved KaraFun playback with the singer display, queue, transport, reporting and permitted offline behavior; handle failures without losing a turn.
- [ ] Obtain Stingray partner credentials, price, existing-subscription and public-use terms; its fixture-tested developer login/search tools are not a playable service.
- [ ] Verify Stingray login and catalog search with an authorized real account and confirm the applicable API-key/OAuth flow.
- [ ] Add Stingray permitted playback and play reporting; enforce its provider-specific asset-storage restrictions.
- [ ] Obtain Sunfly trial/partner access, Electron playback SDK, quote, public-use and territory terms; its fixture-tested account/catalog tools do not play songs.
- [ ] Verify Sunfly account, change-feed pagination, subscription and withdrawal handling with a real approved account.
- [ ] Integrate Sunfly encrypted media, license acquisition/expiry, SDK playback and required play reporting.
- [ ] Investigate Party Tyme and Karaoke Cloud Pro vendor access, account compatibility and complete costs; evaluate each additional service against the owner's under-$20/month per-service target.
- [ ] Add provider-specific login/logout, connection state, credential redaction, subscription eligibility and clear renewal/outage errors.
- [ ] Keep app billing and each provider subscription separate; do not assume one grants another.
- [ ] Provide a unified search that preserves provider and exact-version identity; avoid silently substituting a different recording.
- [ ] Make eligible streaming results requestable and queueable with singer selection and normal rotation rules.
- [ ] Route eligible provider playback to the singer display and selected audio output with stage/play/pause/stop/skip and safe transition handling.
- [ ] Handle expired links, network failure, provider unavailability, rate limits, ads and unsupported or region-blocked recordings without consuming a singer's turn.
- [ ] Extend YouTube playback beyond its separate preview: integrate eligible videos with the show queue and singer display, preserve YouTube controls/attribution, and test prohibited/disabled embeds and error recovery.
- [ ] Verify the installed application identity, visible-player and referrer requirements for distributed YouTube playback; the current development identity is provisional.
- [ ] Verify network loss, output selection, switching away from the preview and physical singer-display behavior for YouTube.
- [ ] Make the Karaoke Nerds shared MySQL catalog service production-ready and deploy it with a restricted service, backups and restore procedure.
- [ ] Confirm that every old Karaoke Nerds refresher is stopped, retire the local updater, and migrate the existing snapshot and refresh cooldown without another upstream call.
- [ ] Schedule a single centrally coordinated refresh at most once per day, including failed attempts and recovery after restart; keep the provider key out of clients.
- [ ] Connect desktop and remote clients to authenticated shared catalog access with a usable offline cache and a clear stale-data status.
- [ ] Improve brand mapping and review unknown/conflicting brand codes, creator track codes, and alternate video versions.
- [ ] Connect the host's opt-in brand/artist selection to reviewed, cancellable `yt-dlp` cache jobs and import completed eligible videos.
- [ ] Select the newest artist/track recording using verified publication dates or labeled yt-dlp upload-date fallback; surface incomplete or ambiguous choices.
- [ ] Preserve safe configured cache paths, detect destination collisions and verify cancellation including any ffmpeg child process.

## Priority 0 — dependable show operation

- [ ] Verify Windows packaging and installation on real show hardware, including representative MP4 codecs.
- [ ] Verify audible output and routing through the connected sound device/mixer, including loss, reconnect and safe rerouting.
- [ ] Verify the singer display on the external monitor, moving windows, fullscreen, disconnect/reconnect and deliberate recovery.
- [ ] Make missing files, unreadable media, unsupported codecs and decode errors explain how to recover while retaining the singer's turn.
- [ ] Add a guided missing/moved-file review and relinking workflow; current relinking accepts an exact original only.
- [ ] Test fingerprint checking, import responsiveness and relinking on large libraries, Dropbox, removable and network drives.
- [ ] Add restore from a checked backup; existing backup does not restore or include media/settings.
- [ ] Add versioned SQLite migrations and upgrade, interrupted-write and rollback tests.
- [ ] Test crash/restart, concurrent instances and interrupted playback on real systems; never unexpectedly autoplay.
- [ ] Add comprehensive end-to-end coverage for queue, transport, import, shortcuts, device loss and display recovery.
- [ ] Validate Windows, Linux and macOS builds and installation independently; preserve the working local show when network services fail.

## Priority 1 — host, queue and library

- [ ] Add manual request reordering and promotion without unexpectedly changing the staged song.
- [ ] Move a request between singers with an explicit fairness policy and visible history.
- [ ] Add singer hold, absence, return and skip-turn controls; define returning-singer fairness.
- [ ] Show current singer, upcoming singers, queue position and clearly approximate wait time.
- [ ] Support duets and groups with multiple performers on one request.
- [ ] Start, save, restore and end named shows without losing or accidentally replaying requests.
- [ ] Make singer/song history searchable and exportable to CSV.
- [ ] Add folder watching/rescanning and review for duplicates, moved media and alternate versions.
- [ ] Verify and improve search, scrolling, filtering and sorting with a genuinely large library.
- [ ] Add batch metadata review/editing, source provenance, reversible overrides and safe rescan preview.
- [ ] Read embedded metadata and allow the host to set precedence among tags, filename templates and manual overrides.
- [ ] Offer an explicit per-edit choice to update supported embedded artist/title tags; default local-only and retain local edits if writing fails.
- [ ] Finish playlist/favorite management, singer organization and playlist import/export; current playlists/history are partial.
- [ ] Add genre metadata and make the genre browser functional.
- [ ] Verify the existing standard, rotation and library layouts at small and large window sizes and keep critical controls visible.
- [ ] Make all settings validated and editable with defaults, migrations, clear error messages and documentation.
- [ ] Extend the keybindings text file to every actionable command, including conflict detection, reset and updated tooltip hints.
- [ ] Implement the requested blue/pink/purple primary-color switch; persist the choice, support day/night themes and accessible contrast. **In progress.**
- [ ] Add a CLI for application actions through one authenticated local authority with structured output and stable exit codes; do not introduce another SQLite writer.

## Priority 1 — playback and display

- [ ] Support paired MP3+CDG and ZIP karaoke files, safe extraction, pairing, ambiguity and diagnostics.
- [ ] Evaluate and add useful KaraFun Player 2 formats separately from MP4 and CDG support.
- [ ] Add seek, elapsed/remaining time and reliable resume position.
- [ ] Add pitch/key and tempo controls with per-song and per-singer defaults and reset.
- [ ] Support separate lead and backing vocal controls only when the source provides compatible stems or multiplex audio.
- [ ] Add automatic intermission/bumper scheduling, transitions and fade controls; current bumper playback is manual.
- [ ] Verify the inter-song pause interval on physical show hardware for finish, skip and restart.
- [ ] Add configurable idle, now-playing and next-up singer-display screens, and test layouts/fullscreen across monitors.
- [ ] Add keyboard-only, screen-reader, high-contrast and text-scaling accessibility coverage.

## Priority 2 — singers, remote use and administration

- [ ] Define account identity, ownership, sign-in, recovery, retention and privacy rules before exposing profiles remotely.
- [ ] Enforce Host, Co-host, Moderator, Singer and Audience permissions at the service boundary.
- [ ] Add persistent profiles with name, email, favorites, playlists, private host notes and access level; allow self-editing except notes and access level.
- [ ] Add role management and moderation audit history.
- [ ] Build a secure internet relay with authentication, authorization, rate limits and reconnect behavior while keeping the local host authoritative.
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
- [x] Reconcile the [Karaoke Nerds operator guide](karaokenerds-catalog.md) with the available local desktop search and separate YouTube preview.
- [ ] Regenerate the Word specification from [product specification](product-specification.md) and visually verify it; the existing Word edition is outdated.
- [ ] Regenerate and visually verify the mockup PDF from the Markdown source when requirements or screens change.
- [ ] Complete cross-platform packaging, install/update/uninstall and distribution checks; determine stable app identifiers.
- [ ] Prepare a release checklist covering backups, migration/rollback, real-hardware tests, privacy and provider/venue terms.

Provider notes: [provider research](provider-research.md), [Sunfly operator](sunfly-account-status.md), [Stingray operator](stingray-catalog.md), and [Karaoke Nerds catalog](karaokenerds-catalog.md). Current automated tests and prior muted rehearsals are useful evidence, but they do not replace real hardware, real accounts or production verification.
