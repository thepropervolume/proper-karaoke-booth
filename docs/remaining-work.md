# Remaining work

Updated 20 November 2026 for **0.10.8 development**, with 1.0.0 reserved for the official release. The public download page lists each published build and source commit. Earlier milestones retain their original evidence. [Booth downloads](https://release.thepropervolume.com/booth/) · [Release acceptance checklist](release-acceptance.md)

## Next work in priority order

1. **Reliable show operation:** verify the new backup restore, missing-file review, and failed-video recovery on installed show systems. Continue fault testing for upgrades, interruptions, imports, real output devices, and external displays.
2. **Catalog freshness and acquisition:** reconcile the unknown previous Karaoke Nerds refresh history before enabling a single centrally coordinated, at-most-daily feed refresh. The shared snapshot is searchable and exact artist/brand filters are indexed in memory. Extend production load tests and recovery monitoring, and implement brand/artist bulk caching and newest-version selection. The snapshot's upstream freshness is unknown.
3. **Provider playback:** harden the experimental desktop KaraFun and Party Tyme flows for account expiry, network failure, caching and recovery. Complete real-account and provider-specific integration for Sunfly and Stingray when partner access and playback rights exist; metadata search alone is not playback.
4. **Queue, library and controls:** finish named-show lifecycle, refine approximate waits after real-show checks, support broader group performance, folder rescan/duplicate review and reversible metadata editing. The filename-template preview/apply workflow is available. Embedded-tag precedence and optional write-back remain open. Extend the authenticated local API/CLI beyond queue edits, paged library lookup, and basic read/navigation commands through the running Booth's show writer.
5. **Singers, mobile and accessibility:** complete persistent profiles/roles, privacy and data controls, accessibility coverage, verify mobile playback-position recovery on real devices, and add mobile paid-source integration. Singer-room search already searches the host's saved library, not every provider's entire catalog.
6. **Release readiness:** verify desktop installers/upgrades/removal, signing and CLI setup; define and implement a safe update path, then close documented QA findings. Published Android debug/unsigned and iOS Simulator artifacts are development builds, not production app-store or iPhone installers.

**Native store delivery**

Apple Developer and Google Play Console enrollment are pending. The first targets are signed TestFlight and Play testing builds with on-device playback and room testing. GitHub Actions passed the unsigned iPhoneOS Release compile and the Android SDK build and signature verification with a disposable key. Before public submission, confirm the publisher identity, provider rights, privacy disclosures, and how guest photo submissions will be moderated or scoped. [iOS build guide](store-ios.md) · [Android build guide](store-android.md) · [Mobile data inventory](store-data-inventory.md) · [iOS check](https://github.com/thepropervolume/proper-karaoke-booth/actions/runs/44686314734) · [Android check](https://github.com/thepropervolume/proper-karaoke-booth/actions/runs/44687156982)

**Hardware and owner/provider gates:** verify audible output, bumper/applause levels, codecs, external display loss/recovery and complete provider songs on the actual show equipment; verify Android/iOS on real phones and venue networks. Obtain provider-approved partnership, distribution, territory, venue and offline terms and fees. Signing/notarization, store access and commercial policy decisions remain separate from code completion. A successful build or synthetic rehearsal does not establish those results.

**Live remote status**

The public queue relay and mobile/singer assets are at 0.10.7. The private visual-only viewer is available at `booth.thepropervolume.com`. Public Chrome checks covered paged search, withdrawal, mobile storage, guest photo review and room closure. Synthetic frames verified private viewer access and revocation. Physical show capture, phones, venue-network performance and long sessions still need testing. [Deployment record](../deploy/queue-relay/DEPLOYMENT-2026-11-20-SCREEN-SEARCH.md)

## 0.10.3 Source Controls

- [x] Add separate Sources switches for local files, Karaoke Nerds, YouTube, KaraFun, Party Tyme, Sunfly and Stingray, with default-on migration and host/singer discovery gating.
- [x] Invalidate stale searches while preserving connected accounts, existing queue entries and active media preparation.
- [x] Record the origin of newly added unbranded Karaoke Nerds results without changing existing YouTube identities.
- [ ] Review legacy unbranded YouTube/Karaoke Nerds entries whose origin was not stored; do not guess their provenance.

## Party Tyme Consumer Playback

- [x] Connect the provided consumer Premium account; keep the separate Pro catalog and account system distinct.
- [x] Add authenticated unified results, common context actions and optional-singer queueing with automatic background preparation.
- [x] Require fresh playback approval, remember accepted sessions with OS encryption and fence sign-out/expiry.
- [x] Pass a real muted Windows recording/preparation/restart/sign-out rehearsal; preserve original account/show data.
- [x] Retry an empty multiword consumer search with one bounded token and show a clear no-match state; tested account returned no Coldplay matches, which does not establish global availability.
- [ ] Add interactive provider sign-in, aggregate cache management and wider real-platform/full-song acceptance.
- [ ] Confirm provider partnership, distribution and commercial-hosting terms; add Pro and mobile playback only with suitable access.

## Mobile and Search Update

- [x] Hide all saved/new KaraFun search results until signed in; fence stale replies and unsigned public calls.
- [x] Keep generic YouTube results last and suppress artist/title matches from other visible sources without deleting recordings.
- [x] Research KaraFun mobile capabilities and explicitly exclude quizzes.
- [x] Deploy an installable mobile web app with independent Full Host playback/queue and host-authorized Piggyback requests.
- [x] Add native Android/iOS wrappers, icons, DNS-SD suggestions and an explicit Join prompt; use same-egress browser hints and manual links as fallbacks.
- [x] Independently audit protocol, usability and native packaging; document findings and regression fixes in [QA](qa/mobile-090-summary.md).
- [ ] Complete physical Android/iOS playback, local-network permissions/discovery, prolonged background/reconnect and output checks.
- [ ] Add mobile KaraFun/paid-provider account playback, key/tempo, vocal stems and native casting.
- [ ] Add stable app signing, real-device distribution and store/TestFlight releases; Android debug and iOS Simulator artifacts are published directly to Linode, avoiding the former GitHub artifact quota problem.
- [x] Restore a mobile Full Host request paused at its last saved playback checkpoint across app/mode restarts; YouTube positions are approximate.
- [x] Show aggregate and per-copy video storage in Full Host, with search and safe removal of unused copies. Verified through reload and relink in Chromium.
- [x] Add mobile Full Host approval before guest photos appear on screen. Chromium verified sender receipt, uninterrupted queue requests, explicit approval and a single points award.
- [ ] Verify mobile resume and storage on real Android/iOS devices and under abrupt termination. Personal account and favorites sync remain open.

## Current foundation

The desktop host supports local MP4 and converted MP3/CDG imports, unified search, singer and queue management, playback on a singer display, configurable inter-song gaps and bumper audio, backups, settings and shortcuts. It also has experimental KaraFun and Party Tyme consumer playback, with platform and licensing limits detailed in [source status](source-status.md). Karaoke Nerds discovery uses a dedicated shared MySQL catalog and saved-query offline cache; the recovered 64,261-record snapshot has unknown upstream freshness and automatic refresh remains disabled. Individual YouTube/catalog requests can be acquired with yt-dlp. The mobile web app supports Full Host and Piggyback modes. These capabilities and synthetic checks do not by themselves establish live-show readiness.

## 0.7.1 Historical Update

- [x] Allow host/staff requests without a singer across local and connected queue sources, storing null rather than a fake singer.
- [x] Let the host assign, change or clear a waiting/prepared request while preserving its staged identity and manual slot; retain remote singer ownership boundaries.
- [x] Give unassigned requests independent FIFO fair-round slots without named-singer limits or absence state.
- [x] Migrate assigned shows/history transactionally to schema 5 with nullable history singer IDs; retain schema-aware snapshot validation and older-app refusal.
- [x] Replace the inner search focus glow with one unclipped outer ring across Day/Night and all accents.
- [ ] Record 0.7.1 package receipts and platform-specific verification separately from earlier releases.

## 0.7.0 Historical Update

- [x] Put an always-visible global search above Workspace; focus it from every host area using the assigned shortcut.
- [x] Combine local, Karaoke Nerds, YouTube, native KaraFun and public metadata into one dominant readable list with shared context menus and capability-disabled actions.
- [x] Identify sources with labels and 3px provider-color borders; shorten repeated guidance and move details into help tooltips.
- [x] Keep one hidden singer renderer for preview, karaoke and bumper audio; Close hides it without creating another player.
- [x] Automatically stage approved requests while preserving manual moderation and same-request staged edits.
- [x] Advance a running show after completion/confirmed Skip, gap and ready media; cancel on Stop/Pause/errors/device loss and never start karaoke on launch.
- [x] Start configurable launch/between-song bumper with default output support and 1000 ms fade-in (500–1700 ms configurable).
- [x] Add booth name, immediate logo-picker preview, logo sizing 10–85vw and top/bottom scrolling banner with expiry and opt-in restart persistence.
- [x] Remember KaraFun sessions through OS encryption where available; validate on restore, preserve account cache identity and forget explicitly on sign-out.
- [x] Use KaraFun pink for the primary completed native lyric and source-specific numeric shared rating keys without a media fingerprint.
- [x] Deploy and verify the production KaraFun rating validator on Linode III; both namespaces passed live disposable-voter checks with no retained test votes or SQL migration.
- [x] Bind read-only LAN screens to trusted concrete private interfaces/loopback; require actual Windows Private classification with fail-closed fallback and bounded periodic rechecks.
- [x] Pass focused tests plus muted source rehearsals for hidden preview, launch/gap automation, Stop/restart, concurrent Play, Previous and readiness recovery; verify Windows encrypted session lifecycle across independent launches.
- [x] Build/rehearse 0.7.0 Windows, Linux and macOS packages from frozen source with separate receipts and artifact checksums; Intel Mac execution, ordinary Linux sandbox and physical installation gates remain.
- [ ] Verify audible mixer output, physical display/device recovery and full-song/native-provider synchronization on supported platforms.

## Priority 0 — streaming and catalog

- [x] Send KaraFun an OEM content/playback API inquiry (owner submitted through Business support on 11 November 2026; reply pending).
- [x] Inspect the owner-provided Business API specification and test the dashboard token read-only: device listing returned 402 and room-token listing 403; content/playback access remains unverified.
- [x] Review KaraFun's 16 November reply and send the project summary it invited. KaraFun gave early 2027 as the earliest likely API availability.
- [ ] Obtain OEM documentation, developer/sandbox credentials, eligible account-linking rules, applicable usage/territory rights and all fees when KaraFun opens access.
- [x] Implement native official-window sign-in, OS-protected remembered session/restore/sign-out, canonical search and per-performance authorization without copying a vendor application key.
- [x] Queue native catalog recordings with the ordinary singer dialog and durable TPV rotation; prepare verified private KIT media in the background without autoplay.
- [x] Implement one-clock native stems/timed lyrics and test the complete synthetic TPV queue/player/pause/seek/Previous/sign-out flow.
- [ ] Finalize provider-approved KaraFun account-linking/distribution terms and broader expiry/revocation testing; experimental linking, encrypted session storage and fresh authorization are implemented.
- [x] Add host-only KaraFun public catalog metadata search with provider IDs; the inspected 90,284-record CSV parses without login. Search-only results do not establish playback or cross-provider equivalence.
- [x] Add host-only Party Tyme public catalog metadata search, preserving provider codes from the inspected 44,967-row table; subscription playback remains separate.
- [ ] Complete KaraFun reporting/permitted-offline terms and physical verification; experimental native singer-display, queue and transport playback already works and retains turns on failure.
- [x] Send Stingray a catalog/playback partnership inquiry covering per-user access, private parties and commercial events (owner sent on 11 November 2026; commercial-partnership reply received 12 November).
- [x] Read Stingray's 12 November reply: API access is through commercial partnerships; send an authorized follow-up requesting the appropriate team.
- [ ] Obtain Stingray partner credentials, price, existing-subscription and public-use terms; its fixture-tested developer login/search tools are not a playable service.
- [ ] Verify Stingray login and catalog search with an authorized real account and confirm the applicable API-key/OAuth flow.
- [ ] Add Stingray permitted playback and play reporting; enforce its provider-specific asset-storage restrictions.
- [ ] Obtain Sunfly trial/partner access, Electron playback SDK, quote, public-use and territory terms; its fixture-tested account/catalog tools do not play songs.
- [ ] Verify Sunfly account, change-feed pagination, subscription and withdrawal handling with a real approved account.
- [ ] Integrate Sunfly encrypted media, license acquisition/expiry, SDK playback and required play reporting.
- [ ] Investigate Party Tyme and Karaoke Cloud Pro vendor access, account compatibility and complete costs; evaluate each additional service against the owner's under-$20/month per-service target.
- [ ] Extend provider-specific login/logout, connection state, credential redaction, subscription eligibility and clear renewal/outage errors to supported services; experimental KaraFun and Party Tyme flows already implement parts of this.
- [ ] Keep app billing and each provider subscription separate; do not assume one grants another.
- [x] Unify local and Karaoke Nerds search in Song Library, preserving exact recording identity, host edits, filters and offline local results.
- [x] Queue a catalog recording with singer selection in one host-authority operation; approved requests dispatch serial yt-dlp acquisition without autoplay.
- [x] Put public service metadata in the unified library list and Sources, with names/colors, bounded results/errors and explicit search-only status.
- [ ] Verify real Sunfly and Stingray developer catalog access; their desktop metadata adapters are fixture-tested only.
- [x] Make connected native KaraFun and eligible YouTube/Karaoke Nerds results requestable through normal singer/rotation rules. Party Tyme consumer playback was added later; other paid playback remains pending.
- [x] Route experimental native KaraFun, Party Tyme consumer recordings and acquired YouTube/Karaoke Nerds to the normal display/output/transport; other approved providers remain separate work.
- [ ] Handle expired links, network failure, provider unavailability, rate limits, ads and unsupported or region-blocked recordings without consuming a singer's turn.
- [x] Add permanent yt-dlp downloads, progress/cancel/retry, exact-ID hash-verified reuse and local/offline playback through the regular queue and singer display.
- [ ] Verify the installed application identity, visible-player and referrer requirements for the separate distributed YouTube preview; queued performances now use downloaded local media.
- [ ] Verify download interruption/recovery, cached output selection and physical singer-display behavior on show hardware.
- [ ] Package/test yt-dlp and FFmpeg installation, upgrades and all supported operating systems.
- [x] Deploy the dedicated shared MySQL catalog search service behind HTTPS and verify server backup/scratch restore using the recovered raw snapshot.
- [ ] Finish production monitoring, recovery/rotation operations and real desktop end-to-end verification; deployed search is not a working daily-refresh pipeline.
- [x] Revalidate the read projection with a primary-key revision query and index exact artist and verified brand searches. A 64,000-record fixture with 32 concurrent reads verified coalescing, pagination, and outage behavior.
- [ ] Measure production query and service capacity across free-text search, cold snapshot loads and concurrent exact filters.
- [x] Recover and seed the 64,261-record raw Karaoke Nerds snapshot without a new feed request; expose valid unique recordings including unmapped brands.
- [x] Implement desktop shared HTTPS configuration/preferences and scoped offline query caching (100 entries/20 MiB).
- [x] Verify live Windows HTTPS status/search against the deployed service and durable offline reuse after a simulated connection failure; the legacy local default snapshot remains absent.
- [ ] Verify an actual catalog result download, playback and recovery on the host show system.
- [ ] Locate/reconcile every old Karaoke Nerds refresher and its last attempt/retirement state. The original SQLite/cooldown database was not recovered; lastAttempt/lastSuccess/sqlite_retired_ms remain null and refresh stays disabled.
- [ ] Schedule a single centrally coordinated refresh at most once per day, including failed attempts and recovery after restart; keep the provider key out of clients.
- [ ] Expand desktop network/recovery checks beyond the passed live status/search and saved-query offline test. Remote singers can search the host’s saved, policy-filtered library; provider-wide singer catalog access is still unimplemented.
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
- [x] Distinguish missing files, permission problems and unsupported or broken video. The Windows Electron rehearsal preserved the same request and playback checkpoint through explicit recovery.
- [x] Add a guided missing/moved-file review and keep exact-copy relinking. The isolated Windows rehearsal found a moved file, rejected a different video, and played the relinked original.
- [ ] Test fingerprint checking, import responsiveness and relinking on large libraries, Dropbox, removable and network drives.
- [x] Restore from a checked backup after native confirmation, with automatic current-show rollback and a silent restart. Windows Electron verified both cancellation and successful restore.
- [x] Add versioned SQLite migrations (current schema 8) with upgrade, interrupted-write and rollback tests.
- [x] Add a validated, standalone pre-migration show backup before opening an older database; stop the upgrade if the backup fails.
- [ ] Verify pre-migration backup, upgrade and rollback on installed show systems and real filesystems. The new in-app flow passed an isolated Windows restart test.
- [ ] Test crash/restart, concurrent instances and interrupted playback on real systems; never unexpectedly autoplay.
- [ ] Extend the existing isolated end-to-end queue, transport, import and shortcut rehearsals to real device loss, display recovery and supported platform combinations.
- [x] Build Linux x64 AppImage and Debian packages, verify dependency metadata and payload, and pass final AppImage launch/restart under an isolated virtual display.
- [x] Verify the published 0.10.7 Debian package installs with its declared dependencies and purges while preserving an isolated profile. The Windows GitHub runner verified 0.10.6→0.10.7 installation, upgrade, checked schema 7 backup and uninstall.
- [ ] Verify Linux installation and default sandbox behavior on a real desktop. Complete Mac Finder installation, Intel runtime, Dock appearance and physical show checks. Preserve local shows when network services fail.

## Priority 1 — host, queue and library

- [x] Allow the host to promote a waiting request and select a different next song before playback.
- [x] Add persisted manual request reordering, including changing the next prepared song before playback.
- [x] Edit a queued track/singer with the same request identity, next-free-round reassignment and preserved manual slot; active playback stays protected.
- [ ] Add actor/reason audit history for queue edits.
- [x] Add timed singer absence and return (1–60 minutes), one future request while away, authenticated self-service and tested return fairness.
- [x] Add a host-only singer hold until manual return. Desktop tests verified restart persistence, duet eligibility and continued rotation, including the schema 7→8 backup.
- [ ] Add a separate skip-turn action and confirm its fairness rules.
- [x] Show current singer, upcoming singers and the ordered queue.
- [x] Show approximate host-queue waits using current remaining playback, configured gaps and four minutes per preceding ready song; withhold uncertain estimates and explain assumptions.
- [ ] Verify estimates under real show conditions and refine them with trustworthy durations when available.
- [x] Support a two-singer duet on one request, including host-editable duet metadata and points.
- [ ] Support groups with more than two performers and verify full duet/group workflows on physical show equipment.
- [ ] Start, save, restore and end named shows without losing or accidentally replaying requests.
- [x] Make recorded singer/song history searchable by singer, artist and title.
- [x] Export matching recorded singer/song history to CSV with spreadsheet-formula protection and no overwrite.
- [ ] Add folder watching/rescanning and review for duplicates, moved media and alternate versions.
- [ ] Verify and improve search, scrolling, filtering and sorting with a genuinely large library.
- [ ] Extend batch metadata review/editing with source provenance, reversible overrides and broader rescan preview. A filename-template before/after preview with explicit selection and changed-since-preview protection is already implemented.
- [x] Read a local MP4’s embedded title and artist from Edit Song Details and allow the host to copy either field to the local edit.
- [ ] Add configurable embedded-tag and filename-template precedence for imports and retain manual overrides.
- [ ] Offer an explicit per-edit choice to update supported embedded artist/title tags; default local-only and retain local edits if writing fails.
- [x] Add playlist import/export with preview and exact recording matching. A two-profile Windows rehearsal matched a renamed identical file and skipped an unavailable recording.
- [ ] Finish playlist and favorite organization, including personal accounts and cross-device sync.
- [ ] Add genre metadata and make the genre browser functional.
- [ ] Verify the existing standard, rotation and library layouts at small and large window sizes and keep critical controls visible.
- [x] Validate and persist the implemented settings in editable JSON with defaults and error messages.
- [ ] Extend settings coverage and migration/recovery guidance as remaining features are implemented.
- [ ] Extend the registered shortcut actions to every remaining specialized command. Multiple bindings, the grouped editor, conflict detection, saved reset and tooltip hints are implemented.
- [x] Add the blue/pink/purple primary-color switch with a persisted choice, day/night palettes, accessible name, tooltip and tested contrast.
- [x] Provide a user-invoked PATH installer for the bundled CLI on supported packaged Windows, Linux and macOS builds; AppImage needs manual handling.
- [ ] Verify CLI install/removal on real Windows, Linux and macOS accounts, including shell startup and PATH collisions.
- [x] Add an authenticated queue view, paged library lookup, and separately enabled queue changes through the existing show writer, with revision checks and original-outcome retries.
- [ ] Complete general CLI actions, events, pagination and scoped callers. Playback, library import, providers and other specialized commands remain open.

## Priority 1 — playback and display

- [x] Import same-name MP3/CDG and single-pair ZIP through bounded cancellable FFmpeg conversion; originals stay unchanged.
- [ ] Package/validate FFmpeg, verify real producer CDG audio synchronization and support multi-song archive imports if useful.
- [ ] Evaluate and add useful KaraFun Player 2 formats separately from MP4 and CDG support.
- [x] Add seek, elapsed/remaining time and acknowledged resume checkpoints; verify audio/sync on real hardware separately.
- [ ] Add pitch/key and tempo controls with per-song and per-singer defaults and reset.
- [x] Add independent instrumental, lead and backing stem levels for native KaraFun, including multiple supplied duet/choir voices; preserve through pause/seek and reset per performance.
- [ ] Verify real-recording/full-song mixing on show hardware and evaluate other compatible stem/multiplex sources.
- [x] Add enabled-by-default launch/interlude bumper, saved theme, default output, cancellable fade-in and acknowledged silence before karaoke.
- [ ] Verify audible bumper routing on show hardware; add fade-out, separate filler volume and richer intermission policies. Fade-in is implemented.
- [ ] Verify the inter-song pause interval on physical show hardware for finish, skip and restart.
- [ ] Extend configurable display presets and test physical fullscreen/monitor behavior; booth name, logo size, next singers and timed scrolling banner are implemented.
- [x] Verify desktop queue arrow navigation and mobile keyboard focus recovery and announcements in isolated browser rehearsals.
- [ ] Extend accessibility coverage to full keyboard-only workflows, screen readers, high contrast and text scaling on actual devices.

## Priority 2 — singers, remote use and administration

- [ ] Define account identity, ownership, sign-in, recovery, retention and privacy rules before exposing profiles remotely.
- [ ] Enforce Host, Co-host, Moderator, Singer and Audience permissions at the service boundary.
- [ ] Add persistent profiles with name, email, favorites, playlists, private host notes and access level; allow self-editing except notes and access level.
- [ ] Add role management and moderation audit history.
- [x] Deploy the experimental authenticated MySQL-backed internet relay with role-limited singer operations, bounded requests, rate limits and same-generation recovery.
- [ ] Complete production load/abuse testing, real-phone/venue checks, owner provisioning and broader account/privacy administration.
- [ ] Test existing local-network singer access with real phones, certificate trust, venue DNS/firewalls and network interruptions.
- [ ] Verify the existing native-wrapper Piggyback room flow on physical devices, including secure admission, browsing, requests and withdrawal.
- [ ] Test native Android/iOS devices, lifecycle, secure storage, certificate validation and uncertain request outcomes.
- [ ] Add personal-data view/export/delete controls and protect host-only notes.
- [ ] Extend configurable content policy and rating visibility across sources and roles. Existing age and blacklist restrictions already apply at supported discovery, request and playback boundaries.
- [ ] Add privacy-preserving diagnostic logs and error reporting; redact credentials, private notes, account data and media paths.
- [ ] Add localization and accessible date, time and text formatting.
- [ ] Define product subscription plans, billing, device limits, offline grants and recovery without cutting off an active show.

## Documentation and release

- [ ] Keep this checklist, [handoff](handoff.md), [host README](../README.md), [singer guide](singer-guide.md) and developer/operator guides synchronized with implemented behavior and tested limits.
- [x] Reconcile the [Karaoke Nerds operator guide](karaokenerds-catalog.md) with deployed shared search, private desktop connection, offline query cache and refresh recovery limits.
- [x] Regenerate the 0.5.0 Word specification from [product specification](product-specification.md), render and visually review all 38 pages, then publish the current edition.
- [x] Regenerate the 0.4.0 37-page Night/Day mockup PDF from Markdown and visually verify every page; repeat whenever requirements or screens change.
- [ ] Complete platform install/update/uninstall, signing/icon and distribution checks; private catalog configuration and media tools remain separately provisioned. Keep delivery versions 0.x.y until approved 1.0.0.
- [x] Prepare the [release acceptance checklist](release-acceptance.md) for backup, rollback, hardware, store readiness and provider/venue terms.

Provider notes: [provider research](provider-research.md), [Sunfly operator](sunfly-account-status.md), [Stingray operator](stingray-catalog.md), and [Karaoke Nerds catalog](karaokenerds-catalog.md). Current automated tests and prior muted rehearsals are useful evidence, but they do not replace real hardware, real accounts or production verification.

## Historical milestone follow-up

These dated checkpoints record what was known at each milestone. For current priorities, use the sections above.

### 0.3.0 verification follow-up

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
- [ ] Verify real 0.3 installation/upgrade/removal and physical show hardware; macOS was unbuilt at the 0.3 milestone; native 0.4.4 package/arm64 launch evidence is listed below.

The import’s original transient metadata cause is not proven. Remote accounts, broader roles, paid providers, final signing, remaining native icon surfaces, actual phones and show hardware remain unfinished; passing rehearsals do not imply a finished 1.0 release. Windows 0.4.1 package/installed resources and Start menu references are now verified below.

## 0.3.1 default lyric backdrop

- [x] Bundle the owner-selected TPV Version 3 animation as a silent full-duration default for new CDG imports, with custom/solid choices in Singer Display preferences. Existing converted songs require reimporting.
- [x] Import timed LRC with same-name audio and shared backdrop. Muted Windows Electron verified lyric timing, seek, persisted pause and explicit resume.
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
- [x] Complete the Markdown-derived Word refresh with native Windows LibreOffice rendering, inspect every page and publish the verified 0.5.0 edition; older versioned files remain historical.
- [x] Restore existing catalog/queue/ratings services left stopped by unattended MySQL maintenance, without changing code, schema, credentials, provider configuration or website behavior.
- [ ] Review and apply a separately proposed service-recovery prevention change; the current proposal remains unapplied.
- [x] Verify macOS 0.4.4 DMG/ZIP payloads and native Apple silicon launch; see the versioned evidence below.
- [ ] Verify native Dock appearance and physical Windows/Linux desktop behavior before 1.0.0.

## 0.4.2 Provider Search

- [x] Prioritize catalog search before streaming; public KaraFun/Party Tyme metadata works without account credentials or a paid API plan.
- [x] Cache complete public snapshots in app-process memory for up to 24 hours, coalesce loads, apply failure backoff and label retained older snapshots.
- [x] Add fixture-tested Stingray/Sunfly desktop metadata adapters and private profile selection; Sunfly returns no partial snapshot matches.
- [x] Keep provider results search-only, provider-scoped and out of the playable queue; enforce restrictive show policy at the host boundary and ignore obsolete renderer replies.
- [x] Add the default-on Karaoke Services search preference and path-only provider profile settings.
- [x] Verify Windows 0.4.2 setup/ZIP from runtime `e501475` and the actual 0.4.1→0.4.2 upgrade, preserving seven original show/configuration hashes after a private backup.
- [x] Pass 723 Windows tests with seven skips and type checking; packaged/installed live public searches, unconfigured partner states, queue/playback boundaries, saved toggle/restored policy guards, no autoplay, nine app/setup icon frames and 69 branding hashes passed.
- [x] Verify final Linux 0.4.2 AppImage/Debian payloads, public search and compiled-CLI privacy from frozen `e501475`; 21 focused control/privacy tests passed and 119 unchanged earlier checks are retained by source comparison. Real-user installation, sandbox and physical hardware remain open.
- [ ] Add persistent/central provider metadata caching if required; current provider caches disappear when the app exits.
- [ ] Obtain real Stingray/Sunfly catalog credentials and verify their APIs; website account passwords are not developer keys.
- [ ] Connect each provider's eligible subscription, approved streaming engine, reporting and queue/transport lifecycle. Metadata search does not complete playback integration.

## 0.4.3 Public Sunfly Store

- [x] Add default public Sunfly Store title/SF-SKU discovery when no developer profile is selected; use no account credentials or paid-client keys.
- [x] Preserve store-qualified product IDs and optional exact SF SKUs, separate from streaming identities and entitlements.
- [x] Bound results to five first-page individual-song products; enrich artist/duration only from matching Product/MusicRecording metadata and leave missing artists unknown.
- [x] Cache Store query/detail metadata in the main process for five minutes/24 hours; preserve explicit developer-profile failures without public fallback.
- [x] Provide public/developer mode labels and profile-selection removal that retains credential files.
- [ ] Verify artist-query coverage and broader Sunfly Store discovery separately; do not claim complete catalog coverage.
- [x] Complete 0.4.3 tests, Windows/Linux package checks and the actual Windows upgrade; see verified delivery below.
- [ ] Connect approved Sunfly streaming identities, subscription rights and playback; store metadata alone does not provide them.

## 0.4.3 Verified Delivery

- [x] Build Windows installer/ZIP and Linux AppImage/Debian packages from frozen runtime `d14bfb2`; preserve receipts and SHA256 sums.
- [x] Upgrade this Windows PC, retaining all seven original show/configuration hashes after a protected backup.
- [x] Pass 736 Windows tests with seven environment/platform skips, type checking, 52 focused Linux tests, and actual packaged metadata/CLI/profile-clear checks.
- [x] Verify exact Sunfly Store SKU/ID/title; Windows enriched the artist, while the Linode detail-page HTTP 403 produced the explicitly tested Unknown artist fallback. Do not infer credits or bypass the denial.
- [x] Keep search-only records out of playback/queue, redact private profile paths by default and retain credential files when clearing their selection.
- [ ] Obtain real Stingray/developer-provider access, verify Sunfly artist search/coverage and connect approved subscription playback.
- [ ] Verify physical show output, real-user Linux installation/sandbox, publisher signing/notarization and remaining Mac installation/runtime checks.

## 0.4.4 macOS Packages

- [x] Build separate arm64/x64 DMG and ZIP packages from clean frozen source `340eca7` on macOS 27.0.1 Apple silicon; retain receipts and SHA256 checksums.
- [x] Pass 735 tests with eight platform/environment skips and zero failures, type checking and all 69 branding hashes.
- [x] Verify both architectures, ad-hoc signatures, ICNS/backdrop/CLI assets and matching ZIP/read-only mounted-DMG payloads.
- [x] Launch/restart the native arm64 app with a muted disposable profile; verify singer persistence without autoplay, Day/Night logos, minimum-width controls and bundled CLI help without external Node.
- [x] Move the Mac CLI launcher into sealed Resources/control and make CI fail on errors piped to logs.
- [ ] Test Intel runtime, Finder installation/upgrade/removal, native Dock appearance, Gatekeeper approval and full Mac app-to-CLI lifecycle/navigation.
- [ ] Verify Mac physical audio/display devices and external yt-dlp/FFmpeg discovery/conversion; add an explicit FFmpeg path choice if needed.
- [ ] Configure Apple Developer ID signing/notarization for public distribution. Current signatures are ad-hoc integrity signatures only.

Windows/Linux latest delivered packages and the installed PC remain 0.4.3; this Mac packaging update does not establish a new Windows/Linux build or paid-provider playback.

## 0.5.0 Host Workflow and Source Integration

- [x] Bring the reviewed `opencode-audit` interface into the current source while retaining newer Mac packaging fixes.
- [x] Add a silent actual-singer-window preview above/below Host Queue, with a hidden option.
- [x] Add pointer/keyboard-resizable sidebar, queue and preview separators, saved dimensions, viewport clamps and reset.
- [x] Keep the transport visible with long combined local/service/YouTube search results and across host layouts.
- [x] Add host-wide artist and artist/title blacklists, Preferences editing and library context actions; enforce current rules at search, request and playback boundaries.
- [x] Store source-less file heart votes locally in schema-3 `show.sqlite`; retain authenticated global source-ID votes and per-key capabilities.
- [x] Pass separate global QA-voter set/repeat/update/clear checks without changing existing human votes or credentials.
- [x] Add bounded `yt-dlp` karaoke search with channel hints, approved-only mode, channel blocklists and Takeout subscription import.
- [x] Queue a selected YouTube candidate through canonical search receipts and the normal singer dialog/download authority, without autoplay.
- [x] Add opt-in LAN visual sharing on default port 4051, with multiple bounded browser streams, no extra audio and no host-control API.
- [x] Add epoch-fenced/deduplicated singer capture and read-only HTTP lifecycle/backpressure tests; pass private host UI rehearsals for controls, blacklist behavior and local ratings.
- [x] Review KHost/plugin architecture and licensing boundaries; keep the independently written optional contract bridge separate from native TPV playback.
- [x] Send authorized KaraFun, Stingray, Sunfly and Party Tyme follow-ups; record available replies and official integration routes.
- [x] Integrate the timed-LRC parser and VTT foundation.
- [x] Implement the optional TPV/KHost external search/handoff bridge and host controls, with protected profile selection, current-policy/blacklist checks and original-ID uncertain-outcome recovery; KHost owns sign-in, acquisition and playback.
- [ ] Verify loading the compiled bridge and authenticated search/handoff on the owner's actual KHost machine; their successful separate KHost subscription test does not establish this integration.
- [x] Implement experimental [native KaraFun](karafun-native-integration.md) login, validated session/search, authorized bounded KIT/Ogg/timing playback and ordinary TPV queue/transport; the optional KHost bridge is separate. Remaining physical/provider-term work is listed above.
- [ ] Obtain approved paid-provider playback access, pricing and subscription-linking terms; consumer subscriptions alone do not confirm this integration.
- [ ] Verify LRC on physical show equipment and add screen-reader-accessible captions and enhanced word timing.
- [ ] Add a Google Drive application source, with identity, indexing, download and cache rules; local synced-folder import is a different path.
- [x] Integrate the reviewed `opencode-audit` UI and join its snapshot ancestry while preserving newer fixes; all remote and local branches are merged. Fourteen patch-equivalent internal cherry-pick commits were joined at `bd1d011` with no file changes.
- [x] Record the current 0.5.0 complete core-suite result: 861 passes, eight platform/environment skips, zero failures (869 total), plus passing type checking.
- [x] Verify actual silent synthetic-video pixels in the host preview and two isolated LAN browsers, with Stop/close clearing, reconnect, port migration and shutdown; preserve the owner rating profile during a read-only readiness check with no vote.
- [x] Build Windows 0.5.0 setup/ZIP from clean frozen `8d4c003`; pass actual packaged restart/no-autoplay, Day/Night logos, minimum-width controls, 20 payload-file comparisons and nine app/setup icon frames.
- [x] Build macOS 0.5.0 Apple silicon/Intel DMG/ZIP from the same source; verify signatures/payloads, native arm64 launch/restart/branding/CLI help and all downloaded artifact hashes. Intel native execution and notarization remain open.
- [x] Build the optional bridge 0.1.0 ZIP from the frozen source; retain its receipt/hash without claiming real KHost loading or authenticated handoff.
- [x] Complete Linux 0.5.0 AppImage/Debian package checks from frozen `8d4c003`: 861 passes/eight skips/zero failures, matching payloads/branding and actual private AppRun restart/no-autoplay, CLI/API, catalog and offline local-rating persistence. Root/Xvfb flags were test-only; non-root desktop and physical devices remain open.
- [ ] Verify actual Windows 0.5.0 installation/upgrade/removal; this PC remains installed at 0.4.3.
- [ ] Verify LAN screens on real venue browsers/Wi-Fi/firewall configurations and compare lyric latency/quality; source/HTTP tests do not establish physical-show readiness.
- [x] Regenerate and publish current Word/PDF planning deliverables from the frozen canonical Markdown; visually review all 38 Word and 45 PDF pages, covering 21 screen families; retain source/artifact hashes.

Verification is version-specific: Windows/Linux/macOS 0.5.0 package checks passed from the same frozen runtime. New Windows installation, Intel Mac execution, Linux desktop integration and physical show/venue checks are not claimed. Earlier platform evidence remains historical. See [source status](source-status.md) and [LAN singer-screen help](singer-screen-sharing.md).
