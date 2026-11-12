# The Proper Volume Karaoke

Product specification for the desktop host, singer display and companion applications

**Revision:** 12 November 2026. **Application milestone:** 0.3.1 development; official release target 1.0.0. **Implementation reference:** current repository checkout and its Git history. **Document owner:** The Proper Volume. This Markdown file is the maintained source for the product specification and the companion mockup book; generated documents must be regenerated from it rather than edited independently.

This specification describes both the current rehearsal build and the product we intend to build. It updates and preserves the scope of the earlier Word specification, including future singer, staff, provider, subscription, API and policy capabilities. It incorporates the later decisions to approve requests automatically by default, support both local-network and internet remote use, and make embedded metadata edits an explicit per-edit choice. User decisions take precedence over older planning text. Mockups use synthetic data and must never be mistaken for evidence that a planned feature or service is live.

**Status key:** **Available** means implemented in the current repository, subject to the stated testing limits. **Experimental** means implemented for rehearsal but not verified for live shows. **Planned** is a requirement or product direction that is not implemented. **Decision open** identifies a behavior, policy or implementation choice that still needs agreement. A partially implemented item states exactly which portion exists.

## 1. Product direction and boundaries

The Proper Volume Karaoke is intended to be a dependable, local-first karaoke hosting product for Windows, macOS and Linux. A desktop host controls a show, its music library, the singer rotation and a separate singer display. The intended ecosystem also includes a singer experience, a dedicated KJ remote and a staff queue workspace, with appropriate boundaries between them. A **party** and a **show** mean the same live session. Hosts or venues are expected to pay; singer participation is free. Subscription prices, plans, billing cadence, trials, limits and launch dates are undecided.

The host computer is the single authority for show state, queue rules and playback. Local hosting must remain usable without an internet connection. A singer or remote client requests a change; the host validates it, persists it, and returns an acknowledged result. Companion interfaces must never become a second playback or queue authority. The microphone and live vocal processing remain external to the current product; microphone effects and recording are later possibilities, not current features.

**Available:** an Electron desktop rehearsal application with local MP4 import, singer and request management, a separate output window, persisted show state, basic collections, configurable preferences, and an experimental local singer browser. **Experimental:** local-network guest access, output selection, bumper playback, unified local/Karaoke Nerds library search, hosted internet singer sessions, queue-integrated YouTube downloads and local playback and a separate manually started preview. **Planned:** the full native companion apps, general local API, complete access-control model, paid karaoke providers and paid subscriptions. The app is not yet validated as a live-show replacement.

### Development versions and installers

Version each delivered application update using semantic 0.x.y versions and include it in the host interface, installer filename and completion report. Reserve 1.0.0 for the approved official release. Several focused commits delivered together may share one version. At 0.3.0, Windows x64 installer/ZIP and Linux x64 AppImage/Debian packages have built and passed isolated packaged checks. The owner reports successful 0.2 installer use without specifying platforms. Actual 0.3 install/upgrade/uninstall and physical show checks remain. Linux x64 AppImage and Debian packages have built, with explicit runtime dependencies and payload checks; the final AppImage passed isolated virtual-display launch/restart checks. Actual desktop installation and hardware checks remain. macOS Intel and Apple silicon DMG/ZIP require a Mac build and verification. Packages exclude private configuration, media, yt-dlp, FFmpeg and LibreOffice, and preserve the established app-data directory. Windows packages are unsigned and use the default Electron icon; signing, notarization and the final icon remain release work. See the installation guide for actual artifact status.

## 2. People, interfaces and navigation

**Available:** the host workspace has Library, Requests, Singers, Playlists and Remote Sessions navigation; an always-visible playback area; a singer rotation or FIFO request queue; search; settings; and a separate singer display. Back up show is available from the host workspace. The singer browser is an opt-in local-network page with its own limited projection and guest actions. The mobile directory contains an **offline native singer preview** using synthetic data; it cannot join a show, send real requests or store credentials.

**Planned:** distinct KJ remote, delegated staff queue workspace, expanded singer web and native clients, and account/billing screens. A KJ remote emphasizes transport, while queue staff moderate and organize future turns without playback or output controls. The singer experience provides discovery, own requests and a safe public view of the show. A singer display is presentation-only and never exposes host controls, private notes, file paths or account information. Native clients are not assumed to inherit browser security properties; their authentication, certificate handling, secure storage, background behavior and reconnection require separate testing.

### Visual and interaction principles

Use The Proper Volume branding, Nunito Sans and the Avenir Next, Avenir and Novecento Sans fallback stack. Night, Day and Follow system are appearance options. A toolbar palette button cycles the primary accent through blue, pink and purple independently of appearance; its current/next color is available to screen readers and in an immediate tooltip. The choice persists in `settings.json` and older settings default to blue. Night uses background `#090E18`, panel `#101724`, text `#F4F2E9`, and blue/pink/purple accents `#0EB7FF` / `#FF92BF` / `#C7ADFF`; Day uses background `#FDFEF8`, panel `#F3F2E9`, text `#1C1A18`, and accents `#1765A6` / `#A91E5C` / `#5B35AA`. Themes retain the same controls and behavior. Source video and provider-protected lyrics are not recolored by the application theme.

Use clear status words alongside color, strong headings, visible keyboard focus and accessible names. Primary touch targets should be at least 44 by 44 CSS pixels; phone transport should target 48 pixels. Keep critical transport visible when browsing a long library. Icons reveal immediate, prominent tooltip labels; where an action has a configured shortcut, show that shortcut in the hint. Modal actions keep the user's work and return focus appropriately. Provide keyboard and touch alternatives to drag and drop. Full accessibility, contrast, reduced-motion and screen-reader verification remain planned.

## 3. Host workspace and settings

**Available:** the main screen has a library, visible singer rotation, import controls, current/staged status and a persistent Play/Pause, Stop, Skip and volume area. A song is selectable without playback. Double-click or Enter opens an Add to Queue dialog for an existing singer or a new singer name; submitting adds a request rather than starting a song. The contextual menu offers Add to Queue, Add to Playlist, Edit Metadata, Relink File and Show in Files. Queue rows are selectable and Delete removes an eligible request; an active performance is protected. Search is accessible from both host and singer windows.

**Available:** Preferences is an icon-opened dialog with expandable Shared Karaoke Nerds Catalog, Appearance, Library Settings, Video Downloads & Karaoke Nerds Cache, Queue Management, Remote Queueing, Audio Controls, Singer Display and Configuration Files sections. The video-download section selects a permanent base directory and optional yt-dlp executable. Approved queued YouTube recordings dispatch a serial permanent download to this folder; adding a metadata-only library entry does not start a download; automatic brand/artist batch preferences remain planned. Workspace layouts are Standard, Wider singer rotation and Wide song library. Preferences use validated `settings.json`; a link reveals it in the file manager and shows the full path in a tooltip. Missing known fields get defaults; unknown or invalid fields are rejected. A separate `keybindings.json` currently configures only Search and Play/Pause, including default Ctrl+F or Meta+F and Space. Keyboard shortcuts do not steal ordinary text entry.

**Planned:** complete settings coverage, migrations and helpful error recovery; layout variants including a genuinely compact single-screen show; user-configurable shortcuts for every actionable command, full default listings, collision detection and reset; and a global action/command interface. Appearance changes must not interrupt a show. Confirm skip and other show-interrupting actions; routine pause, volume and valid queue edits should not require repeated confirmation. Undo of eligible queue edits is a proposed feature, with any expiry and conflict behavior to be specified.

## 4. Library, import and metadata

**Available:** import local MP4 files or recursively scan a selected folder. Hashing runs in a worker; the host sees progress and paged per-file outcomes and can cancel without losing songs already committed. Results are kept in memory until the next import or app exit. Duplicate contents are detected using SHA-256; source files stay in place. Unreadable or changed files are reported. Actual large-library, network-drive, Dropbox and codec performance require testing. Changed-file errors now receive at most two new complete fingerprint checks after short cancellation-aware waits; other errors are not retried. The real 237-MP4 Dropbox folder first reproduced all-file changed errors, then imported successfully. Final packaged 0.3 imported and persisted all 237 files into a disposable library with zero failures and two non-MP4 files skipped. A separate test injected a changed error on every file before a successful full rehash. Original media and the real show database were unchanged; the exact underlying transient metadata cause is not proven.

**Available:** host search covers title, artist, filename basename, DJ code and track number, with sort and metadata/rating filters. Filenames are supplied only to the host, not guest clients. A missing or moved MP4 can be relinked to a byte-for-byte match to its imported original; a different recording must be imported as another song. Before start the full stored fingerprint is checked; an unchanged ordinary resume uses a quick identity check, with a full recheck after an observed change or restart. Full hashing can delay start for large files, and a concurrent modification after checking is not guaranteed to be caught.

**Available:** configurable filename/folder templates are tried in order, with metadata ambiguity marked for review and a fallback format. Supported fields include `${Artist}`, `${Title}`, `${Track Name}`, `${DJ Code}` and `${Track Number}`. Examples include `${DJ Code} - ${Artist} - ${Title}`, `${Track Number}.${Artist} - ${Title}`, `${Artist}/${Track Name}.mp4` and `${Title} - ${Artist}`. Host artist/title corrections currently update the local library only.

**Planned:** source selection and precedence across embedded tags, filename/path patterns and manual overrides; safe preview, rescan and batch review; alias indexing; version grouping without losing the exact chosen recording; ratings and provenance; folder watch and duplicate review; and optional regular-expression parsing if a validated design is chosen. Template priority and ambiguous matches must be clear; no silent guess may overwrite an existing host correction.

**Confirmed requirement, not implemented:** each metadata edit lets the host choose whether to also write supported embedded file tags. The default is local-only. Import, rescan and ordinary edits never silently change media or filenames. If an explicitly requested write is unsupported or fails, preserve the local edit and clearly report the file outcome. A safe implementation needs source-change checks, format support, backup/recovery, updating the whole-file fingerprint and tests for interruption, permissions and conflicting tags. See the metadata write-back design in the repository.

**Available through conversion:** Import CD+G / ZIP accepts a same-name MP3/CDG pair or a ZIP with exactly one pair. FFmpeg on PATH converts it to a managed H.264/AAC MP4 before library insertion; originals remain unchanged. The job has progress and cancellation, fixed-name extraction, expanded-size/CRC checks, path/symlink checks and explicit ambiguity errors. It is not native CDG playback: lyrics and the chosen background are composited at import. From 0.3.1, the default is the owner-selected `TPV-Karaoke-Backdrop-Video (Version 3).mp4`, bundled as a smaller, silent, full-duration 1080p playback copy. The animation loops behind the original CDG lyric colors; only the paired MP3 supplies audio. Preferences → Singer Display → Lyric Backdrop offers TPV Animated Backdrop (Version 3), Solid CDG Background, or a custom local MP4. The choice is captured for each new import; existing converted songs retain their picture and must be reimported to change it. Missing/unreadable selected backdrops stop import with a recovery message. Regular video songs retain their own picture. Converted videos use normal playback and require separate media backup. **Planned LRC support:** use this same backdrop selection by default when timed-lyric playback is implemented; LRC import, synchronization and rendering are not available yet. FFmpeg packaging, real-producer synchronization and other Player 2 formats still need evaluation. An extension alone does not prove a codec is playable; publish an evidenced codec matrix per supported platform.

## 5. Requests, rotation and singer fairness

**Available:** a host can add or select a singer, submit a song and remove eligible requests. New requests are automatically approved by default; switching to host moderation affects new requests and does not silently approve existing pending ones. In Requests the host can accept or reject pending requests and view recent terminal request history. The separate missing-song form saves singer, title and optional artist to a local review table; the host may mark it Pending, Reviewing, Fulfilled or Declined. Saving a missing-song request does not add a recording or create a rotation turn.

**Available:** the host chooses arrival-order FIFO or a fair singer-rotation mode. The rotation gives eligible singers turns and keeps an explicitly staged song locked until released or removed. The host may promote one eligible waiting request ahead of other waiting requests; an already staged song remains first. Promotion preserves assigned rounds and remains in effect through Stop unless replaced or invalidated; completion or skip consumes it. The default maximum is three future requests per singer identity; hosts may set 0 for unlimited or 1–50. Pending, accepted and staged requests count; the currently playing song does not. Lowering the limit preserves existing requests. A rejection explains the limit. A different guest or duplicate singer identity has its own count; the limit is not proof of a unique person.

Authenticated local singers may withdraw their own pending or accepted request. Staged and playing requests remain locked to the singer; a guest cannot manipulate another singer's requests, the room-wide queue, transport or outputs. Completed, skipped, removed, rejected and withdrawn request records remain in show state; the host view and guest snapshot show a bounded recent subset. Completed and skipped performance history is saved for generations recorded since the history feature was added; it is not backfilled.

**Required queue invariants:** a completed or explicitly confirmed skipped performance consumes its turn exactly once; pause and failed preparation consume none. New singers join the remaining current-round tail while an unstarted turn exists; after the final turn begins they enter the next round. A staged song is not silently displaced by a late request, policy change or mode switch. Preparing a song never starts audible karaoke. Transport and generation-specific callbacks must not consume a newer song's turn. Switching queue modes must preserve requests.

**Available:** the host may drag or move accepted waiting requests, reset to automatic order, and right-click to change a waiting track or singer. Staged and playing songs remain locked. Manual order persists and new arrivals follow the explicit list; reassignment respects request limits and assigns the recipient’s next free round while retaining a manual slot. Duets and an actor/reason audit trail remain planned.

**Available:** hosts and authenticated local singers may mark a singer unavailable for 1–60 whole minutes or return immediately. While absent, at most one future request is allowed; existing extras stay but block additions. Available singers are scheduled first, absent singers by return time; expiry restores existing FIFO/fair order subject to manual order and the staged lock, without autoplay. Deadlines persist. A guest cannot release staged/playing requests; the host must explicitly confirm a staged release. The host may mark the active singer away for future scheduling without interrupting their current performance. Distinct indefinite hold/skip-turn policies and duplicate same-singer/version handling remain planned.

**Planned:** indefinite holds and skip-turn rules; actor/reason audit history and touch coverage; own-song ordering without advancing one's turn; per-request key/tempo and private notes; duplicate same-singer/version handling; duet/group invitations and accepted membership; and approximate queue and wait-time projections. A group performance belongs to one lead singer and consumes one turn; invitees do not lose their own place. Wait estimates must state assumptions, use ranges where appropriate, recalculate after changes and show unavailable during unbounded pauses or intermission. Pre-arrival lists do not reserve a turn.

## 6. Playback, audio and singer display

**Available:** Play/Pause stages the next eligible request when needed and starts or pauses/resumes the performance. Stop returns the current request to the queue; confirmed Skip consumes the active turn. Playback has a generation identity, checkpoints position and restarts paused after an interrupted session. Start and resume are deliberate host actions. On a reported output-device or display loss the application pauses and asks the host to resolve the issue; actual hardware behavior still needs testing.

**Available:** the host chooses an audio output or the operating-system default and can adjust global volume. The singer window is assigned to a monitor; hosts can toggle fullscreen or set the next-open fullscreen preference. Optional singer-display settings show upcoming names and a custom PNG/JPEG logo. The configured inter-song pause interval is 0–300 seconds after completion or confirmed skip; staging may occur while the clock runs, the deadline persists across restart, and the host still starts the next song. A zero interval is the default.

The singer video is bounded to the full window viewport (maximum 100vh/100vw) with aspect ratio preserved and no vertical scrolling. Landscape, 4:3 and portrait sources use letterboxing/pillarboxing as needed. Branding, caption and next-singer information overlay the viewport instead of adding height. The separate embedded preview uses its own bounded layout and retains visible native controls.

**Experimental:** bumper music requires a ready singer display and an explicitly selected output; system default is not accepted. Three generated instrumental themes and up to five custom audio files are available. Audio Controls saves an opt-in automatic-between-songs checkbox and selected theme; its default is off. Successful natural completion or confirmed Skip arms an intermission only after the current singer display acknowledges karaoke silence. The host can also start/stop music manually. Karaoke start/resume waits for acknowledged bumper stop. Stop, pause, launch, changed settings and output recovery never automatically start music; loss or change of output cancels automation. The pause interval remains a minimum gap before the host may start the next song. Tracks may continue through the bumper list until stopped or karaoke starts. Physical audible routing and device-loss verification remain required; muted integration tests do not prove what a mixer receives.

**Available:** the bottom timeline shows elapsed/remaining time, supports dragging or keyboard scrubbing and ten-second rewind/forward. Seeking preserves play/pause state and saves acknowledged positions; stale-generation events are rejected. It supports local MP4s (including converted CDG) and downloaded YouTube videos through that same local player. Real-hardware synchronization and recovery remain unverified.

**Planned:** further recovery verification, key and tempo with per-song and per-singer settings, independent lead/backing vocals only where stems or compatible multiplex data exist, richer intermission scheduling, separate filler volume and fades, and richer waiting/ready/playing/paused/error output screens. The earlier proposed filler fade values of 1.5 seconds in and 1.0 second out are design candidates, not implemented or hardware-verified defaults. Never overlap two audible karaoke streams; pause alone must not automatically start filler. No source MP4 or CDG text is reflowed, translated or restyled unless a separate licensed renderer expressly supports it.

## 7. Access, identities and privacy

**Available:** the host process validates sender and command boundaries. The current domain has limited host, staff, singer and engine roles; these are foundations, not the complete product access-control system. Local guest sessions identify the singer server-side. Guest catalog and request projections exclude other singers' credentials, private paths and host-only data.

**Planned:** assignable Host, Co-host, Moderator, Singer and Audience Member levels, enforced by the service rather than merely hiding controls. Define capabilities and delegation for moderation, queue edits, transport, settings, private notes, outputs, provider accounts, billing and audit history. Public join links never grant staff or host authority. A host or billing owner can revoke credentials independently.

**Planned:** shared user profiles with name, account email, favorites, playlists, notes and access level. A user can update their own name, email, favorites and playlists; only authorized staff can edit access level or host notes. Define ownership, sign-in, recovery, retention, export and deletion before exposing profiles remotely. Temporary guests need no mandatory account; optional profiles may carry choices across devices only with informed consent. A display name is not authentication. Never expose private staff notes, media paths, provider secrets, account/billing data or tokens through guest views or routine logs.

## 8. Local and internet singer access

**Experimental local browser:** a host explicitly opens a local room from Preferences, selects a private IPv4 interface, hostname, certificate and private key, and creates a time-limited shareable invitation. The hostname must resolve to the chosen host interface and the certificate must be trusted by Node and the singer's device. A singer joins by name, browses policy-filtered loaded pages, submits or withdraws eligible requests, sees their own statuses and can ask for a missing song. Search currently covers loaded catalog pages; the guest can load more. A link grants admission to anyone who has it until expiry or revocation. Closing the room revokes access; revoking invitations alone does not revoke already admitted guests. Access credentials live in page memory; closing or reloading the page requires a fresh invitation. This is not yet verified on physical venue phones and networks.

**Required for both modes:** no unauthenticated public host controls, no source paths or media URLs in guest responses, same-origin and Host validation, bounded requests and responses, role checks, expiration, revocation and rate limits. Guest actor and singer ownership come from the authenticated session. Guest commands carry caller-generated IDs, show identity, host epoch and expected revision. Persist mutations and receipts together. A retry with the same ID and payload returns the original result; changed content is rejected. On an uncertain outcome, query the receipt rather than automatically resending a stale action. Show disconnected/pending/unknown states and refresh authoritative snapshots on reconnect.

**Experimental internet sessions:** the host opens Remote Sessions, keeps or edits a suggested custom URL slug, presses Start Session and copies the public singer link at `https://queue.thepropervolume.com/<slug>`. Guests on Wi-Fi or mobile internet open the link, enter a name and use the host library. Anyone with the active link can join; this is temporary public admission, not a verified account identity. Scoped host credentials stay in a separate private file and never appear in the link or renderer. Outbound authenticated long-polling relays only allowlisted singer operations to the desktop authority; no arbitrary URL proxy or inbound desktop listener is exposed. A temporary network interruption retains the same room and guest receipt scope. Explicit End, replacement, expiry, denial or a host-process restart fences the old generation. The singer can check an uncertain outcome and explicitly retry its original ID/payload; it is never silently replayed. End/revoke and internet failure preserve the local show and separately scoped LAN access. Production relay leases use a dedicated MySQL schema; SQLite is only an isolated relay test adapter. Live packaged Windows-to-browser HTTPS verification passed for custom URLs, join/request/withdraw/availability/missing-song operations, generation fencing and shutdown. A deliberately lost request reply recovered its original receipt without a duplicate; true awaited state checks observed reconnection after a brief poll failure, preserving the same guest access. Physical phones, venue networking, load and prolonged outages remain separate verification work. The legacy Quick Tunnel prototype remains disconnected scaffolding.

**Planned phone and companion features:** optional profiles and singer history/favorites, per-version key/tempo memory, pre-arrival lists and check-in, approximate wait estimates, opted-in up-next notifications with an in-app fallback, and accepted/declined duet or group invitations. Alerts derive from acknowledged show state, deduplicate and become stale when a turn changes; a notification never advances the rotation or proves attendance. Staff/KJ pairing and authorization are separate from singer admission.

A planned saved list outside a show is personal preparation, not a reserved turn. If a host opens requests early, show received, approved, checked-in and eligible as distinct states; revalidate the exact version, policy, access and key support when submitting. Approval and check-in rules remain host-configurable product decisions. A proposed heartbeat every two seconds and disabled controls after five seconds without a host update require actual network measurement before adoption. On reconnection a fresh snapshot precedes new actions; the relay must not queue stale actions for surprising later execution.

## 9. Recovery, backups and data

**Available:** the application stores show state and metadata in SQLite, commits durable changes before acknowledgement, uses schema migrations and checkpoints the active playback position. A restarted interrupted show is paused rather than autoplayed, under a fresh host epoch. A single-instance lock and one forced-termination recovery path have been rehearsed. Playback position may lag the latest audible position; it is not proof that a turn completed.

The host can create a validated SQLite snapshot to a new filename. Existing destination files and SQLite sidecars are not overwritten; the destination must support hard links. If cleanup fails, the host is told whether publication occurred and can retry cleanup. Backup contains private singer data and library paths; choose a private destination. Video files, bumper audio, settings, shortcuts and logos are not included and need separate backup.

**Planned:** an integrated, recoverable restore flow, backup before schema upgrades, archive/reopen and full show lifecycle controls. A restore prototype creates a separate file and retains the previous database but is not connected to startup or exposed to hosts. It must be validated for offline cutover, interrupted commits, WAL/sidecar handling, instance locking, identity binding and rollback before use. Do not copy only a live SQLite file and assume its WAL contents are included.

Required failure handling covers missing/corrupt files, unsupported codecs, output and screen loss, media stalls, disk-full and database errors, stale staff edits, provider outages and relay disconnects. A failed persistence operation cannot be acknowledged as successful. Preserve the active singer's turn when preparation fails; do not silently substitute a different recording, reroute sound or resume playback.

## 10. Collections, history and policies

**Available:** host-managed Singer Playlists, KJ Picks, Artists and History views. Hosts can search recorded performance history by singer, artist or title, filter it by singer, and export the matching records to a new CSV file. CSV cells that could be interpreted as spreadsheet formulas are prefixed with an apostrophe. Export requires a destination filesystem that supports hard links; choose a private destination because its permissions are inherited on Windows. Genres is a placeholder until genre metadata exists. These are local show/library features, not cross-device singer accounts. **Planned:** favorites, playlist import/export, per-singer ownership and sharing, and retention/deletion controls.

**Policy foundation exists:** versions can be included or excluded, and age-restricted eligibility hides unrated, uncertain and conflicting material. Guest catalog and request boundaries use the same eligibility decision. **Planned:** an accessible host policy interface, show/party allowlists and exclusions by song/version/source/playlist, preview of affected future turns, owner-only blocked-item maintenance, evidence provenance and audit. Exclusions win; all discovery, direct-ID, favorites, request, stage, playback and API paths must enforce policy. A policy change must not silently stop active audio.

Content evidence belongs to the exact recording and version; title/artist similarity or an absent explicit flag is not proof of a clean edit. Any future lyric or advisory analysis must use permitted sources, retain source, confidence, coverage and expiry, distinguish advisory from automated assessment and host decision, and preserve unknown/conflicting results as unrated. Category severity must not be averaged in a way that hides a severe category. No lyric scraping or protected-content export is specified; evidence availability and licensing are open decisions.

Planned age policies may set separate profanity, sexual-content, violence and substance thresholds, including stricter singer age bands; the party's rule wins because all guests hear the performance. Collect only needed age bands and treat self-declared age as unverified. Version-specific rules should record actor, reason, scope and timestamp; permissions to change policy never imply permission to bypass a provider license. MP4, CDG and protected streams may not expose readable lyrics. Version-specific licensed evidence should be used where available; evaluate language, context, coverage, expiry, clean edits and ambiguity without presenting an automated score as a universal minimum age. Lyric analysis cannot certify video, backing audio or live improvisation.

## 11. Architecture, API and CLI

**Current architecture:** Electron with context-isolated sandboxed renderers and narrow named preload bridges; TypeScript domain and main process; React interfaces; SQLite persistence; a separate presentation window; and a replaceable experimental browser media element. Trusted file operations, network authority, tokens and playback decisions stay in the main process. Renderer inputs and senders are validated. The media engine owns its clock; show state advances on acknowledged generation-specific events. A background importer does not own the database.

Logical entities include Song, exact SongVersion and LocalAsset; Show/Party, Singer, ShowSinger, Request and QueueItem; Playback generation, position and outcome; command result/receipt and show event; preferences and approved provider references. Future entities include profiles, per-version preferences, attendance, invitations, notification preferences, group performances, provider entitlements and billing/device grants. Do not infer a persistent profile from a guest session or a catalog entitlement from a favorite.

**Planned general API and CLI:** every supported application action should be available through one authenticated local authority and a documented command-line client, not a second SQLite writer. Offer capability discovery, effective preferences, shows/parties, users and own libraries, catalog/import, playback, outputs, providers, policy, commands and events as permissions permit. Default the general API off; use authenticated loopback with scoped, revocable tokens. LAN binding requires explicit opt-in and authenticated TLS. Publish versioned OpenAPI/event schemas, pagination, stable IDs, structured errors and CLI help/exit codes. Protect file paths, billing data and secrets. Local API and CLI work independently of any cloud relay and are **not implemented** today.

For every mutation, validate role, show/epoch, expected revision, item state and active policy. Persist the original result with the command ID before replying; reject reused IDs with different content. Stale clients refresh a filtered snapshot; an unknown result is queried rather than replayed blindly. Generation identifiers protect playback from late events. Nonstructural high-frequency controls need sequencing so old slider updates cannot overwrite newer state.

The proposed versioned resource families are `/v1/capabilities`, `/v1/preferences`, `/v1/parties`, `/v1/users`, `/v1/users/{id}/library`, `/v1/catalog`, `/v1/playback`, `/v1/outputs`, `/v1/providers`, `/v1/policies`, `/v1/commands` and `/v1/events`. Exact routes and compatibility guarantees are a design proposal, not a live endpoint. Capability discovery should report supported versions, commands, bounds, role scopes and required local confirmations. Provider credentials and local paths require appropriately restricted owner scopes. Authenticated event subscriptions must be revoked with their token and resume from a fresh authorized state.

## 12. Providers and commercial access

**Experimental shared metadata catalog:** Karaoke Nerds permits its community feed to be called approximately once per day and cached. The recovered initial JSON snapshot contains 64,261 records and now seeds a dedicated MySQL 8 catalog on Linode III. All 64,261 valid, unambiguous YouTube identities are searchable, including brands without a verified page slug. Preserve upstream brand codes; never invent a slug or producer code. The original SQLite catalog, mappings and last-attempt/success history have not been recovered. Those timestamps and retirement state remain unknown. The read-only HTTPS service has passed server-side authentication, pagination, backup and separate-schema restoration checks; live Windows HTTPS status and a cross-field artist/title search passed, and a new client instance recovered the saved search with network access disabled. No feed call was made during this recovery.

**Experimental unified host discovery:** ordinary Song Library search keeps local matches immediately and adds debounced Karaoke Nerds results by artist/title. Exact YouTube IDs merge with existing host-edited library entries; different recordings remain distinct. A catalog failure does not erase local matches, and saved offline matches show their age. Service badges show YouTube in place of a local DJ/brand code. Double-click, Enter or Add to Queue opens singer selection; an unknown recording and its request are saved through the single host authority, and approved accepted/staged requests dispatch a serial yt-dlp download immediately. Pending manual moderation waits for approval. Downloading does not start playback, discard a turn or replace a selected version. Progress, waiting-job cancellation and explicit failed-job retries are available. A metadata-only manual link addition remains optional. The separate manually started internet preview remains outside the queue and selected output, and must not overlap karaoke or bumper audio. No paid-provider subscription is connected.

**Central catalog deployment and desktop connection:** use the isolated MySQL 8 schema on Linode III behind the authenticated HTTPS service at `apps.thepropervolume.com`. MySQL and the reader bind to loopback; dedicated reader, writer, migration and backup accounts are separate from website accounts. Daily private backups and an actual scratch-schema restore are verified. The desktop uses a scoped reader token in a separate private JSON file, selected through Shared Karaoke Nerds Catalog in Preferences; database and provider credentials never reach renderers or singers. Choosing or checking a draft configuration does not change saved searches. Up to 100 validated query/status cache entries, bounded to 20 MiB, support previously saved searches after restart during transient outages. Authentication denial invalidates that scope; malformed replies never fall back to stale data. Display offline/stale status and failed cache persistence. Local-only use remains available. The host show database stays local SQLite. Automatic upstream refresh is disabled, with no provider credential or activation gate installed. Retire every legacy refresher and verify/import real attempt history before one central updater can enforce the durable minimum 24-hour interval. A read-only seed does not establish refresh authority.

The community feed supplies metadata and YouTube watch links, not directly downloadable video files. Its brand value is an internal lookup and join key; cache paths use the corresponding verified brand-page slug. Its `Created` value must not be assumed to be a video's publication date. Individual YouTube downloads are connected to the host catalog and library through yt-dlp, with progress, cancellation and persistent media attachment to the same version. Complete H.264/AAC MP4s are verified and published without overwrite; exact-ID ownership sidecars enable hash-checked reuse. Cancellation waits for child-process termination before safe cleanup, retaining uncertain staging. Batch selection, publication-date verification and production deployment remain separate work. A metadata API key does not itself establish rights to download or cache the linked media.

**Planned video-cache behavior:** the host chooses a base directory and specific brands or artists, with automatic caching opt-in. For an artist, select the most recently published eligible video for each artist and track. Use a verified publication date when available and an exact-video match from yt-dlp's upload date as the best available approximation when it is not; preserve which source was used and do not label an upload date as a confirmed publication date. A ranking that compares any upload-date fallback is approximate, even if the selected video's own date is verified. Do not substitute Karaoke Nerds `Created` or a yt-dlp release date for either. The batch-planning prototype requires complete artist coverage and reports incomplete or ambiguous cases, including competing versions without either usable date. The target layout is `$BASE_CACHED_VIDEOS_DIR/$PROVIDER/Brands/$BRAND_SLUG/$ARTIST/$ARTIST - $TRACK_NAME.$FILE_EXTENSION`, for example `/chosen/path/karaokenerds/Brands/TheProperVolume/Nada Surf/Nada Surf - Amateur.mp4`. Reject unresolved brand matches and ambiguous or colliding destinations, prevent traversal and symlink escapes, and never silently overwrite an existing file. Automatic brand/artist batch downloads remain unimplemented; explicitly selected videos now download and attach to the existing library entry.

**High-priority planned music providers:** integrate through approved APIs or SDKs with confirmed commercial, geographic, operating-system, playback, cache and reporting rights. A priority is letting hosts link an existing KaraFun account and use its eligible subscription in the app where the provider permits it. KaraFun advertises native login and user-linked subscriptions through its [OEM partnership API](https://business.karafun.com/oem), but the partnership, applicable plans and rights, operating systems, availability and pricing for this project remain unconfirmed. Prioritize Stingray and Sunfly and investigate additional compatible services the host can use for under $20 per month each; this limit applies per service, not to their combined cost. Confirm actual total pricing, developer access, eligible subscriptions and hosting rights before representing a service as within budget. Candidate research also includes Party Tyme and Karaoke Cloud Pro; no access, catalog, pricing, entitlement, endorsement or integration is promised. Adapters must describe exact version, availability, entitlement and capabilities such as seek, key/tempo, offline playback, stems, lyric mode, output restrictions and supported platforms. Never silently replace a chosen recording or bypass protected playback. An unavailable provider must not disable local songs or destroy queue state.

Hosts or venues pay for the application in a future commercial release; singers participate free. App access and provider subscriptions are separate entitlements unless an agreement explicitly bundles them. Plans, prices, tax, refunds, trials, billing cadence, device limits, concurrent shows, grant duration and provider terms remain undecided. A proposed paid release uses server-verified subscription status, signed device-bound offline grants, billing-event idempotency and a bounded grant for a show already started; an outage with a valid grant should not stop local hosting, and billing expiry should not unexpectedly cut live audio. Preserve viewing, export and recovery when an entitlement expires. Account, billing, checkout, licensing and paid access are not implemented.

Proposed account screens distinguish active, verification pending, payment issue, cancellation scheduled and expired; show the full recurring price, billing period, limits and catalog exclusions before checkout. Checkout return alone must not activate access. An authenticated billing owner manages invoices, payment method, cancellation, reactivation and device release; operational staff and singers cannot view or change billing. Billing events require verification, deduplication and ordering protection. A billing outage is not proof of failed payment; an unexpired local grant permits its approved scope, while an expired grant preserves local media, viewing, backup and export. Clock changes, grace periods and offline/show duration limits must be defined before release.

Provider due diligence must establish documented authentication, commercial and geographic coverage, allowed caching and offline terms, approved presentation, usage reporting, platform-specific SDK behavior, account linkage and data handling before a provider appears as supported. Each integration is independently approved and tested. Licensing and data rights for optional lyric evidence are separate from permission to play a recording. Possible research leads include [KaraFun OEM](https://business.karafun.com/oem), [Party Tyme player integrations](https://www.partytymeplayer.com/partytyme/site/?page_id=2345), [Sunfly API](https://api.sunflykaraoke.com/) and [Stingray integration guidance](https://karaoke-api-doc.stingray.com/docs/introduction/design-guidelines/); these links are leads, not claims of current access.

## 13. Quality, verification and release gates

The 0.3.0 default Windows test run passed 566 checks with four opt-in/platform skips, including five asynchronous-wait regressions; six document-generator checks passed. Linux passed 76 targeted checks and final AppImage launch/version/restart/persistence/no-autoplay. The server passed 50 relay checks including real MySQL transactions and nonempty backup/restore/restart. Actual packaged Windows-to-public-relay-to-browser operations passed, as did real catalog search and immediate yt-dlp acquisition of the owner’s selected recording after queueing. The final package imported all 237 actual MP4s in a disposable library. Muted integration checks cover automatic bumper completion/Skip/silence and restart. These checks do not establish audible mixer output, physical monitor hot-plug, actual phones, non-root Linux sandbox behavior, long-show reliability, macOS or a complete platform support matrix.

The 0.3.1 backdrop update passed type checking and 571 automated tests with four skips. Nine CDG checks include real FFmpeg pixels/audio, palette-index preservation, timing, looping, cancellation and error recovery. An isolated muted Electron rehearsal verified saved default/custom/solid choices across restarts, imported pixels against the actual bundled TPV video, unchanged source files and no rewriting of an existing converted song after a preference change. These synthetic CDG checks do not replace real-producer and physical synchronization verification.

Before a live-show release, verify Windows 11 x64, an agreed Linux desktop and macOS on representative hardware, including codecs, installers/signing, external displays, output selection, hot-unplug/reconnect, audio routing, cross-platform shortcuts, screen readers, database upgrades/backups/recovery and long shows. Test real iOS and Android devices, venue Wi-Fi, DNS, firewall and relay outages. Record machine, OS, media fixtures, versions and observed output. No production support claim should be inferred from a unit test or a mockup.

Proposed targets, not measured guarantees: local search p95 below 150 ms for 100,000 indexed versions; committed desktop queue edits under 100 ms; remote p95 below 500 ms on a healthy network; staged local start to audible output under one second; a four-hour show without lost turns or growing drift; audio/lyric synchronization within 100 ms after pause/seek; desktop target 1280 × 800 logical pixels with a usable compact 1024 × 720 mode; and companion layouts from 320 to 1024 CSS pixels. Verify 200% text scaling and WCAG 2.2 AA as design targets.

Acceptance must include: safe local import and relinking; MP3/CDG and ZIP pairing diagnostics; deterministic rounds, holds and manual overrides; no turn loss on preparation failure or repeated callbacks; separate display and explicit recovery; no unintended audio after restart; persistent acknowledgements and concurrent-edit rejection; guest ownership and staged-item locks; LAN and internet disconnect/reconnect behavior; policy enforcement through every route; provider entitlement and capability checks; private-data redaction; and keyboard/touch accessibility. Paid release additionally requires verified subscription, offline-grant and event-replay behavior without cutting a running show.

## 14. Remaining decisions and maintenance

Open decisions include final naming, commercial packaging and provider agreements; account and singer identity methods; profile retention and deletion; policy thresholds and evidence sources; final media engine, supported formats and operating systems; device/disconnect behavior; restore and backup retention; relay ownership, availability and privacy; notification delivery; and the precise hold/reorder/check-in rules. Proposed behavior is not a shipping promise until implemented and verified.

The current implementation, tests and host/singer help should be reviewed whenever this specification changes. Update this Markdown and the corresponding application help and developer documents in the same focused change as behavior. Regenerate the Word specification and visual mockup book from this source, then visually inspect the outputs; do not maintain independent conflicting copies. Preserve the original handoff as historical context, but do not let its old moderation or source-file defaults override the decisions recorded here.

## 15. Interface mockup specification

This section is the editable source for the generated Night and Day mockup deck. Each `mockup` block describes a screen; the generator draws both themes from the same content. These are design representations, not screenshots. A **Current** badge denotes a screen in the desktop or local singer application; **Partial** includes current behavior plus clearly identified future ideas; **Planned** is not shipped. The native mobile app is an offline preview, and Internet queueing is not yet available. The examples below are fictional and do not imply licensed catalog access.

Maintain the accepted desktop structure: a host workspace and persistent player, a clear singer rotation, uncomplicated singer display, and paired Night and Day designs. Source video and lyric colors are not recolored. Tooltips appear immediately and include assigned shortcuts when available. Host-only and singer-facing data remain separate.

```mockup-theme
{
  "product": "THE PROPER VOLUME",
  "deck_title": "Karaoke interface mockups",
  "deck_subtitle": "Current screens and planned experiences | Night and Day",
  "host_actions": ["palette", "search", "display", "fullscreen", "settings"],
  "themes": {
    "Night": { "background": "#090f1b", "panel": "#101b2b", "card": "#1a293d", "line": "#34455b", "text": "#f3f7fc", "muted": "#a8bad0", "accent": "#13bbef", "selected": "#153b54" },
    "Day": { "background": "#f4f7fb", "panel": "#ffffff", "card": "#e9f0f7", "line": "#c4d1df", "text": "#17283d", "muted": "#51657a", "accent": "#007fae", "selected": "#d7eef9" }
  }
}
```

```mockup
{
  "id": "D01", "title": "Desktop host", "status": "Current",
  "description": "Library, singer rotation and persistent transport remain visible in one workspace.",
  "layout": "desktop",
  "navigation": ["Back up show", "Library", "Karaoke Nerds", "Requests", "Singers", "Playlists", "Remote Sessions"], "selected_navigation": "Library",
  "heading": "Song Library", "toolbar": "Search title, artist, filename or code     Sort     Filter",
  "import_actions": [{"icon": "importVideo", "label": "Import Video File"}, {"icon": "importFolder", "label": "Import Custom Directory"}],
  "rows": ["Popular | Nada Surf | PVOL-002", "Example Song | Sample Artist | YouTube", "Another Example | Demo Band", "A Song for Tonight | Sample Artist"],
  "side_heading": "Singer Rotation", "side_rows": ["ON STAGE | Alex - Popular", "NEXT | Casey - Example Song", "THEN | Jordan - Another Example", "Drag waiting rows or right-click to edit"],
  "footer_heading": "Now Playing", "footer_rows": ["Alex | Popular", "01:20 / 03:45 | Seek | -10s / +10s | Volume 45%"], "transport_icons": ["playPause", "stop", "skip"],
  "detail": "Palette cycles blue, pink and purple. Search, Singer Display, Fullscreen and Preferences are icons. Double-click a song to choose a singer and add it to the queue."
}
```

```mockup
{
  "id": "Q01", "title": "Requests and rotation", "status": "Partial",
  "description": "Host moderation and the singer rotation, with advanced staff actions reserved for later work.",
  "layout": "desktop",
  "navigation": ["Back up show", "Library", "Karaoke Nerds", "Requests", "Singers", "Playlists", "Remote Sessions"], "selected_navigation": "Requests",
  "heading": "Requests", "toolbar": "Pending requests       Request history",
  "rows": ["Casey | Example Song | Accept / Reject", "Jordan | Another Example | Accepted", "Alex | A Song for Tonight | Withdrawn", "Sam | Example Song | Removed"],
  "side_heading": "Singer Rotation", "side_rows": ["ON STAGE | Alex", "1 | Casey", "2 | Jordan", "Delete removes focused waiting request"],
  "footer_heading": "Transport", "footer_rows": ["Singer limit: 3 future requests", "Rotation: fair singer turns"], "transport_icons": ["playPause", "stop", "skip"],
  "detail": "Current: drag reorder, edit track/singer, timed absence and return. Staged songs stay locked. Duets and audit history remain planned."
}
```

```mockup
{
  "id": "K01", "title": "Host and staff companions", "status": "Planned",
  "description": "Future staff surfaces for authorized transport and request moderation.",
  "layout": "phones", "phone_titles": ["Host companion", "Staff moderation"],
  "phone_subtitles": ["Current show", "Requests waiting"],
  "phone_rows": [["Alex | Popular", "Next: Casey", "Play/Pause", "Stop / Skip", "Audio controls"], ["Casey | Example Song", "Accept / Reject", "Jordan | Another Example", "Singer notes | staff only", "Rotation status"]],
  "detail": "The full Host, Co-host and Moderator roles and these companion apps are not implemented."
}
```

```mockup
{
  "id": "S01", "title": "Singer join and request", "status": "Partial",
  "description": "The current experimental LAN browser joins by name and sends requests; the native app is an offline preview.",
  "layout": "phones", "phone_titles": ["Join the show", "Request a song"],
  "phone_subtitles": ["Private invitation", "Browse loaded songs"],
  "phone_rows": [["Your name", "Casey", "Join the show", "Access lasts for this page", "Ask host for a new link after reload"], ["Search songs", "Popular | Nada Surf", "Request", "Can't find a song?", "Send title and artist to host"]],
  "detail": "LAN access requires an explicitly opened room, trusted HTTPS certificate and matching local DNS. Internet and persistent accounts remain planned."
}
```

```mockup
{
  "id": "S02", "title": "Singer discovery and queue", "status": "Partial",
  "description": "A singer sees their own request status and can withdraw eligible requests.",
  "layout": "phones", "phone_titles": ["Song library", "Your requests"],
  "phone_subtitles": ["Loaded songs", "Live status"],
  "phone_rows": [["Search loaded songs", "Example Song | Sample Artist", "Request", "Load more songs", "Ask for a missing song"], ["Example Song | Accepted", "Withdraw", "Another Example | Staged", "Staged turns stay locked", "Away 1-60 min / Return now"]],
  "detail": "Current: statuses, withdrawal and own timed availability. One future request while away. Planned: wait estimates and notifications."
}
```

```mockup
{
  "id": "O01", "title": "Singer display", "status": "Current",
  "description": "Presentation-only output keeps the karaoke video prominent and leaves source colors unchanged.",
  "layout": "display", "display_title": "SINGER VIDEO", "display_subtitle": "Lyrics and video appear here", "display_next": "Coming up: Casey  /  Jordan",
  "detail": "Video fits the viewport without cropping or scrolling; captions and branding overlay it. Monitor hot-plug still needs verification."
}
```

```mockup
{
  "id": "D08", "title": "Preferences and audio controls", "status": "Partial",
  "description": "Grouped, collapsible preferences keep essential show controls in the workspace.",
  "layout": "settings", "navigation": ["Shared Catalog", "Appearance", "Queue Management", "Library Settings", "Video Downloads & Karaoke Nerds Cache", "Remote Queueing", "Audio Controls", "Singer Display", "Configuration Files"], "selected_navigation": "Audio Controls",
  "heading": "Audio Controls", "rows": ["Output Device | Explicit device or system default", "Playback Volume | 45%", "Pause Interval | 0 seconds", "Automatic bumper | Opt-in between songs", "Bumper theme | Soft Ambient", "Custom audio | up to 5 files"],
  "side_heading": "Other groups", "side_rows": ["Appearance | Night / Day / System", "Queue | Rotation, approval, singer limit", "Library | Ordered filename templates", "Singer Display | Lyric backdrop, logo, next singers"],
  "footer_heading": "Preferences", "footer_rows": ["Cancel", "Save preferences"],
  "detail": "Automatic bumper is opt-in and waits for karaoke silence on the selected output. Fades and physical-device verification remain planned."
}
```

```mockup
{
  "id": "B01", "title": "Account and billing", "status": "Planned",
  "description": "Future host or venue subscriptions; singers participate without a required paid subscription.",
  "layout": "panels", "heading": "Account and billing", "toolbar": "Future account and service settings",
  "rows": ["Host or venue account | Sign in and manage account", "Subscription | Plan, renewal and payment settings", "Provider access | Separate catalog entitlements", "Devices and offline access | Subject to provider terms"],
  "side_heading": "Singer participation", "side_rows": ["Join a show without purchasing a subscription", "Optional profile and personal lists", "Review privacy and account controls"],
  "footer_heading": "Release gate", "footer_rows": ["Billing, accounts and paid providers are not implemented"],
  "detail": "Pricing, purchases, external provider access and entitlement models require separate product decisions."
}
```

```mockup
{
  "id": "P01", "title": "Song availability and age policy", "status": "Planned",
  "description": "Future host-facing controls for policy, visibility and age-appropriate catalog access.",
  "layout": "panels", "heading": "Song availability", "toolbar": "Show policy   /   Audience settings",
  "rows": ["Allowed songs | Select available versions", "Excluded songs | Hide selected versions", "Age restricted show | Apply content rules", "Unrated or uncertain | Review before allowing"],
  "side_heading": "Guest catalog", "side_rows": ["Only policy-eligible songs appear", "Apply policy on direct requests", "Keep host-only notes private"],
  "footer_heading": "Policy", "footer_rows": ["Domain filtering exists; a complete host policy interface is planned"],
  "detail": "The preview describes the intended interface; existing policy rules do not constitute full moderation or account permissions."
}
```

```mockup
{
  "id": "A01", "title": "Local control API", "status": "Planned",
  "description": "Future optional local API and CLI share the host's single authoritative show state.",
  "layout": "panels", "heading": "Local control", "toolbar": "API access and integrations",
  "rows": ["Local API | Disabled until explicitly enabled", "Access tokens | Scoped and revocable", "Command line | Actions and status", "Diagnostics | Avoid private paths and notes"],
  "side_heading": "Authority", "side_rows": ["No second database writer", "Authenticate every operation", "Persist results before acknowledgement"],
  "footer_heading": "Not yet available", "footer_rows": ["The existing LAN singer service is not a general local API"],
  "detail": "A complete API, CLI, role model and integration credentials are not implemented."
}
```

```mockup
{
  "id": "S06", "title": "Singer library and planning", "status": "Planned",
  "description": "Future personal favorites and early song lists do not reserve a live turn.",
  "layout": "phones", "phone_titles": ["My songs", "Plan for a show"],
  "phone_subtitles": ["Favorites and memory", "A list is not a request"],
  "phone_rows": [["Favorites", "Example Song | Sample Artist", "Remembered key | future", "Playlists", "Private singer preferences"], ["Friday song ideas", "Another Example", "A Song for Tonight", "Request after joining", "No queue turn is reserved"]],
  "detail": "The current desktop has host-managed playlists and history. Personal accounts, favorites, remembered settings and prearrival lists remain planned."
}
```

```mockup
{
  "id": "S08", "title": "Duet and group invitations", "status": "Planned",
  "description": "Future group invitations require an explicit response and create one shared performance.",
  "layout": "phones", "phone_titles": ["Invite a singer", "Respond to invitation"],
  "phone_subtitles": ["One shared song", "Your choice"],
  "phone_rows": [["Example Song", "Lead singer: Casey", "Invite Jordan", "Waiting for response", "Cancel invitation"], ["Casey invited you", "Example Song", "Accept", "Decline", "No turn until confirmed"]],
  "detail": "Duets, group identities, acceptance and group-turn scheduling are not implemented."
}
```

## YouTube acquisition and playback

**Available:** Song Library combines local and exact Karaoke Nerds/YouTube catalog identities. An approved queued request immediately dispatches permanent acquisition through a serial yt-dlp queue, deduplicating requests for the same version. Manual URL additions save metadata only; a host may explicitly choose Download Video before queueing. Accepted/staged requests missing their media reconcile on restart. The host selects the permanent base folder and optional yt-dlp executable; FFmpeg is also required. Waiting jobs can be cancelled and failed downloads explicitly retried; a normal failure does not create an automatic retry loop or remove the singer request. Uncertain cleanup halts further automatic acquisition. Service badges retain YouTube; completed downloads never autoplay.

Mapped brands use `BASE/karaokenerds/Brands/BRAND_SLUG/ARTIST/ARTIST - TITLE.mp4`; plain links/unmapped brands use `BASE/youtube/ARTIST/ARTIST - TITLE.mp4`. Safe names and exclusive publication prevent overwrite; a video-ID suffix is used only for an occupied name. A verified ownership/fingerprint sidecar is required to reuse unattached cache files. Same song, request and history identities are retained. Cached media uses normal output selection, transport, timeline and offline playback. Download completion never starts playback; the host presses Play. Missing or changed files require deliberate recovery. Complete files survive restart and app exit and need separate media backup.

The separate embedded preview still uses system audio and requires internet; it remains outside the show and does not download. Brand/artist automatic batch selection, paid providers, YouTube login and general YouTube search remain planned. The installed tools downloaded the owner's video and verified H.264/AAC with zero-network reuse. Real show output, every video, supported platforms and packaged tool distribution remain verification work. No paid provider is connected; KaraFun OEM access and a quote, Stingray credentials/terms and Sunfly SDK/trial approval remain external gates.


```mockup
{
  "id": "D09", "title": "Shared catalog connection", "status": "Partial",
  "description": "Host-only catalog discovery uses a scoped service connection, with freshness shown honestly.",
  "layout": "settings", "navigation": ["Shared Catalog", "Appearance", "Queue Management", "Audio Controls"], "selected_navigation": "Shared Catalog",
  "heading": "Shared Karaoke Nerds Catalog", "rows": ["Use shared catalog | Enabled when configured", "Choose configuration | Private client JSON", "Check connection | Separate from saving", "Catalog freshness | Unknown until verified"],
  "side_heading": "Offline behavior", "side_rows": ["Previously saved searches | Available after restart", "New searches | Connection required", "Authentication rejected | Replace client configuration"],
  "footer_heading": "Preferences", "footer_rows": ["Cancel", "Save preferences"],
  "detail": "Illustrative connection state. No database or provider keys enter the interface. Feed refresh is disabled pending verified retirement and cooldown history."
}
```


```mockup
{
 "id":"D10", "title":"Internet singer session", "status":"Partial",
 "description":"Start a hosted singer session with an editable short address and a public join link.",
 "layout":"panels", "heading":"Remote Sessions", "toolbar":"Internet singer requests at queue.thepropervolume.com",
 "rows":["Session name | proper-volume", "Start Session | Explicit host action", "Singer link | queue.thepropervolume.com/proper-volume", "Copy Link | Share with your guests", "End Session | Revoke internet access"],
 "side_heading":"Connected Singers", "side_rows":["Casey | Joined", "Jordan | Joined", "Remove Access | Revoke current session"],
 "footer_heading":"Anyone with this link can join", "footer_rows":["Keep the booth running", "Local queue remains authoritative"],
 "detail":"Illustrative session. Temporary network loss keeps the same receipt scope; End or replacement invalidates its generation. Accounts, paid providers and physical-device verification remain separate."
}
```


### Application icon review

The approved color preference for the current icon exploration is vivid purple `#601CE9`, cyan `#0EB7FF`, deep ink `#19102D` and cream `#FFFFF3`. This approves the palette, not a final mark. Review four original TPV lettermarks first, then a vintage grille microphone with volume waves and a darker headphones/faders refinement. Every direction includes light and dark editions; pink is a secondary alternate only. The earlier standalone V is no longer recommended. Previews and editable assets are linked from `docs/app-icon-options.md`; the packaged application still uses its default icon pending selection.

```mockup
{
  "id": "D11",
  "title": "Lyric backdrop preferences",
  "status": "Current",
  "description": "Choose the default background for new CDG conversions and future LRC playback.",
  "layout": "settings",
  "navigation": [
    "Appearance",
    "Library Settings",
    "Singer Display",
    "Audio Controls"
  ],
  "selected_navigation": "Singer Display",
  "heading": "Singer Display",
  "rows": [
    "Lyric Backdrop | TPV Animated Backdrop (Version 3)",
    "Other choices | Solid CDG Background / Custom Video",
    "Custom video | Choose a local MP4",
    "Animation audio | Silent; paired MP3 only",
    "Applies to | New CDG imports after saving",
    "LRC lyrics | Planned, not yet playable"
  ],
  "footer_heading": "Preferences",
  "footer_rows": [
    "Cancel",
    "Save preferences"
  ],
  "detail": "The TPV animation is bundled and loops behind the original CDG lyrics. Reimport existing CDG conversions to change their backdrop; ordinary videos keep their own picture."
}
```
