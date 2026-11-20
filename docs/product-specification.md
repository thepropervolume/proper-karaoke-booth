# The Proper Volume Karaoke

Product specification for the desktop host, singer display and companion applications

**Revision:** 19 November 2026. **Application milestone:** 0.10.3 development. Official release target 1.0.0. Platform package versions, build receipts and installation evidence are maintained in the installation guide. **Implementation reference:** current repository checkout and its Git history. **Document owner:** The Proper Volume. This Markdown file is the maintained source for the product specification and companion mockup book; generate other planning formats from it.

This specification describes both the current rehearsal build and the product we intend to build. It updates and preserves the scope of the earlier Word specification, including future singer, staff, provider, subscription, API and policy capabilities. It incorporates the later decisions to approve requests automatically by default, support both local-network and internet remote use, and make embedded metadata edits an explicit per-edit choice. User decisions take precedence over older planning text. Mockups use synthetic data and must never be mistaken for evidence that a planned feature or service is live.

**Status key:** **Available** means implemented in the current repository, subject to the stated testing limits. **Experimental** means implemented for rehearsal but not verified for live shows. **Planned** is a requirement or product direction that is not implemented. **Decision open** identifies a behavior, policy or implementation choice that still needs agreement. A partially implemented item states exactly which portion exists.

## 1. Product direction and boundaries

The Proper Volume Karaoke is intended to be a dependable, local-first karaoke hosting product for Windows, macOS and Linux. A desktop host controls a show, its music library, the singer rotation and a separate singer display. The intended ecosystem also includes a singer experience, a dedicated KJ remote and a staff queue workspace, with appropriate boundaries between them. A **party** and a **show** mean the same live session. Hosts or venues are expected to pay; singer participation is free. Subscription prices, plans, billing cadence, trials, limits and launch dates are undecided.

The host device, desktop or phone in Full Host mode, is the single authority for its own show state, queue rules and playback. Local hosting must remain usable without an internet connection. A singer or remote client requests a change; the host validates it, persists it, and returns an acknowledged result. Companion interfaces must never become a second playback or queue authority. The microphone and live vocal processing remain external to the current product; microphone effects and recording are later possibilities, not current features.

**Available:** an Electron desktop rehearsal application with local MP4 import, singer and request management, a separate output window, persisted show state, basic collections, configurable preferences, and an experimental local singer browser. **Experimental:** local-network guest access, output selection, bumper playback, unified local/Karaoke Nerds library search, hosted internet singer sessions, queue-integrated YouTube downloads and local playback, a separate manually started YouTube preview, unified host-only service catalog metadata search, native KaraFun account/queue/playback, and the initial authenticated local API/CLI for reads and settings navigation. **Experimental mobile:** the shared web interface provides Full Host and Piggyback modes with local show persistence and generation-scoped singer requests; Android/iOS wrappers and discovery require platform/device acceptance. **Planned:** complete mobile paid-provider playback, the full native companion feature set, complete general local API, complete access-control model, additional paid-provider playback and paid subscriptions. The app is not yet validated as a live-show replacement.

### Development versions and installers

Downloads at `release.thepropervolume.com` are public. Stable links select the latest files; five releases stay downloadable and older notes are archived. CI publishes desktop, Android development, iOS Simulator and planning builds to Linode. A Simulator build cannot be installed on an iPhone.

Version each delivered application update using semantic 0.x.y versions and include it in the host interface, installer filename and completion report. Reserve 1.0.0 for the approved official release. Several focused commits delivered together may share one version. Version 0.4.1 Windows installer/ZIP and Linux AppImage/Debian packages use frozen runtime source `24f5f15`, including the owner-selected Microphone Play identity, a text-free icon, full host logo and assisted-installer artwork. All 69 generated asset hashes passed. Actual Windows app/setup/uninstaller resources match all nine approved icon frames; this PC upgraded from 0.2.0 to 0.4.1 with original show/settings bytes preserved after a private backup. Installed Day/Night logos and Start menu/uninstall icon references passed. Linux verified both payloads, default light launcher icons, Day/Night logos, extracted AppRun launch/restart, public catalog, bundled CLI/API lifecycle and policy-lock behavior; 115 targeted checks passed. Linux used a private virtual display and test-only root flags, leaving shipping sandbox defaults unchanged. Real-user Linux installation, upgrade/removal and desktop sandbox remain unverified. The Windows safety-base suite passed 685 tests with seven platform/environment skips. Earlier 0.4.0 packages used Velvet Script; their separately documented playback/backdrop checks remain historical evidence. At the 0.4.1 milestone, macOS Intel and Apple silicon DMG/ZIP still required a Mac build; the 0.4.4 evidence below supersedes that packaging status. Packages exclude private configuration, song media, yt-dlp, FFmpeg and LibreOffice, and preserve the established app-data directory. Windows packages are unsigned. Signing, notarization, uninstallation, remaining native desktop surfaces and physical show checks remain release work. See the installation guide for receipts and platform limits.

Version 0.4.2 adds service catalog search before streaming integration. Windows installer/ZIP use frozen runtime source `e501475`; this PC upgraded from 0.4.1 to 0.4.2 after a private backup, preserving all seven original show/configuration hashes. Actual packaged and installed public-provider search, inactive partner status, disable toggle, restored policy restrictions and no-autoplay checks passed. The full Windows suite passed 723 tests with seven platform/environment skips. The final package receipt records no source revision change during its build. Default local CLI/API settings also redact nested provider-profile paths; explicit private-path inclusion and input immutability were verified. Linux 0.4.2 AppImage/Debian payloads and final packaged public-search/compiled-CLI privacy checks passed from the same frozen archive. Twenty-one focused control/privacy tests passed; 119 unaffected earlier checks are retained with source-comparison evidence. Linux installation, real-user sandbox and physical hardware remain unverified. Metadata discovery is not evidence of paid-provider playback.

The 0.4.3 development build adds default public Sunfly Store title/SF-SKU search and optional developer-profile mode selection. Windows 0.4.3 installer/ZIP and the actual 0.4.2-to-0.4.3 upgrade are verified from frozen runtime `d14bfb2`; 736 Windows tests passed with seven platform/environment skips. Packaged/installed public searches, exact Store identity, optional artist enrichment, profile-file retention, CLI privacy and policy guards passed. All seven original show/configuration hashes were preserved after a private backup. Linux 0.4.3 AppImage/Debian package checks passed from the same frozen runtime, including 52 focused tests and actual search/CLI/profile-clear checks. On the Linode test connection the Store API succeeds but product details return HTTP 403, so artist/duration remain explicitly unknown; Windows verified the known credit for the same SKU. Store metadata is separate from streaming identities and entitlements.

The 0.4.4 update delivers separate Apple silicon/Intel macOS DMG and ZIP packages from frozen source `340eca7`, with the selected text-free Microphone Play icon, bundled CLI and silent TPV backdrop. A native macOS 27.0.1 Apple silicon runner passed 735 tests with eight skips, type checking, 69 branding hashes, both architectures' deep/strict ad-hoc signatures, architecture/payload checks and matching mounted-DMG/ZIP contents. The arm64 app passed disposable muted-profile launch, restart persistence without autoplay, Day/Night logo/minimum-width checks and CLI help without external Node. Intel received static checks only. The declared minimum is macOS 13; older systems, Finder installation/upgrade/removal, Gatekeeper approval, native Dock appearance, full Mac app-to-CLI API lifecycle and physical show hardware remain unverified. Ad-hoc signing does not provide Developer ID certification or notarization. The launcher is sealed under `Contents/Resources/control`; yt-dlp and FFmpeg are not bundled, and Finder's PATH may need separate attention for external tools. Windows/Linux deliveries and this Windows installation remain 0.4.3. See the installation guide for artifact names, receipts and the successful workflow.

### 0.5.0 Source Integration

The reviewed `opencode-audit` interface is integrated with the newer Mac packaging fixes retained. At that milestone the source had persisted pointer/keyboard panel resizing, a silent actual-singer-window preview above/below Host Queue, host-wide song/artist blacklists, curated YouTube discovery and optional read-only LAN lyric screens. Source-less file heart ratings use local database schema 3; exact YouTube/Karaoke Nerds identities retain the authenticated shared MySQL service. At the 0.5.0 milestone native paid-provider playback remained pending. An optional independently written KHost companion bridge implements external search/handoff to a separately installed KHost; authenticated end-to-end use on the owner's target machine remains unverified.

Private muted UI rehearsals cover panel persistence, all layouts keeping the transport visible, preview placement, blacklist save/cancel/removal and local rating saves without a remote writer profile. A separate QA voter passed shared set/repeat/update/clear without changing human votes, credentials or service processes. Initial 0.5.0 core verification passed 857 tests with eight platform/environment skips and zero failures (865 total); type checking passed. A real silent synthetic MP4 played in the actual source app, and the host preview plus two isolated LAN browsers decoded matching singer-window pixels. Stop, display-close, reconnect, port migration and shutdown checks passed. An owner-profile read-only rating IPC check reported readiness/write capability with an empty lookup, left its protected profile hash unchanged and submitted no vote. The installation guide records subsequent complete-suite runs, package receipts and native packaged checks. Source rehearsals do not establish installation, physical audio/display behavior or live-show readiness. Prior 0.4.3/0.4.4 evidence remains version-specific.

### 0.7.0 Search, Show Automation and Display

The current source gives search the main workspace: a persistent sidebar field, one readable result list, common selection/context menus and three-pixel source borders. Colors are local/imported purple `#601CE9`, Karaoke Nerds blue `#007bff`, YouTube red `#ff0033` and KaraFun pink `#d5167a`. Search-only results retain disabled queue actions. Ctrl/Cmd+F or its assigned shortcut focuses global search from every workspace; extended guidance belongs in brief help/tooltips.

Approved requests auto-stage. Play begins the show; automatic advancement defaults on for subsequent completion/confirmed Skip, waiting for the configured gap and ready media without consuming failed turns. Stop/Pause, media/output/display errors and host cancellation fence delayed starts. Launch/restart never starts karaoke. Launch bumper is separately enabled by default, as is between-song music; default output works and fade-in defaults to 1000 ms (500–1700 ms). Gap zero permits a next start without a filler flash.

Desktop queue rows for YouTube, KaraFun and Party Tyme songs being prepared appear muted with their preparation status. If a song is still unready when its turn arrives, the next ready request plays while the waiting request retains its place for reconsideration after that performance. This repeats one song at a time. If no other request is ready, the show waits; a successful preparation can resume an already-armed automatic show. Failed preparation remains visible and can be retried from the queue menu. Pending approvals, singer availability and show policy remain in force.

Desktop Preferences provides automatic playback under Queue Management and the 0–300 second Pause Interval under Audio Controls. Mobile Full Host provides automatic playback and a 0–3,600 second gap under Room → Playback. Switching mobile automatic playback off during a gap leaves the next request waiting for manual Play.

One persistent hidden singer renderer supplies the actual preview and audio. Close hides that window; capture stays hidden and never duplicates a player. Booth name, immediate logo-picker preview, logo size 10–85vw and top/bottom scrolling banners with optional expiry/persistence customize the display. Unless persistence is selected, banner display resets on next launch while saved text remains.

Remembered KaraFun sessions are OS-encrypted where safeStorage is usable, validated on restore and retain their opaque account cache scope. Linux plaintext fallback is rejected. Normal quit preserves the session; explicit sign-out forgets it. Fresh start/resume authorization remains required. Primary completed native lyrics use KaraFun pink. Numeric KaraFun catalog/community recording keys are supported for global ratings without SQL changes; the matching production validator is deployed and verified. Community playback itself remains planned.

Read-only LAN screens bind concrete trusted private interfaces and loopback. On Windows, the interface must also be classified Private; unknown/Public results remain loopback-only. Network trust is checked every 30 seconds with a 5-second classification bound, closing untrusted listeners. No firewall/organisation policy is changed.

Focused automation/fade/capture/staging tests and isolated muted Electron rehearsals passed hidden preview, default-output launch music, completion/Skip gaps, Stop, paused restart, concurrent Play, Previous and readiness timeout/retry. Windows protected-session persistence passed independent-launch checks. Physical sound, real monitor/device hot-plug, full-song timing, native Linux/macOS provider playback and new platform packages remain separate acceptance gates. Earlier package/planning evidence below remains version-specific.

### 0.7.1 Optional Singer Assignment and Search Focus

Host queueing defaults to no singer assignment: leave **Singer (optional)** empty or select/create a singer. Requests store `singerId: null`; no placeholder Singer is created. The host queue shows **Unassigned**, while singer-display captions omit a missing name. Host/staff may submit unassigned requests; only host may assign/change/clear an eligible request later, including a prepared one without changing its request ID or staged/manual slot. Authenticated remote requests stay bound to their own singer identity.

Each unassigned request has an independent FIFO place in the current eligible fair round, or the next round after its final turn begins. It has no shared singer limit or absence state. Schema 5 transactionally makes performance-history singer IDs nullable while preserving assigned legacy shows/history; older apps refuse it, so back up before upgrade and retain that backup for downgrade. Search uses one outer focus ring, with the inherited inner input glow disabled.

### 0.8.0 KaraFun Vocal Mix

**Experimental:** Vocal Mix beside the host transport shows a 0–100% control for each actual native KaraFun audio stem. Instrumental, backing and lead groups include individual duet/choir channels and provider voice labels when present; unknown channels remain Other Audio. Lead vocals default to 0%, the others to 100%. Master Volume controls their combined output. A mixed stem cannot be separated into additional voices.

Host-only commands validate the current authorized performance and channel ID. Slider changes use 15 ms gain ramps without decoding again, seeking or restarting playback, and work while the singer window is hidden. Pause/seek/Previous retain the current mix. Reset This Song restores defaults; a new performance, Stop or sign-out clears it. Per-song/per-singer saved mix defaults are planned. Source tests and a muted synthetic five-stem desktop rehearsal cover independence, unchanged source count, hidden preview, seek/reset and stale/sign-out rejection. Real-recording listening and physical mixer validation remain open.

## 2. People, interfaces and navigation

The 0.5.0 workspace incorporates the owner-approved interface refresh from `opencode-audit`: compact transport, clearer library and queue headings, sidebar icons/counts, persistent error notices, dismissible timed informational notices, and a sticky Preferences header/footer. The integration preserves the newer macOS packaging and configuration fixes. Preview, resizable panels, global artist/song exclusions, filtered YouTube discovery and LAN singer-screen sharing are implemented in source with the specific verification recorded above; a visual refresh alone does not establish packaged or physical-show behavior.

**Available:** the host workspace has Library, Playlists and Sources, with Requests, Singers and Remote Sessions grouped at the bottom as Host Workspace; an always-visible playback area; a singer rotation or FIFO request queue; search; settings; and a separate singer display. Back up show is in the File menu. File → Import provides video-file, custom-directory and CDG/ZIP actions alongside the library icons. View offers Appearance, Choose Accent Color and Layout menus. Sources groups native KaraFun, Karaoke Nerds, YouTube and other service setup. KaraFun playback is experimental; other subscriptions remain pending. The singer browser is an opt-in local-network page with its own limited projection and guest actions. The mobile web app provides Full Host playback/queue and Piggyback requests using the same singer protocol. The mobile directory packages that shared interface for Android/iOS; it replaces the disconnected synthetic Expo preview. Native signing, distribution and physical-device acceptance remain separate gates.

**Planned:** distinct KJ remote, delegated staff queue workspace, expanded singer web and native clients, and account/billing screens. A KJ remote emphasizes transport, while queue staff moderate and organize future turns without playback or output controls. The singer experience provides discovery, own requests and a safe public view of the show. A singer display is presentation-only and never exposes host controls, private notes, file paths or account information. Native clients are not assumed to inherit browser security properties; their authentication, certificate handling, secure storage, background behavior and reconnection require separate testing.

### Selected Desktop Identity

On 13 November 2026 the owner selected the supplied orange/pink/navy vintage microphone and open play outline, called Microphone Play in the asset manifest (`mic-play`). This supersedes Velvet Script. The installed application icon has **no visible lettering**. Full horizontal and stacked logos read **TPV / KARAOKE BOOTH**, correcting the extra E in the reference. The reference and previous master set are retained as provenance/history. Self-contained SVG masters produce light/dark icons, ICO, ICNS, Linux PNGs, favicon/mobile assets and assisted-installer header/sidebar bitmaps. The default installed icon uses the reference navy mark on a white rounded tile; the dark edition adds a contrast keyline. The host header uses the matching full logo. Actual installation and native platform verification are recorded separately from asset export; an ICNS file is not a Mac build.

### Visual and interaction principles

Use The Proper Volume branding, Nunito Sans and the Avenir Next, Avenir and Novecento Sans fallback stack. Night, Day and Follow system appearances share the same controls. The palette opens Appearance; View and Preferences offer blue/pink/purple accents. Night uses background `#090E18`, panel `#101724`, text `#F4F2E9`, accents `#0EB7FF` / `#FF92BF` / `#C7ADFF`; Day uses `#FDFEF8`, `#F3F2E9`, `#1C1A18`, accents `#1765A6` / `#A91E5C` / `#5B35AA`. Source videos/CDG keep their original colors; native TPV-rendered KaraFun uses pink `#d5167a` for the primary completed lyric rather than pale green.

Use clear status words alongside color, strong headings, visible keyboard focus and accessible names. Primary touch targets should be at least 44 by 44 CSS pixels; phone transport should target 48 pixels. Keep critical transport visible when browsing a long library. Icons reveal immediate, prominent tooltip labels; where an action has a configured shortcut, show that shortcut in the hint. Modal actions keep the user's work and return focus appropriately. Provide keyboard and touch alternatives to drag and drop. Full accessibility, contrast, reduced-motion and screen-reader verification remain planned.

## 3. Host workspace and settings

**Available:** global sidebar search stays visible in every host workspace and focuses via the assigned shortcut. One dominant readable result list combines local, Karaoke Nerds, curated YouTube, connected KaraFun and public-service metadata. KaraFun results, saved or newly discovered, are hidden while signed out; account state fences pending replies and public catalog calls. Generic YouTube results, including cached recordings, are the last priority under every sort and hide artist/title matches available from another visible source. Fresh YouTube discoveries also defer to a saved YouTube recording. This is display-only song matching: exact provider recording IDs, saved metadata and ratings remain separate; unknown artists and meaningful live/remix qualifiers do not collapse. A provider label and 3px source border identify each row; Party Tyme uses yellow `#FACC15`. Selection, double-click/Enter and right-click use a common flow; source capabilities disable unsupported operations. Add to Queue leaves the singer optional, or selects/creates one, and commits a request without directly starting a new show. The context menu offers queue, playlist, rating, metadata, file/relink and blacklist actions where supported. Queue rows are selectable; Delete protects active playback. Transport/volume remain visible; extended explanation moves to concise help/tooltips.

**Party Tyme discovery:** If an authenticated consumer multiword search succeeds with no results, the app makes one bounded one-word retry and keeps only recordings matching every normalized search word across artist and title. Errors and cancellation are not retried as empty results. A tested account returned no Coldplay matches; this does not establish global catalog availability. Party Tyme result rows use yellow `#FACC15`.

**Available in 0.10.3:** Sources → Show in Search has separate switches for Imported / Local, Karaoke Nerds, YouTube, KaraFun, Party Tyme, Sunfly and Stingray. All default on, including for older settings files. Disabling a source suppresses its new host discovery and its saved recordings in the host and remote singer catalogs; stale guest requests for it are rejected. Existing queued, staged and playing songs, downloads and account sessions are preserved. A singer page can show a cached row until its next 15-second refresh; the authority rejects new requests for a disabled source immediately. Disabling YouTube does not disable Karaoke Nerds downloads. Older saved unbranded Karaoke Nerds records lack an origin marker and may appear as YouTube; newly added unbranded Karaoke Nerds tracks retain their origin. Existing YouTube identities are not silently reclassified when reused.

**Available:** Preferences is an icon-opened dialog with expandable Shared Karaoke Nerds Catalog, Song Ratings, Appearance, Song and Artist Blacklist, YouTube Search, Library Settings, Karaoke Services, Video Downloads & Karaoke Nerds Cache, Queue Management, Remote Queueing, Audio Controls, Singer Display, Keyboard Shortcuts, Local API and CLI, and Configuration Files sections. The video-download section selects a permanent base directory and optional yt-dlp executable. Approved queued YouTube recordings dispatch a serial permanent download to this folder; adding a metadata-only library entry does not start a download; automatic brand/artist batch preferences remain planned. Workspace layouts are Standard, Wider singer rotation and Wide song library. Preferences use validated `settings.json`; a link reveals it in the file manager and shows the full path in a tooltip. Missing known fields get defaults; unknown or invalid fields are rejected. A separate `keybindings.json` lists the registered application, playback, display, library, appearance, layout and queue actions. The wide Keyboard Shortcuts preferences section supports multiple bindings, keyboard capture, conflict detection, unassigned actions, immediate saved reset and a link to edit the JSON. Defaults include Ctrl/Cmd+F search, Spacebar Play/Pause, Ctrl/Cmd/Alt+Comma preferences, Ctrl/Cmd+Slash or F1 Keyboard Shortcuts, F/Shift+F player-only fullscreen, and queue-only Delete. Settings sections reopen on repeated navigation without discarding other draft values. Bare printable custom shortcuts do not steal text entry. The executable launcher flags `--settings` and `--keybindings` target the active instance or launch a stopped instance at that section. Preferences saves and volume/menu changes use validated partial patches merged against the latest serialized authority settings.

**Available in the 0.4.2 development build:** Karaoke Services controls `providerCatalogEnabled`, which defaults to true. `providerCatalogProfiles` stores `karafun`, `partytyme`, `sunfly` and `stingray` path entries with empty defaults, never credential values. KaraFun/Party Tyme public catalog search needs no account profile. The 0.4.3 development build also uses public Sunfly Store search when its developer-profile path is empty. Sources uses a native file picker for optional provider-issued Sunfly access or required Stingray access; website email/password files and KaraFun Business tokens are not developer catalog profiles. Credentials are read in the main process and are not entered into or returned to the renderer or singer clients. Sources labels public/developer modes. Use Public Store Search clears only the Sunfly profile selection, retaining its file; Remove Profile Selection does the same for Stingray. An invalid explicitly selected Sunfly profile is an error, never an automatic public fallback.

**Planned:** complete settings coverage, migrations and helpful error recovery; layout variants including a genuinely compact single-screen show; complete shortcut coverage for remaining specialized actions; and a global action/command interface. Appearance changes must not interrupt a show. Confirm skip and other show-interrupting actions; routine pause, volume and valid queue edits should not require repeated confirmation. Undo of eligible queue edits is a proposed feature, with any expiry and conflict behavior to be specified.

**Available in 0.7.0 source:** one persistent hidden singer renderer provides karaoke/bumper audio and silent JPEG preview, even before the singer window is shown. Closing it hides the same renderer. Capture uses stayHidden/stayAwake and background painting, never a second player. Preview may sit above/below Host Queue or be hidden. Sidebar/library, library/queue and preview/queue separators accept dragging, focused arrows/Shift steps and reset; saved dimensions survive viewport clamps. Combined results scroll while transport stays visible.

## 4. Library, import and metadata

**Available:** import local MP4 files or recursively scan a selected folder. Hashing runs in a worker; the host sees progress and paged per-file outcomes and can cancel without losing songs already committed. Results are kept in memory until the next import or app exit. Duplicate contents are detected using SHA-256; source files stay in place. Unreadable or changed files are reported. Actual large-library, network-drive, Dropbox and codec performance require testing. Changed-file errors now receive at most two new complete fingerprint checks after short cancellation-aware waits; other errors are not retried. The real 237-MP4 Dropbox folder first reproduced all-file changed errors, then imported successfully. Final packaged 0.3 imported and persisted all 237 files into a disposable library with zero failures and two non-MP4 files skipped. A separate test injected a changed error on every file before a successful full rehash. Original media and the real show database were unchanged; the exact underlying transient metadata cause is not proven.

**Available:** host search covers title, artist, filename basename, DJ code and track number, with sort and metadata/rating filters. Filenames are supplied only to the host, not guest clients. A missing or moved MP4 can be relinked to a byte-for-byte match to its imported original; a different recording must be imported as another song. The chosen replacement must be a regular file, not a symbolic link; a failed verification leaves the existing link unchanged. Before start the full stored fingerprint is checked; an unchanged ordinary resume uses a quick identity check, with a full recheck after an observed change or restart. Full hashing can delay start for large files, and a concurrent modification after checking is not guaranteed to be caught.

**Available:** configurable filename/folder templates are tried in order, with metadata ambiguity marked for review and a fallback format. Supported fields include `${Artist}`, `${Title}`, `${Track Name}`, `${DJ Code}` and `${Track Number}`. Examples include `${DJ Code} - ${Artist} - ${Title}`, `${Track Number}.${Artist} - ${Title}`, `${Artist}/${Track Name}.mp4` and `${Title} - ${Artist}`. Host artist/title corrections currently update the local library only.

**Planned:** source selection and precedence across embedded tags, filename/path patterns and manual overrides; safe preview, rescan and batch review; alias indexing; version grouping without losing the exact chosen recording; source confidence and provenance; folder watch and duplicate review; and optional regular-expression parsing if a validated design is chosen. Template priority and ambiguous matches must be clear; no silent guess may overwrite an existing host correction.

**Confirmed requirement, not implemented:** each metadata edit lets the host choose whether to also write supported embedded file tags. The default is local-only. Import, rescan and ordinary edits never silently change media or filenames. If an explicitly requested write is unsupported or fails, preserve the local edit and clearly report the file outcome. A safe implementation needs source-change checks, format support, backup/recovery, updating the whole-file fingerprint and tests for interruption, permissions and conflicting tags. See the metadata write-back design in the repository.

**Available through conversion:** Import CD+G / ZIP accepts a same-name MP3/CDG pair or a ZIP with exactly one pair. FFmpeg on PATH converts it to a managed H.264/AAC MP4 before library insertion; originals remain unchanged. The job has progress and cancellation, fixed-name extraction, expanded-size/CRC checks, path/symlink checks and explicit ambiguity errors. It is not native CDG playback: lyrics and the chosen background are composited at import. From 0.3.1, the default is the owner-selected `TPV-Karaoke-Backdrop-Video (Version 3).mp4`, bundled as a smaller, silent, full-duration 1080p playback copy. The animation loops behind the original CDG lyric colors; only the paired MP3 supplies audio. Preferences → Singer Display → Lyric Backdrop offers TPV Animated Backdrop (Version 3), Solid CDG Background, or a custom local MP4. The choice is captured for each new import; existing converted songs retain their picture and must be reimported to change it. Missing/unreadable selected backdrops stop import with a recovery message. Regular video songs retain their own picture. Converted videos use normal playback and require separate media backup. **Planned LRC support:** use this same backdrop selection by default when timed-lyric playback is implemented; LRC import, synchronization and rendering are not available yet. FFmpeg packaging, real-producer synchronization and other Player 2 formats still need evaluation. An extension alone does not prove a codec is playable; publish an evidenced codec matrix per supported platform.

**Available in 0.10.3 source:** Singer-room search asks the authenticated host authority to search its complete saved, policy- and source-filtered library before paging; it does not search entire external provider catalogs. Search remains active through refreshes, and outdated responses are ignored. Updated internet relay deployment is required. In the host workspace, singer actions and availability controls live in the singer context menu. Confirmed removal archives the singer and revokes their room access; existing history, playlists and points remain, while active or queued lead/duet participation blocks removal. Singer playlists are browsable in a visible list searchable by playlist or singer name, with an expandable creation form.

**Internet singer screen in 0.10.3 source:** While an internet session is active, the host can explicitly start a separate visual-only singer-screen share. A per-share secret is carried in the link fragment; the relay retains only its digest and checks the room generation. Stopping or expiring the stream blocks later frame reads, though previously received images cannot be recalled. Audio stays at the venue. The updated relay must be deployed and the flow verified on real browsers and networks before this feature can be considered available.

**Filename metadata review in 0.10.3 source:** In Preferences → Library Settings, the host can preview how saved filename templates would change existing song metadata, review before/after values, select none or all, and explicitly apply selected changes. Songs changed since preview are skipped, successes and failures are reported, and file tags are not modified. The app cannot reliably identify every older manual edit, so the host must review suggestions before applying them.

## 5. Requests, rotation and singer fairness

### Applause, show points and shared photos

**Experimental, implemented in the current source:** Hosts can enable applause in Audio Controls and singer points in Queue Management; both default to on. The host's applause button has no credit limit. Six owner-supplied applause recordings, approximately 4 to 11.2 seconds long, cycle in order and mix with playback; each plays for its full duration, and up to three can play at once. Singer participants begin with three applause credits and gain one after completing a song, up to five. Singers cannot applaud their own performance. A failed playback does not spend a credit. The host and authenticated room singers can trigger applause; output routing and sound levels still need physical-device rehearsal.

Points are show-scoped. For each performance, the first three applauses give each performer 10, 15 and 25 points, then 5 each; each different applauder after the first adds 5. If all eligible participating singers present at the start applaud at least once, each performer gets another 50 immediately; performers are excluded, the host is not required, and there must be at least one eligible listener. The four distinct applauders example awards 70 points before the optional all-participants bonus. A singer applauding another person's performance earns 8, then 4, then 2 points for their first three applauses of that performance. Applause outside active playback uses a credit but earns no performance points.

Queueing an assigned song earns 12 points, plus 6 if nobody else completed that song during this show and 18 if host history shows it has never been queued or sung; unknown history does not earn the 18-point bonus. A duet earns each assigned performer 14 more points. The host can mark a song as a duet in metadata. A singer's accepted missing-song suggestion earns 10 points, and a photo accepted for display earns 24. No points are awarded when points are disabled. Assigned singers, track identity and stored history determine the applicable bonuses; an unassigned request does not have a singer to score until assigned.

The mobile Full Host does not yet have a verified complete cross-show song history. It conservatively withholds the 18-point all-time novelty bonus when that history is unknown; this is separate from the 6-point current-show bonus.

Authenticated room singers can select a JPEG or PNG and send it to the singer display. The browser reduces it to a bounded JPEG, and the screen displays one transient photo at a time for about ten seconds. The host does not have to approve each image. The photo itself is not retained in the show database; the score is recorded only after display acknowledgement. An occupied or unavailable display rejects the submission. LAN, relay, mobile-host presentation, audio routing and real-device behavior remain subject to end-to-end and deployment verification.

Mobile Full Host rejects photo submissions while its host page is hidden or fullscreen; the host must return to the visible, non-fullscreen host screen before another attempt.

**Available:** a host can leave the singer empty, add or select a singer, submit a song and remove eligible requests. Host/staff queue commands may use null; only host may assign or clear an eligible request. Null requests create no Singer and do not acquire remote ownership. New requests are automatically approved by default; switching to host moderation affects new requests and does not silently approve existing pending ones. In Requests the host can accept or reject pending requests and view recent terminal request history. The separate missing-song form saves singer, title and optional artist to a local review table; the host may mark it Pending, Reviewing, Fulfilled or Declined. Saving a missing-song request does not add a recording or create a rotation turn.

**Available:** FIFO and fair singer rotation use the same durable queue. Approved eligible requests automatically stage, including preparing the next turn while another performance plays; pending moderation waits for Accept. A staged request stays locked through reorder, promotion, policy or mode changes. Its host edit may replace the track, assign/change the singer or clear the assignment while preserving the same request ID and staged status. Accepted future requests may be manually reordered/promoted, with automatic-order reset. Future limits default to three per singer (0 unlimited, 1–50 configurable); pending/accepted/staged count and playback does not. Lowered limits preserve existing requests. Unassigned requests bypass named-singer limits and absence rules; each receives an independent FIFO fair-round slot rather than sharing a null-singer bucket. Duplicate identities are not proof of unique people.

Authenticated local singers may withdraw their own pending or accepted request. Staged and playing requests remain locked to the singer; a guest cannot manipulate another singer's requests, the room-wide queue, transport or outputs. Completed, skipped, removed, rejected and withdrawn request records remain in show state; the host view and guest snapshot show a bounded recent subset. Completed and skipped performance history is saved for generations recorded since the history feature was added; it is not backfilled.

**Required queue invariants:** completion or confirmed Skip consumes exactly one turn; pause, failed preparation and stale callbacks consume none. New singers join the remaining current-round tail while a turn remains, otherwise the next round. A staged request is never silently displaced; policy-blocked stages remain for explicit recovery. Preparing alone never starts a new show, although an already armed running show can advance when its gap/media become ready. Start verification rechecks the selected recording and account. Switching modes preserves requests; Stop/Pause intent invalidates delayed playback.

**Available:** the host may drag or move accepted waiting requests, reset to automatic order, and right-click to change a waiting track or singer. Staged slots remain locked during reassignment/clearing; active performances cannot be edited. Manual order persists and new arrivals follow the explicit list; reassignment respects request limits and assigns the recipient’s next free round while retaining a manual slot. Duets and an actor/reason audit trail remain planned.

**Available:** hosts and authenticated local singers may mark a singer unavailable for 1–60 whole minutes or return immediately. While absent, at most one future request is allowed; existing extras stay but block additions. Available singers are scheduled first, absent singers by return time; expiry restores eligibility in the existing FIFO/fair order subject to manual order and staged lock; it does not arm a new show. Deadlines persist. A guest cannot release staged/playing requests; the host must explicitly confirm a staged release. The host may mark the active singer away for future scheduling without interrupting their current performance. Distinct indefinite hold/skip-turn policies and duplicate same-singer/version handling remain planned.

**Planned:** indefinite holds and skip-turn rules; actor/reason audit history and touch coverage; own-song ordering without advancing one's turn; per-request key/tempo and private notes; duplicate same-singer/version handling; duet/group invitations and accepted membership; and approximate queue and wait-time projections. A group performance belongs to one lead singer and consumes one turn; invitees do not lose their own place. Wait estimates must state assumptions, use ranges where appropriate, recalculate after changes and show unavailable during unbounded pauses or intermission. Pre-arrival lists do not reserve a turn.

## 6. Playback, audio and singer display

**Available:** approved requests stage automatically. Play/Pause begins the show or pauses/resumes an active performance. Automatic advancement defaults on after natural completion/confirmed Skip and waits for the saved gap and ready media. Stop returns the active request to the queue, cancels delayed advancement and stops interlude music even without active karaoke. Pause retains the active turn and cancels advancement. Failed/missing media stays staged for Retry/Relink. Generation identity/checkpoints survive restart paused; startup never resumes karaoke. Output/device/display errors cancel automation and ask for deliberate recovery; physical behavior remains unverified.

**Available:** global volume and explicit/system-default output are supported. First Play reveals the persistent singer window on its saved connected monitor, otherwise the nearest non-host monitor, otherwise the host screen. The host can show/fullscreen it explicitly; Close hides it while preview/audio continue. Singer Display settings include upcoming names, a booth name, PNG/JPEG logo with immediate picker preview and 10–85vw size, plus scrolling top/bottom text with optional ISO expiry. Banner display resets at launch unless persistence is selected; saved text remains. The inter-song gap is 0–300 seconds, default zero; completion/Skip commits its deadline. An already running automatic show advances after that deadline and media readiness; restart remains paused.

The singer video is bounded to the full window viewport (maximum 100vh/100vw) with aspect ratio preserved and no vertical scrolling. Landscape, 4:3 and portrait sources use letterboxing/pillarboxing as needed. Branding, caption and next-singer information overlay the viewport instead of adding height. The separate embedded preview uses its own bounded layout and retains visible native controls.

**Experimental in 0.7.0:** launch bumper and between-song bumper default on with separate preferences. The system default output is accepted and the hidden singer renderer needs no visible window. Three original themes and up to five custom audio files are available. Fade-in defaults to 1000 ms, configurable 500–1700 ms, follows global volume and cancels before stop/output loss. Between-song music requires the old generation silence acknowledgement; karaoke start/resume waits for bumper-stop acknowledgement. A positive gap plays music until the next turn is ready; zero avoids filler flash. Stop/Pause/error/output-loss cancel delayed karaoke; settings/recovery alone never starts it. Retired player callbacks cannot affect a new generation. Physical audible routing remains an acceptance gate.

**Available:** the bottom timeline shows elapsed/remaining time, supports dragging or keyboard scrubbing and ten-second rewind/forward. Seeking preserves play/pause state and saves acknowledged positions; stale-generation events are rejected. It supports local MP4s, converted CDG, downloaded YouTube videos and the native KaraFun audio clock. Previous restarts the current generation from zero and resumes a paused performance without consuming a turn. Per-range verified file handles reject observed source replacement and pause the same performance with a recovery path. Real-hardware synchronization and recovery remain unverified.

**Planned:** physical recovery verification, key/tempo with per-song/per-singer defaults, mixing for other compatible sources, separate filler volume, fade-out/richer intermission scheduling and richer output presets. Existing fade-in is implemented; older proposed 1.5-second in/1.0-second out values are historical candidates, not current defaults. Never overlap audible karaoke streams or start filler merely because a performance is paused. Source MP4/CDG text is not restyled by native KaraFun colors.

**LRC foundation only:** timed-lyric parsing and VTT conversion are integrated. Full LRC import/playback, shared backdrop rendering and its timing/seek/resume verification remain unfinished. Do not present the parser as a playable source.

## 7. Access, identities and privacy

**Available:** the host process validates sender and command boundaries. The current domain has limited host, staff, singer and engine roles; these are foundations, not the complete product access-control system. Local guest sessions identify the singer server-side. Guest catalog and request projections exclude other singers' credentials, private paths and host-only data.

**Planned:** assignable Host, Co-host, Moderator, Singer and Audience Member levels, enforced by the service rather than merely hiding controls. Define capabilities and delegation for moderation, queue edits, transport, settings, private notes, outputs, provider accounts, billing and audit history. Public join links never grant staff or host authority. A host or billing owner can revoke credentials independently.

**Planned:** shared user profiles with name, account email, favorites, playlists, notes and access level. A user can update their own name, email, favorites and playlists; only authorized staff can edit access level or host notes. Define ownership, sign-in, recovery, retention, export and deletion before exposing profiles remotely. Temporary guests need no mandatory account; optional profiles may carry choices across devices only with informed consent. A display name is not authentication. Never expose private staff notes, media paths, provider secrets, account/billing data or tokens through guest views or routine logs.

## 8. Local and internet singer access

**Experimental mobile in 0.9.0:** an installable web app at `https://queue.thepropervolume.com/app/` has two explicit modes. Full Host searches the cached Karaoke Nerds snapshot, streams its YouTube recordings, imports local videos, accepts direct YouTube links, manages optional singer assignments/manual queue order, favorites/history, volume, timeline, restart/skip and a configurable automatic inter-song gap. It can publish a temporary room whose guests request its published songs. Piggyback joins a desktop or phone host using the existing strict SingerClient admission, session ownership, revision and uncertain-command recovery. No quizzes are included. Mobile paid-provider sign-in, key/tempo, vocal stems and dedicated casting remain planned.

Android/iOS wrappers use native DNS-SD to find public room beacons and ask whether to join. Browsers use short-lived same-egress suggestions; shared public internet access is explicitly described as a hint, not proof of a shared LAN. Manual HTTPS room names/links remain available. A host may disable discovery, and discovery never authenticates or joins automatically. Desktop UDP advertising uses verified private interfaces, bounded announcements and trust rechecks; failure preserves manual joining and never changes firewall policy.

Mobile shows, files, favorites, history and unavailable-song requests use local IndexedDB. A writer lock prevents concurrent host tabs; data is loaded after lock acquisition. Restored playback is paused. Unknown/corrupt shows are preserved under a recovery key before replacement. Guest mutations are persisted before success replies. Room capabilities and receipts live in memory, are scoped to a generation and reset on closure. Mobile owner capabilities are independent of configured desktop owners, expire within 12 hours, and have separately bounded reservation capacity in the existing MySQL relay. No new shared SQLite database is introduced. Interrupted opens reuse their owner/open IDs; terminal and expired replies have explicit recovery. Foreground operation, network permissions, streaming on real phones, store signing and long-show reliability require separate acceptance. See `docs/mobile-app.md`, `docs/mobile-research.md` and `docs/qa/mobile-090-summary.md`.

**Experimental local browser:** a host explicitly opens a local room from Preferences, selects a private IPv4 interface, hostname, certificate and private key, and creates a time-limited shareable invitation. The hostname must resolve to the chosen host interface and the certificate must be trusted by Node and the singer's device. A singer joins by name, browses policy-filtered loaded pages, submits or withdraws eligible requests, sees their own statuses and can ask for a missing song. Search currently covers loaded catalog pages; the guest can load more. A link grants admission to anyone who has it until expiry or revocation. Closing the room revokes access; revoking invitations alone does not revoke already admitted guests. Access credentials live in page memory; closing or reloading the page requires a fresh invitation. This is not yet verified on physical venue phones and networks.

**Required for both modes:** no unauthenticated public host controls, no source paths or media URLs in guest responses, same-origin and Host validation, bounded requests and responses, role checks, expiration, revocation and rate limits. Guest actor and singer ownership come from the authenticated session. Guest commands carry caller-generated IDs, show identity, host epoch and expected revision. Persist mutations and receipts together. A retry with the same ID and payload returns the original result; changed content is rejected. On an uncertain outcome, query the receipt rather than automatically resending a stale action. Show disconnected/pending/unknown states and refresh authoritative snapshots on reconnect.

**Experimental internet sessions:** the host opens Remote Sessions, keeps or edits a suggested custom URL slug, presses Start Session and copies the public singer link at `https://queue.thepropervolume.com/<slug>`. Guests on Wi-Fi or mobile internet open the link, enter a name and use the host library. Anyone with the active link can join; this is temporary public admission, not a verified account identity. Scoped host credentials stay in a separate private file and never appear in the link or renderer. Outbound authenticated long-polling relays only allowlisted singer operations to the desktop authority; no arbitrary URL proxy or inbound desktop listener is exposed. A temporary network interruption retains the same room and guest receipt scope. Explicit End, replacement, expiry, denial or a host-process restart fences the old generation. The singer can check an uncertain outcome and explicitly retry its original ID/payload; it is never silently replayed. End/revoke and internet failure preserve the local show and separately scoped LAN access. Production relay leases use a dedicated MySQL schema; SQLite is only an isolated relay test adapter. Live packaged Windows-to-browser HTTPS verification passed for custom URLs, join/request/withdraw/availability/missing-song operations, generation fencing and shutdown. A deliberately lost request reply recovered its original receipt without a duplicate; true awaited state checks observed reconnection after a brief poll failure, preserving the same guest access. Physical phones, venue networking, load and prolonged outages remain separate verification work. The legacy Quick Tunnel prototype remains disconnected scaffolding.

**Planned phone and companion features:** optional profiles and singer history/favorites, per-version key/tempo memory, pre-arrival lists and check-in, approximate wait estimates, opted-in up-next notifications with an in-app fallback, and accepted/declined duet or group invitations. Alerts derive from acknowledged show state, deduplicate and become stale when a turn changes; a notification never advances the rotation or proves attendance. Staff/KJ pairing and authorization are separate from singer admission.

A planned saved list outside a show is personal preparation, not a reserved turn. If a host opens requests early, show received, approved, checked-in and eligible as distinct states; revalidate the exact version, policy, access and key support when submitting. Approval and check-in rules remain host-configurable product decisions. A proposed heartbeat every two seconds and disabled controls after five seconds without a host update require actual network measurement before adoption. On reconnection a fresh snapshot precedes new actions; the relay must not queue stale actions for surprising later execution.

**Available, updated in 0.7.0 — LAN visual screens:** a separate opt-in read-only listener defaults to port 4051 and binds concrete trusted private interfaces plus loopback. Windows requires actual Private classification; Public/unknown stays loopback-only. A 30-second trust recheck and 5-second classification bound remove untrusted listeners without changing firewall policy. Remote Sessions shows its private-network numeric addresses; Singer Display preferences configure enabled state and port. Up to 64 browser streams mirror the authoritative singer window using bounded multipart JPEG frames; sound remains on the host. It is a viewing surface, not queue admission, a host API or an internet relay. Request links remain separate. Anyone able to reach the private LAN listener can view the screen while enabled.

Capture polling is approximately 125 ms, deduplicates static frames and never overlaps capture work. Generation fences reject late old-window images; no demand, failures and display invalidation clear stale pixels. Slow-viewer data is bounded and reconnects; the page fits its viewport. Host/origin/method validation, private-peer checks, connection limits, port-conflict recovery and serialized shutdown/reconfiguration are covered by source tests. Numeric addresses are the fallback when `.local` names do not resolve; the app installs no mDNS service or firewall rule. Windows may need a Private-network allowance. Physical multi-device/venue-network latency and endurance remain unverified.

## 9. Recovery, backups and data

**Available:** the application stores show state and metadata in SQLite schema 5, commits durable changes before acknowledgement, uses schema migrations and checkpoints the active playback position. A restarted interrupted show is paused rather than autoplayed, under a fresh host epoch. A single-instance lock and one forced-termination recovery path have been rehearsed. Playback position may lag the latest audible position; it is not proof that a turn completed.

Version 0.7.1 upgrades schema 4 transactionally, making `performance_history.singer_id` nullable while retaining existing rows and assigned show state. Back up before upgrading; older applications reject schema 5, and downgrade requires the pre-upgrade backup.

The host can create a validated SQLite snapshot to a new filename. Existing destination files and SQLite sidecars are not overwritten; the destination must support hard links. If cleanup fails, the host is told whether publication occurred and can retry cleanup. Backup contains private singer data and library paths; choose a private destination. Video files, bumper audio, settings, shortcuts and logos are not included and need separate backup.

**Planned:** an integrated, recoverable restore flow, backup before schema upgrades, archive/reopen and full show lifecycle controls. A restore prototype creates a separate file and retains the previous database but is not connected to startup or exposed to hosts. It must be validated for offline cutover, interrupted commits, WAL/sidecar handling, instance locking, identity binding and rollback before use. Do not copy only a live SQLite file and assume its WAL contents are included.

Required failure handling covers missing/corrupt files, unsupported codecs, output and screen loss, media stalls, disk-full and database errors, stale staff edits, provider outages and relay disconnects. A failed persistence operation cannot be acknowledged as successful. Preserve the active singer's turn when preparation fails; do not silently substitute a different recording, reroute sound or resume playback.

## 10. Collections, history and policies

**Available:** host-managed Singer Playlists, KJ Picks, Artists and History views. Unassigned completed performances retain a null singer identity rather than an invented singer. Hosts can search recorded performance history by singer, artist or title, filter it by singer, and export the matching records to a new CSV file. CSV cells that could be interpreted as spreadsheet formulas are prefixed with an apostrophe. Export requires a destination filesystem that supports hard links; choose a private destination because its permissions are inherited on Windows. Genres is a placeholder until genre metadata exists. These are local show/library features, not cross-device singer accounts. **Planned:** favorites, playlist import/export, per-singer ownership and sharing, and retention/deletion controls.

**Policy foundation exists:** versions can be included or excluded, and age-restricted eligibility hides unrated, uncertain and conflicting material. Guest catalog and request boundaries use the same eligibility decision. **Planned:** an accessible host policy interface, show/party allowlists and exclusions by song/version/source/playlist, preview of affected future turns, owner-only blocked-item maintenance, evidence provenance and audit. Exclusions win; all discovery, direct-ID, favorites, request, stage, playback and API paths must enforce policy. A policy change must not silently stop active audio.

Content evidence belongs to the exact recording and version; title/artist similarity or an absent explicit flag is not proof of a clean edit. Any future lyric or advisory analysis must use permitted sources, retain source, confidence, coverage and expiry, distinguish advisory from automated assessment and host decision, and preserve unknown/conflicting results as unrated. Category severity must not be averaged in a way that hides a severe category. No lyric scraping or protected-content export is specified; evidence availability and licensing are open decisions.

Planned age policies may set separate profanity, sexual-content, violence and substance thresholds, including stricter singer age bands; the party's rule wins because all guests hear the performance. Collect only needed age bands and treat self-declared age as unverified. Version-specific rules should record actor, reason, scope and timestamp; permissions to change policy never imply permission to bypass a provider license. MP4, CDG and protected streams may not expose readable lyrics. Version-specific licensed evidence should be used where available; evaluate language, context, coverage, expiry, clean edits and ambiguity without presenting an automated score as a universal minimum age. Lyric analysis cannot certify video, backing audio or live improvisation.

**Available in 0.5.0 source — global host blacklist:** `artistBlacklist` and `songBlacklist` live in host settings across shows. Artist rules match complete artist identities; song rules match complete artist/title identities across all recordings/providers. Case, whitespace and typographic equivalents normalize, while meaningful punctuation/accents are preserved. No substring/wildcard match is implied; an empty rule artist matches unknown artists only. Preferences supports draft add/remove/save/cancel, and a library context menu adds a song or artist directly. Discovery, remote requests and playback recheck current settings. Existing queue items remain visible for explicit recovery, and persistent exclusions never contaminate per-show version/clean-content policy.

## 11. Architecture, API and CLI

**Current architecture:** Electron with context-isolated sandboxed renderers and narrow named preload bridges; TypeScript domain and main process; React interfaces; SQLite persistence; a separate presentation window; and a replaceable experimental browser media element. Trusted file operations, network authority, tokens and playback decisions stay in the main process. Renderer inputs and senders are validated. The media engine owns its clock; show state advances on acknowledged generation-specific events. A background importer does not own the database.

Logical entities include Song, exact SongVersion and LocalAsset; Show/Party, Singer, ShowSinger, Request and QueueItem; Playback generation, position and outcome; command result/receipt and show event; preferences and approved provider references. Future entities include profiles, per-version preferences, attendance, invitations, notification preferences, group performances, provider entitlements and billing/device grants. Do not infer a persistent profile from a guest session or a catalog entitlement from a favorite.

**Planned general API and CLI:** every supported application action should be available through one authenticated local authority and a documented command-line client, not a second SQLite writer. Offer capability discovery, effective preferences, shows/parties, users and own libraries, catalog/import, playback, outputs, providers, policy, commands and events as permissions permit. Default the general API off; use authenticated loopback with scoped, revocable tokens. LAN binding requires explicit opt-in and authenticated TLS. Publish versioned OpenAPI/event schemas, pagination, stable IDs, structured errors and CLI help/exit codes. Protect file paths, billing data and secrets. The initial source subset is implemented independently of the cloud relay: an off-by-default authenticated loopback API reads capabilities, state, settings and shortcuts, and queues Preferences/Keyboard Shortcuts navigation. The actual Windows app and compiled CLI passed a private-profile integration rehearsal for default-disabled startup, enabling, authenticated reads, settings/shortcut navigation, restart token rotation, stale-token denial and disable/quit cleanup without autoplay. The initial contract is documented in `docs/local-control-api.md` and `docs/local-control-openapi.yaml`. Full mutation control, events, pagination and role-scoped operations remain planned; Windows and Linux bundled-wrapper/package verification passed.

**CLI install in 0.10.3:** Preferences → Local API and CLI offers **Install CLI to PATH** for supported packaged installations. It verifies the bundled CLI before changing the current user's configuration. Windows adds the installed app folder to the current-user PATH without administrator access. Linux and macOS install a managed `~/.local/bin/tpv-karaoke` launcher and managed idempotent PATH blocks in Bash or Zsh startup files. Other shells and Zsh with a custom `ZDOTDIR` receive manual PATH guidance; automatic AppImage installation is not supported. Open a new terminal, or on Windows sign out and back in if necessary. Enabling the Local API remains a separate opt-in for control commands; `--help` does not require it. Existing unrelated startup content is retained and the UI gives removal instructions. Physical install and cross-platform shell tests remain separate acceptance work.

The 0.4.2 host-only catalog IPC provides `getProviderCatalogStatus`, `searchProviderCatalog`, `chooseProviderCatalogProfile`, `clearProviderCatalogProfile` and `openProviderCatalogSong`. These project metadata/configuration state and approved official links, never playback rights or media tokens. Provider discovery is not yet exposed through the local HTTP API or CLI; those catalog/provider resource families remain planned.

For every mutation, validate role, show/epoch, expected revision, item state and active policy. Persist the original result with the command ID before replying; reject reused IDs with different content. Stale clients refresh a filtered snapshot; an unknown result is queried rather than replayed blindly. Generation identifiers protect playback from late events. Nonstructural high-frequency controls need sequencing so old slider updates cannot overwrite newer state.

Beyond the initial `/v1/capabilities`, `/v1/state`, `/v1/settings`, `/v1/shortcuts` and navigation-only `/v1/actions` source routes, the proposed resource families include `/v1/preferences`, `/v1/parties`, `/v1/users`, `/v1/users/{id}/library`, `/v1/catalog`, `/v1/playback`, `/v1/outputs`, `/v1/providers`, `/v1/policies`, `/v1/commands` and `/v1/events`. Those broader resource families and their compatibility guarantees remain design proposals, not implemented mutation endpoints. Capability discovery should report supported versions, commands, bounds, role scopes and required local confirmations. Provider credentials and local paths require appropriately restricted owner scopes. Authenticated event subscriptions must be revoked with their token and resume from a fresh authorized state.

## 12. Providers and commercial access

**Experimental shared metadata catalog:** Karaoke Nerds permits its community feed to be called approximately once per day and cached. The recovered initial JSON snapshot contains 64,261 records and now seeds a dedicated MySQL 8 catalog on Linode III. All 64,261 valid, unambiguous YouTube identities are searchable, including brands without a verified page slug. Preserve upstream brand codes; never invent a slug or producer code. The original SQLite catalog, mappings and last-attempt/success history have not been recovered. Those timestamps and retirement state remain unknown. The read-only HTTPS service has passed server-side authentication, pagination, backup and separate-schema restoration checks; live Windows HTTPS status and a cross-field artist/title search passed, and a new client instance recovered the saved search with network access disabled. No feed call was made during this recovery.

**Experimental unified host discovery:** Fresh installs use bounded anonymous read-only `/v1/catalog/public/status` and `/tracks` endpoints on the shared service without shipping any credential. Optional private profiles retain separate authorities/caches; invalid selected files are not silently bypassed.  ordinary Song Library search keeps local matches immediately and adds debounced Karaoke Nerds results by artist/title. Exact YouTube IDs merge with existing host-edited library entries; different recordings remain distinct. A catalog failure does not erase local matches, and saved offline matches show their age. Service badges show YouTube in place of a local DJ/brand code. Double-click, Enter or Add to Queue opens singer selection; an unknown recording and its request are saved through the single host authority, and approved accepted/staged requests dispatch a serial yt-dlp download immediately. Pending manual moderation waits for approval. Downloading does not start playback, discard a turn or replace a selected version. Progress, waiting-job cancellation and explicit failed-job retries are available. A metadata-only manual link addition remains optional. The separate manually started internet preview remains outside the queue and selected output, and must not overlap karaoke or bumper audio. Native KaraFun uses the separate account/player path below.

**Central catalog deployment and desktop connection:** use the isolated MySQL 8 schema on Linode III behind the authenticated HTTPS service at `apps.thepropervolume.com`. MySQL and the reader bind to loopback; dedicated reader, writer, migration and backup accounts are separate from website accounts. Daily private backups and an actual scratch-schema restore are verified. Fresh desktop installations use the public read-only catalog without a reader file. A provisioned or explicitly selected private JSON profile uses its scoped reader token instead; database and provider credentials never reach renderers or singers. Choosing or checking a draft configuration does not change saved searches. Up to 100 validated query/status cache entries, bounded to 20 MiB, support previously saved searches after restart during transient outages. Authentication denial invalidates that scope; malformed replies never fall back to stale data. Display offline/stale status and failed cache persistence. Local-only use remains available. The host show database stays local SQLite. Automatic upstream refresh is disabled, with no provider credential or activation gate installed. Retire every legacy refresher and verify/import real attempt history before one central updater can enforce the durable minimum 24-hour interval. A read-only seed does not establish refresh authority.

The community feed supplies metadata and YouTube watch links, not directly downloadable video files. Its brand value is an internal lookup and join key; cache paths use the corresponding verified brand-page slug. Its `Created` value must not be assumed to be a video's publication date. Individual YouTube downloads are connected to the host catalog and library through yt-dlp, with progress, cancellation and persistent media attachment to the same version. Complete H.264/AAC MP4s are verified and published without overwrite; exact-ID ownership sidecars enable hash-checked reuse. Cancellation waits for child-process termination before safe cleanup, retaining uncertain staging. Batch selection, publication-date verification and production deployment remain separate work. A metadata API key does not itself establish rights to download or cache the linked media.

**Planned video-cache behavior:** the host chooses a base directory and specific brands or artists, with automatic caching opt-in. For an artist, select the most recently published eligible video for each artist and track. Use a verified publication date when available and an exact-video match from yt-dlp's upload date as the best available approximation when it is not; preserve which source was used and do not label an upload date as a confirmed publication date. A ranking that compares any upload-date fallback is approximate, even if the selected video's own date is verified. Do not substitute Karaoke Nerds `Created` or a yt-dlp release date for either. The batch-planning prototype requires complete artist coverage and reports incomplete or ambiguous cases, including competing versions without either usable date. The target layout is `$BASE_CACHED_VIDEOS_DIR/$PROVIDER/Brands/$BRAND_SLUG/$ARTIST/$ARTIST - $TRACK_NAME.$FILE_EXTENSION`, for example `/chosen/path/karaokenerds/Brands/TheProperVolume/Nada Surf/Nada Surf - Amateur.mp4`. Reject unresolved brand matches and ambiguous or colliding destinations, prevent traversal and symlink escapes, and never silently overwrite an existing file. Automatic brand/artist batch downloads remain unimplemented; explicitly selected videos now download and attach to the existing library entry.

**Experimental service catalog discovery in the 0.4.2 development build:** host Song Library and Sources search KaraFun and Party Tyme public metadata independently from local and Karaoke Nerds results. The inspected official KaraFun CSV parsed 90,284 records and the Party Tyme public table parsed 44,967 rows on 13 November 2026. These are observed export counts, not an upstream-freshness or territory/playability guarantee. Provider-specific IDs remain distinct even when artist/title strings match. Results show the service name in place of local DJ/brand codes and are explicitly search-only; they cannot become local versions, enter the queue, start playback or be requested by remote singers. Public metadata search requires no consumer login or paid API plan and does not borrow private web-player client keys or signatures.

Public catalogs load on demand, coalesce concurrent loads and retain a complete snapshot for up to 24 hours in app-process memory. An older complete public snapshot can be searched with a clear warning when refresh fails; bounded failure backoff avoids a fetch on every keystroke. There is no persistent disk or global/shared MySQL cache for these provider catalogs yet. Restart loses the snapshot; a cold offline session cannot reuse it. Each public provider returns at most 50 matches. Source text, sizes, identities and response shapes are bounded and validated; failure of one provider does not erase local/Karaoke Nerds results.

Protected Sunfly and Stingray metadata adapters have fixture coverage but no live developer access is confirmed. Stingray requires a provider-issued strict JSON profile containing only `apiKey`, `deviceId`, `languageCode` and `countryCode`; Sunfly requires a private raw developer access-key file. The separately documented Stingray OAuth inspector and ordinary website subscriptions are not interchangeable credentials. Sunfly must complete a bounded full catalog scan, including withdrawal handling, before publishing any results; no partial scan is searchable. Its complete snapshot lives in process for up to 24 hours and returns at most 20 matches; Stingray also projects at most 20. No media, license or playback request is made by these adapters.

**Experimental public Sunfly Store mode in the 0.4.3 development build:** with no selected Sunfly developer profile, title/SF-SKU queries use the public store without credentials or paid-client keys. The bounded first page contains at most five eligible individual-song products; this is not a full store-catalog sync, and artist search is not verified. Store identities are `store:productID`, with optional `providerSku` retaining the exact SF SKU from the source. These are not protected streaming identities or playback entitlements. Artist/duration/language enrichment requires cross-matched public Product/MusicRecording JSON-LD; missing artists stay unknown, with no URL-slug guesses.

Store query results remain in main-process memory for five minutes and product detail for 24 hours, with no persistent/global cache. An explicitly selected developer profile continues to use the protected full-catalog adapter; missing, invalid or denied credentials fail explicitly without public fallback. The host can clear only the profile pointer to choose public Store mode, preserving the credential file. Stingray can similarly remove its selection while retaining its file, but has no public fallback. Search-only metadata, policy enforcement and CLI path redaction remain unchanged; Store results cannot enter the playable queue.

Service matches appear under All Songs rather than local metadata-review/content filters. Main-process policy enforcement blocks provider discovery for age-restricted shows or any version allowlist because these recordings are not approved show versions. Renderer query/profile/policy generations suppress obsolete responses, while host-only external links resolve the latest provider/ID against an HTTPS allowlist. A provider advisory such as KaraFun's explicit flag is metadata, not proof of complete content coverage or a playback grant. See [provider catalog setup and limitations](provider-catalog-search.md).

**High-priority planned paid playback:** integrate through approved APIs or SDKs with confirmed commercial, geographic, operating-system, playback, cache and reporting rights. A priority is letting hosts link an existing KaraFun account and use its eligible subscription in the app where the provider permits it. KaraFun advertises native login and user-linked subscriptions through its [OEM partnership API](https://business.karafun.com/oem), but the partnership, applicable plans and rights, operating systems, availability and pricing for this project remain unconfirmed. Prioritize Stingray and Sunfly and investigate additional compatible services the host can use for under $20 per month each; this limit applies per service, not to their combined cost. Confirm actual total pricing, developer access, eligible subscriptions and hosting rights before representing a service as within budget. Paid playback research also includes Party Tyme and Karaoke Cloud Pro; public metadata discovery does not promise playback access, pricing, entitlement or endorsement. Adapters must describe exact version, availability, entitlement and capabilities such as seek, key/tempo, offline playback, stems, lyric mode, output restrictions and supported platforms. Never silently replace a chosen recording or bypass protected playback. An unavailable provider must not disable local songs or destroy queue state.

Hosts or venues pay for the application in a future commercial release; singers participate free. App access and provider subscriptions are separate entitlements unless an agreement explicitly bundles them. Plans, prices, tax, refunds, trials, billing cadence, device limits, concurrent shows, grant duration and provider terms remain undecided. A proposed paid release uses server-verified subscription status, signed device-bound offline grants, billing-event idempotency and a bounded grant for a show already started; an outage with a valid grant should not stop local hosting, and billing expiry should not unexpectedly cut live audio. Preserve viewing, export and recovery when an entitlement expires. Account, billing, checkout, licensing and paid access are not implemented.

Proposed account screens distinguish active, verification pending, payment issue, cancellation scheduled and expired; show the full recurring price, billing period, limits and catalog exclusions before checkout. Checkout return alone must not activate access. An authenticated billing owner manages invoices, payment method, cancellation, reactivation and device release; operational staff and singers cannot view or change billing. Billing events require verification, deduplication and ordering protection. A billing outage is not proof of failed payment; an unexpired local grant permits its approved scope, while an expired grant preserves local media, viewing, backup and export. Clock changes, grace periods and offline/show duration limits must be defined before release.

Provider due diligence must establish documented authentication, commercial and geographic coverage, allowed caching and offline terms, approved presentation, usage reporting, platform-specific SDK behavior, account linkage and data handling before a provider appears as supported. Each integration is independently approved and tested. Licensing and data rights for optional lyric evidence are separate from permission to play a recording. Possible research leads include [KaraFun OEM](https://business.karafun.com/oem), [Party Tyme player integrations](https://www.partytymeplayer.com/partytyme/site/?page_id=2345), [Sunfly API](https://api.sunflykaraoke.com/) and [Stingray integration guidance](https://karaoke-api-doc.stingray.com/docs/introduction/design-guidelines/); these links are leads, not claims of current access.

**Available in 0.5.0 source — YouTube karaoke search:** bounded shell-free `yt-dlp` metadata search appends karaoke. Candidates must identify karaoke and a suitable channel; approved-only mode and stable channel-ID/handle blocklists support host curation. Live, private/restricted and videos outside 45–1800 seconds are omitted. Channel/video hints and artist/title suggestions are heuristics rather than verified quality or musical metadata. Google Takeout CSV/JSON subscriptions can seed approvals; the private subscription feed and browser cookies are not accessed. A live metadata-only probe examined 20 videos and returned 10 candidates (four non-karaoke and six unsuitable-channel results filtered), with no media downloaded during that probe.

Add to Queue uses the usual optional-singer dialog; the host may leave it empty, select a singer or enter a new name. Submission validates an opaque current-search receipt at the authority before saving canonical metadata, recording and request. An approved request schedules the existing permanent download path and never starts playback automatically; manual moderation waits for approval. Search changes, channel rules and global blacklists can invalidate an old receipt. Metadata-only candidate IDs must never be persisted as playable versions.

**Provider correspondence, 14 November:** authorized Gmail follow-ups were successfully sent from **ben@thepropervolume.com** to KaraFun, Stingray (a reply to Luke), Sunfly and Party Tyme. The only substantive earlier reply found in the connected TPV mailbox was Stingray's 12 November direction to commercial partnerships. No new partner keys, approved pricing or API playback access are confirmed. KaraFun's Business management token previously returned HTTP 402/403; the content/OEM route is separate. Sunfly advertises Protected API v2, an on-request Node/Electron SDK and a 30-day API/content trial, with quoted commercial terms. Party Tyme advertises a player-vendor API; its public $49.99 monthly Pro offer exceeds the owner's under-$20/month per-additional-service target. Consumer subscription prices do not establish API access or integration rights. See [current source status](source-status.md) for primary links and pending actions.

**Optional external KHost route:** the owner reports KaraFun subscription login/playback works in their separate KHost installation. TPV's independently written public-contract bridge implements external search/handoff; account sign-in, acquisition and playback stay in KHost. Host setup explicitly selects the bridge's protected connection profile, searches through the installed provider and offers **Send to KHost (External Queue)**. Search receipts, current policy/blacklists and the selected profile are checked before dispatch; uncertain outcomes retain the original handoff ID for read-only recovery. These results never become playable TPV queue entries. Actual plugin loading and authenticated search/handoff on the owner's target machine remain unverified. KHost core uses Shield and the separate KaraFun plugin has no explicit license grant in the reviewed repository. Their implementation was not copied; the separately MIT-licensed contracts are the adapter boundary. No consumer-client identity/signing scheme, password-equivalent storage or private protocol was copied. Confirm applicable permissions before broader distribution. The [bridge guide](khost-bridge.md) owns setup and exact verification status.

**Experimental Party Tyme consumer integration in 0.9.1:** Sources connects the consumer Karaoke Premium account through a selected private credentials file. Accepted sessions use OS-protected storage when available; passwords are not copied into the saved session. This is separate from Party Tyme Pro and does not establish Pro account eligibility, a distribution partnership or commercial hosting rights. Authenticated consumer search results use the unified list, common context menu and optional-singer queue. Account-scoped MP4 preparation runs in the background; the existing transport, preview and singer display play the recording after fresh account/recording approval on each start or resume. Sign-out pauses playback and prevents cached resume. Only inspected non-DRM progressive sources are supported; no separate stems, mobile paid playback or licensed offline export is implied. The real muted Windows rehearsal decoded one 1280×720 recording and verified protected session restart, explicit reauthorization and sign-out refusal. Full-song listening, physical hardware, broader platforms, interactive sign-in and cache management remain open. Local schema 6 marks saved Party Tyme identities transactionally; preserve a pre-upgrade backup for downgrade. See `docs/partytyme-consumer-integration.md`.

**Experimental native KaraFun integration, introduced in 0.6.0 and extended in 0.7.0:** connect an existing account through the official, isolated sign-in window in **Sources → KaraFun**. Its first-party engine opens the session; TPV's independent account client checks the session, searches canonical catalog metadata and requests eligible recordings without an embedded vendor application key. Signed-in library results show **KaraFun**, open the ordinary singer dialog and become durable TPV requests. Approved requests prepare and auto-stage without arming a new show. Host Play uses a fresh authorization, verified account-scoped KIT media, one Web Audio clock for its Ogg stems, and timed canvas lyrics over a muted optional backdrop in TPV's singer screen. Pause, resume, seek, Previous, Stop, output recovery, preview and the visual browser mirror share the normal show authority. The optional KHost bridge remains separate and is unnecessary for this native path.

Remembered sessions use Electron safeStorage only when OS-backed encryption is available; Linux basic_text/plaintext fallback is refused. Restore validates an accepted saved session without opening a browser and retains its opaque account/cache scope. Normal close preserves the encrypted vault; explicit sign-out forgets it and silences native playback. Expiry/revocation offers reconnect; every performance still requires current authorization. Private cached KITs do not establish permanent/offline rights. Acquisition is bounded to 128 MiB, retained prepared data targets 128 MiB with a pinned active performance, and decoded audio to 512 MiB. Version 0.8.0 adds current-performance per-stem Vocal Mix. Native community playback, pitch/tempo, fixed-mix fallback and distribution/venue terms remain open. Global ratings now use numeric catalog/community keys without imported fingerprints; production needs the compatible validator deployment and no SQL migration. Schema 5 retains schema 4’s native-asset distinction and adds nullable request/history singer identity; older clients refuse the upgraded database.

Verification separates real account evidence from simulated flows: ordinary official sign-in, session information, canonical search and acquisition of one eligible 5,516,449-byte recording passed, including size/MD5/SHA256 verification and parsing three stems, six artwork members and timing. Generated Ogg playback passed a real muted Electron audio-clock/lyrics test. The complete TPV synthetic account/search/singer/queue/download/player/pause/seek/Previous/sign-out flow also passed. The actual-account TPV Windows rehearsal also passed official sign-in, search, singer selection, queueing, verified preparation, native audio-clock playback with rendered lyrics, pause, seek to 35 seconds, Previous, sign-out fencing and restart without autoplay. It was muted and used a disposable profile; audible sound, full-song listening, physical display/output recovery and native Linux/macOS playback remain separate acceptance gates. The connected TPV mailbox has no new API/SDK approvals; KaraFun's cancellation email gives no access end date, and successful acquisition does not prove plan duration. See the [native integration guide](karafun-native-integration.md).

**Not implemented:** a Google Drive application source for the proposed shared folder. Fully readable local synced media can use ordinary directory import; remote Drive indexing, identity, acquisition and cache behavior require a dedicated connector.

## 13. Quality, verification and release gates

**Plain-language QA guide:** `docs/qa/qa-test-guide.md` is the maintained tester-facing source for a separate Word guide. It explains the 38 specialist findings in ordinary test language and gives 15 scenarios with setup, steps and expected results. It distinguishes automated evidence from unperformed physical-device checks. Generate its Word edition from this Markdown; keep technical reports as supporting evidence.



The 0.3.0 default Windows test run passed 566 checks with four opt-in/platform skips, including five asynchronous-wait regressions; six document-generator checks passed. Linux passed 76 targeted checks and final AppImage launch/version/restart/persistence/no-autoplay. The server passed 50 relay checks including real MySQL transactions and nonempty backup/restore/restart. Actual packaged Windows-to-public-relay-to-browser operations passed, as did real catalog search and immediate yt-dlp acquisition of the owner’s selected recording after queueing. The final package imported all 237 actual MP4s in a disposable library. Muted integration checks cover automatic bumper completion/Skip/silence and restart. These checks do not establish audible mixer output, physical monitor hot-plug, actual phones, non-root Linux sandbox behavior, long-show reliability, macOS or a complete platform support matrix.

The 0.3.1 backdrop update passed type checking and 571 automated tests with four skips. Nine CDG checks include real FFmpeg pixels/audio, palette-index preservation, timing, looping, cancellation and error recovery. An isolated muted Electron rehearsal verified saved default/custom/solid choices across restarts, imported pixels against the actual bundled TPV video, unchanged source files and no rewriting of an existing converted song after a preference change. The Windows 0.3.1 installer and ZIP were built; the actual packaged app passed the same rehearsal using its real bundled resource, and the ZIP payload hashes match. Linux 0.3.1 and macOS packages have not been built. These synthetic CDG checks do not replace real-producer and physical synchronization verification.

Before a live-show release, verify Windows 11 x64, an agreed Linux desktop and macOS on representative hardware, including codecs, installers/signing, external displays, output selection, hot-unplug/reconnect, audio routing, cross-platform shortcuts, screen readers, database upgrades/backups/recovery and long shows. Test real iOS and Android devices, venue Wi-Fi, DNS, firewall and relay outages. Record machine, OS, media fixtures, versions and observed output. No production support claim should be inferred from a unit test or a mockup.

Proposed targets, not measured guarantees: local search p95 below 150 ms for 100,000 indexed versions; committed desktop queue edits under 100 ms; remote p95 below 500 ms on a healthy network; staged local start to audible output under one second; a four-hour show without lost turns or growing drift; audio/lyric synchronization within 100 ms after pause/seek; desktop target 1280 × 800 logical pixels with a usable compact 1024 × 720 mode; and companion layouts from 320 to 1024 CSS pixels. Verify 200% text scaling and WCAG 2.2 AA as design targets.

Acceptance must include: safe local import and relinking; MP3/CDG and ZIP pairing diagnostics; deterministic rounds, holds and manual overrides; no turn loss on preparation failure or repeated callbacks; separate display and explicit recovery; no unintended karaoke after restart, with configured launch bumper treated separately; persistent acknowledgements and concurrent-edit rejection; guest ownership and staged-item locks; LAN and internet disconnect/reconnect behavior; policy enforcement through every route; provider entitlement and capability checks; private-data redaction; and keyboard/touch accessibility. Paid release additionally requires verified subscription, offline-grant and event-replay behavior without cutting a running show.

## 14. Remaining decisions and maintenance

Open decisions include final naming, commercial packaging and provider agreements; account and singer identity methods; profile retention and deletion; policy thresholds and evidence sources; final media engine, supported formats and operating systems; device/disconnect behavior; restore and backup retention; relay ownership, availability and privacy; notification delivery; and the precise hold/reorder/check-in rules. Proposed behavior is not a shipping promise until implemented and verified.

The current implementation, tests and host/singer help should be reviewed whenever this specification changes. Update this Markdown and the corresponding application help and developer documents in the same focused change as behavior. Regenerate the Word specification and visual mockup book from this source, then visually inspect the outputs; do not maintain independent conflicting copies. Preserve the original handoff as historical context, but do not let its old moderation or source-file defaults override the decisions recorded here.

## 15. Interface mockup specification

This section is the editable source for the generated Night and Day mockup deck. Each `mockup` block describes a screen; the generator draws both themes from the same content. These are design representations, not screenshots. A **Current** badge denotes a screen in the desktop or local singer application; **Partial** includes current behavior plus clearly identified future ideas; **Planned** is not shipped. Mobile Full Host and Piggyback modes share the web interface with Android/iOS wrappers; native builds and real-device acceptance are recorded separately. The experimental internet relay is deployed and public browser rehearsals passed; physical-phone, venue-network and long-show checks remain. The examples below are fictional and do not imply licensed catalog access.

Maintain the accepted desktop structure: a host workspace and persistent player, a clear singer rotation, uncomplicated singer display, and paired Night and Day designs. Source video/CDG colors stay unchanged; native primary completed lyrics use KaraFun pink. Tooltips appear immediately and include assigned shortcuts when available. Host-only and singer-facing data remain separate.

```mockup-theme
{
  "product": "THE PROPER VOLUME",
  "deck_title": "Karaoke interface mockups",
  "deck_subtitle": "Current screens and planned experiences | Night and Day",
  "host_actions": [
    "palette",
    "search",
    "display",
    "fullscreen",
    "settings"
  ],
  "themes": {
    "Night": {
      "background": "#090f1b",
      "panel": "#101b2b",
      "card": "#1a293d",
      "line": "#34455b",
      "text": "#f3f7fc",
      "muted": "#a8bad0",
      "accent": "#13bbef",
      "selected": "#153b54"
    },
    "Day": {
      "background": "#f4f7fb",
      "panel": "#ffffff",
      "card": "#e9f0f7",
      "line": "#c4d1df",
      "text": "#17283d",
      "muted": "#51657a",
      "accent": "#007fae",
      "selected": "#d7eef9"
    }
  },
  "brand_logos": {
    "Night": {
      "path": "../assets/branding/logo-dark.png",
      "sha256": "575cf6e956e335e2c6be2de5538aa07ec90fa6bfb916daaaa1a875cb890e4437"
    },
    "Day": {
      "path": "../assets/branding/logo-light.png",
      "sha256": "086e8b5794933534ae9238f55b943faf41fea9218c8d81bafa1f395fc0e3ad44"
    }
  }
}
```

```mockup
{
  "id": "D01",
  "title": "Desktop host",
  "status": "Current",
  "description": "Unified search, singer preview, automatic transitions and host applause.",
  "layout": "desktop",
  "navigation": [
    "Library",
    "Playlists",
    "Sources"
  ],
  "selected_navigation": "Library",
  "heading": "Song Library",
  "toolbar": "Sort     Filter",
  "import_actions": [
    {
      "icon": "importVideo",
      "label": "Import Video File"
    },
    {
      "icon": "importFolder",
      "label": "Import Custom Directory"
    },
    {
      "icon": "importCdg",
      "label": "Import CD+G / ZIP"
    }
  ],
  "rows": [
    "Popular | Nada Surf | Local | 8.2/10 stars",
    "Example Song | Sample Artist | Karaoke Nerds",
    "Another Example | Sample Artist | YouTube",
    "Catalog Example | Sample Artist | KaraFun"
  ],
  "side_heading": "Singer Preview / Host Queue",
  "side_rows": [
    "PREVIEW | Works while singer window is hidden",
    "ON STAGE | Alex - Popular",
    "NEXT | Unassigned - Example Song",
    "Automatic next after gap + ready media"
  ],
  "footer_heading": "Now Playing",
  "footer_rows": [
    "Alex | Popular",
    "01:20 / 03:45 | Seek | Volume | Vocal Mix | Applause"
  ],
  "transport_icons": [
    "previous",
    "playPause",
    "stop",
    "skip"
  ],
  "detail": "Queue with Singer (optional) empty or choose a name; assign later. No fake singer is created. Shared menus and an outer-only search focus ring. Approved turns prepare; Play begins the show.",
  "host_navigation": [
    "Requests",
    "Singers",
    "Remote Sessions"
  ],
  "sidebar_search": "Search Songs · Ctrl/Cmd+F",
  "row_sources": [
    "local",
    "karaokenerds",
    "youtube",
    "karafun"
  ],
  "provider_colors": {
    "local": "#601CE9",
    "karaokenerds": "#007bff",
    "youtube": "#ff0033",
    "karafun": "#d5167a"
  }
}
```
```mockup
{
  "id": "Q01",
  "title": "Requests and rotation",
  "status": "Partial",
  "description": "Host moderation and the singer rotation, with advanced staff actions reserved for later work.",
  "layout": "desktop",
  "navigation": [
    "Library",
    "Playlists",
    "Sources"
  ],
  "selected_navigation": "Requests",
  "heading": "Requests",
  "toolbar": "Pending requests       Request history",
  "rows": [
    "Unassigned | Example Song | Accept / Reject",
    "Jordan | Another Example | Accepted",
    "Alex | A Song for Tonight | Withdrawn",
    "Sam | Example Song | Removed"
  ],
  "side_heading": "Singer Rotation",
  "side_rows": [
    "ON STAGE | Alex",
    "1 | Casey",
    "2 | Unassigned",
    "Delete removes focused waiting request"
  ],
  "footer_heading": "Transport",
  "footer_rows": [
    "Named singer limit: 3 requests",
    "Rotation: fair singer turns"
  ],
  "transport_icons": [
    "previous",
    "playPause",
    "stop",
    "skip"
  ],
  "detail": "The host may queue without a singer, then assign/change/clear later. Prepared edits retain request ID and slot. Unassigned turns use independent FIFO fair-round places; guest ownership stays fixed.",
  "host_navigation": [
    "Requests",
    "Singers",
    "Remote Sessions"
  ]
}
```

```mockup
{
  "id": "K01",
  "title": "Host and staff companions",
  "status": "Planned",
  "description": "Future staff surfaces for authorized transport and request moderation.",
  "layout": "phones",
  "phone_titles": [
    "Host companion",
    "Staff moderation"
  ],
  "phone_subtitles": [
    "Current show",
    "Requests waiting"
  ],
  "phone_rows": [
    [
      "Alex | Popular",
      "Next: Casey",
      "Play/Pause",
      "Stop / Skip",
      "Audio controls"
    ],
    [
      "Casey | Example Song",
      "Accept / Reject",
      "Jordan | Another Example",
      "Singer notes | staff only",
      "Rotation status"
    ]
  ],
  "detail": "The full Host, Co-host and Moderator roles and these companion apps are not implemented."
}
```

```mockup
{
  "id": "S01",
  "title": "Singer join and request",
  "status": "Partial",
  "description": "Join by name, request songs, applaud and share photos. Native devices still need verification.",
  "layout": "phones",
  "phone_titles": [
    "Join the show",
    "Request a song"
  ],
  "phone_subtitles": [
    "Host shared link",
    "Browse loaded songs"
  ],
  "phone_rows": [
    [
      "Your name",
      "Casey",
      "Join the show",
      "Access lasts for this page",
      "Ask host for help after reload"
    ],
    [
      "Search songs",
      "Popular | Nada Surf",
      "Request",
      "Applause | 3 credits · 24 points",
      "Share a photo | Send to display"
    ]
  ],
  "detail": "Local invitations require trusted venue HTTPS and DNS; internet sessions use the host’s queue.thepropervolume.com link. Persistent accounts remain planned; real-device native joining and network permissions require acceptance."
}
```

```mockup
{
  "id": "S02",
  "title": "Singer discovery and queue",
  "status": "Partial",
  "description": "A singer sees their own request status and can withdraw eligible requests.",
  "layout": "phones",
  "phone_titles": [
    "Song library",
    "Your requests"
  ],
  "phone_subtitles": [
    "Loaded songs",
    "Live status"
  ],
  "phone_rows": [
    [
      "Search loaded songs",
      "Example Song | Sample Artist",
      "Request",
      "Load more songs",
      "Ask for a missing song"
    ],
    [
      "Example Song | Accepted",
      "Withdraw",
      "Another Example | Staged",
      "Staged turns stay locked",
      "Away 1-60 min / Return now"
    ]
  ],
  "detail": "Current: statuses, withdrawal and own timed availability. One future request while away. Planned: wait estimates and notifications."
}
```

```mockup
{
  "id": "O01",
  "title": "Singer display",
  "status": "Current",
  "description": "Custom booth identity and scrolling announcement overlay a viewport-fitted singer screen.",
  "layout": "display",
  "display_title": "THE PROPER VOLUME",
  "display_subtitle": "Your host booth name · Logo size 50vw",
  "display_next": "Coming up: Casey / Jordan · Scrolling banner at top or bottom",
  "detail": "Hidden renderer supplies preview before opening this screen. Logo 10–85vw, banner expiry and optional restart persistence are settings. Native completed primary lyrics are pink; source video/CDG stays unchanged. Physical hot-plug remains unverified."
}
```

```mockup
{
  "id": "D08",
  "title": "Preferences and audio controls",
  "status": "Current",
  "description": "Grouped, collapsible preferences keep essential show controls in the workspace.",
  "layout": "settings",
  "navigation": [
    "Shared Catalog",
    "Appearance",
    "Queue Management",
    "Library Settings",
    "Video Downloads & Karaoke Nerds Cache",
    "Remote Queueing",
    "Audio Controls",
    "Singer Display",
    "Keyboard Shortcuts",
    "Configuration Files"
  ],
  "selected_navigation": "Audio Controls",
  "heading": "Audio Controls",
  "rows": [
    "Output Device | Explicit device or system default",
    "Pause Interval | 2 seconds · Automatic next on",
    "Bumper on launch | Enabled",
    "Bumper between songs | Enabled",
    "Fade-in | 1000 ms · Range 500–1700",
    "Theme | Soft Ambient · Up to 5 custom files"
  ],
  "side_heading": "Other groups",
  "side_rows": [
    "Appearance | Theme, accent, layout, preview",
    "Queue | Rotation, approval, singer limit",
    "Keyboard Shortcuts | Multiple bindings and reset",
    "Singer Display | Booth name, logo size, banner"
  ],
  "footer_heading": "Preferences",
  "footer_rows": [
    "Cancel",
    "Save preferences"
  ],
  "detail": "One hidden singer renderer handles preview/audio. Launch music needs no visible window. Completion/Skip waits for silence; next karaoke waits for bumper stop and media readiness. Physical sound remains unverified."
}
```

```mockup
{
  "id": "B01",
  "title": "Account and billing",
  "status": "Planned",
  "description": "Future host or venue subscriptions; singers participate without a required paid subscription.",
  "layout": "panels",
  "heading": "Account and billing",
  "toolbar": "Future account and service settings",
  "rows": [
    "Host or venue account | Sign in and manage account",
    "Subscription | Plan, renewal and payment settings",
    "Provider access | Separate catalog entitlements",
    "Devices and offline access | Subject to provider terms"
  ],
  "side_heading": "Singer participation",
  "side_rows": [
    "Join a show without purchasing a subscription",
    "Optional profile and personal lists",
    "Review privacy and account controls"
  ],
  "footer_heading": "Release gate",
  "footer_rows": [
    "TPV account subscriptions and billing are not implemented"
  ],
  "detail": "Pricing, purchases, external provider access and entitlement models require separate product decisions."
}
```

```mockup
{
  "id": "P01",
  "title": "Song availability and age policy",
  "status": "Planned",
  "description": "Future host-facing controls for policy, visibility and age-appropriate catalog access.",
  "layout": "panels",
  "heading": "Song availability",
  "toolbar": "Show policy   /   Audience settings",
  "rows": [
    "Allowed songs | Select available versions",
    "Excluded songs | Hide selected versions",
    "Age restricted show | Apply content rules",
    "Unrated or uncertain | Hidden until rated"
  ],
  "side_heading": "Guest catalog",
  "side_rows": [
    "Only policy-eligible songs appear",
    "Apply policy on direct requests",
    "Keep host-only notes private"
  ],
  "footer_heading": "Policy",
  "footer_rows": [
    "Domain filtering exists; a complete host policy interface is planned"
  ],
  "detail": "The preview describes the intended interface; existing policy rules do not constitute full moderation or account permissions."
}
```

```mockup
{
  "id": "A01",
  "title": "Local control API",
  "status": "Partial",
  "description": "Initial authenticated read and settings-navigation API/CLI passed Windows and Linux package rehearsals; complete show control remains planned.",
  "layout": "panels",
  "heading": "Local control",
  "toolbar": "API access and integrations",
  "rows": [
    "Local API | Disabled until explicitly enabled",
    "Read | Capabilities, state, settings and shortcuts",
    "Navigate | Preferences and Keyboard Shortcuts",
    "Credentials | Owner-only, rotated each start"
  ],
  "side_heading": "Authority",
  "side_rows": [
    "No second database writer",
    "Authenticate every API operation",
    "Single host authority",
    "Install CLI to PATH | User scope"
  ],
  "footer_heading": "Planned Control",
  "footer_rows": [
    "Playback, queue and provider mutations",
    "Events, pagination and user-scoped tokens"
  ],
  "detail": "The actual Windows and Linux packages passed private-profile read/navigation and lifecycle checks. Windows and Linux bundled-wrapper/package verification passed; full mutations and broader permissions are not implemented."
}
```

```mockup
{
  "id": "S06",
  "title": "Singer library and planning",
  "status": "Planned",
  "description": "Future personal favorites and early song lists do not reserve a live turn.",
  "layout": "phones",
  "phone_titles": [
    "My songs",
    "Plan for a show"
  ],
  "phone_subtitles": [
    "Favorites and memory",
    "A list is not a request"
  ],
  "phone_rows": [
    [
      "Favorites",
      "Example Song | Sample Artist",
      "Remembered key | future",
      "Playlists",
      "Private singer preferences"
    ],
    [
      "Friday song ideas",
      "Another Example",
      "A Song for Tonight",
      "Request after joining",
      "No queue turn is reserved"
    ]
  ],
  "detail": "The current desktop has host-managed playlists and history. Personal accounts, favorites, remembered settings and prearrival lists remain planned."
}
```

```mockup
{
  "id": "S08",
  "title": "Duet and group invitations",
  "status": "Planned",
  "description": "Future group invitations require an explicit response and create one shared performance.",
  "layout": "phones",
  "phone_titles": [
    "Invite a singer",
    "Respond to invitation"
  ],
  "phone_subtitles": [
    "One shared song",
    "Your choice"
  ],
  "phone_rows": [
    [
      "Example Song",
      "Lead singer: Casey",
      "Invite Jordan",
      "Waiting for response",
      "Cancel invitation"
    ],
    [
      "Casey invited you",
      "Example Song",
      "Accept",
      "Decline",
      "No turn until confirmed"
    ]
  ],
  "detail": "Duets, group identities, acceptance and group-turn scheduling are not implemented."
}
```

## YouTube acquisition and playback

**Available:** Song Library combines local and exact Karaoke Nerds/YouTube catalog identities. An approved queued request immediately dispatches permanent acquisition through a serial yt-dlp queue, deduplicating requests for the same version. Manual URL additions save metadata only; a host may explicitly choose Download Video before queueing. Accepted/staged requests missing their media reconcile on restart. The host selects the permanent base folder and optional yt-dlp executable; FFmpeg is also required. Waiting jobs can be cancelled and failed downloads explicitly retried; a normal failure does not create an automatic retry loop or remove the singer request. Uncertain cleanup halts further automatic acquisition. Service badges retain YouTube; completed downloads never autoplay.

Mapped brands use `BASE/karaokenerds/Brands/BRAND_SLUG/ARTIST/ARTIST - TITLE.mp4`; plain links/unmapped brands use `BASE/youtube/ARTIST/ARTIST - TITLE.mp4`. Safe names and exclusive publication prevent overwrite; a video-ID suffix is used only for an occupied name. A verified ownership/fingerprint sidecar is required to reuse unattached cache files. Same song, request and history identities are retained. Cached media uses normal output selection, transport, timeline and offline playback. Downloads never arm a new show; an already running show can advance when ready. Missing or changed files require deliberate recovery. Complete files survive restart and app exit and need separate media backup.

The separate embedded preview still uses system audio and requires internet; it remains outside the show and does not download. Version 0.5.0 implements bounded, karaoke-filtered YouTube metadata search with channel approvals/blocklists, Takeout subscription import and receipt-validated singer selection through the normal request/download authority. YouTube account login and automatic brand/artist batch selection remain planned. The earlier installed tools downloaded the owner's video and verified H.264/AAC with zero-network reuse; that historical check does not verify every new search result. Real show output, each recording's acquisition, supported platforms and packaged tool distribution remain verification work. Version 0.6.0 adds experimental native KaraFun account, queue and playback; public provider metadata discovery, partner catalog adapters and optional external KHost handoff remain separate capabilities. The official partner routes still need KaraFun OEM terms, Stingray credentials/terms and Sunfly SDK/trial approval. Native account/media evidence is recorded in the integration guide.


```mockup
{
  "id": "D09",
  "title": "Shared catalog connection",
  "status": "Partial",
  "description": "Host discovery uses public read-only search by default or an optional private profile; freshness remains explicit.",
  "layout": "settings",
  "navigation": [
    "Shared Catalog",
    "Appearance",
    "Queue Management",
    "Audio Controls"
  ],
  "selected_navigation": "Shared Catalog",
  "heading": "Shared Karaoke Nerds Catalog",
  "rows": [
    "Use shared catalog | Public read-only default",
    "Choose configuration | Optional private profile",
    "Check connection | Separate from saving",
    "Catalog freshness | Unknown until verified"
  ],
  "side_heading": "Offline behavior",
  "side_rows": [
    "Previously saved searches | Available after restart",
    "New searches | Connection required",
    "Authentication rejected | Replace client configuration"
  ],
  "footer_heading": "Preferences",
  "footer_rows": [
    "Cancel",
    "Save preferences"
  ],
  "detail": "Illustrative connection state. No database or provider keys enter the interface. Feed refresh is disabled pending verified retirement and cooldown history."
}
```

```mockup
{
  "id": "D10",
  "title": "Internet singer session",
  "status": "Partial",
  "description": "Start a hosted singer session with an editable short address and a public join link.",
  "layout": "panels",
  "heading": "Remote Sessions",
  "toolbar": "Internet singer requests at queue.thepropervolume.com",
  "rows": [
    "Session name | proper-volume",
    "Start Session | Explicit host action",
    "Singer link | queue.thepropervolume.com/proper-volume",
    "Copy Link | Share with your guests",
    "End Session | Revoke internet access"
  ],
  "side_heading": "Connected Singers",
  "side_rows": [
    "Casey | Joined",
    "Jordan | Joined",
    "Remove Access | Revoke current session"
  ],
  "footer_heading": "Anyone with this link can join",
  "footer_rows": [
    "Keep the booth running",
    "Local queue remains authoritative"
  ],
  "detail": "Illustrative session. Temporary network loss keeps the same receipt scope; End or replacement invalidates its generation. Accounts, paid providers and physical-device verification remain separate."
}
```

### Application icon review

The owner selected **Microphone Play** on 13 November: a vintage microphone inside an orange and pink play outline, with navy and gray details. The palette is orange `#F68713`, pink `#ED0D63`, navy `#131457` and gray `#E9E9E9`. The application icon contains no text. The default installed icon is the original navy mark on a white rounded tile; matching light and dark exports remain available. The full logo reads **TPV / KARAOKE BOOTH**. Committed `assets/branding` masters and reproducible exports cover Windows ICO/NSIS, macOS ICNS, Linux PNGs, web favicons, horizontal wordmarks and mobile/adaptive icons. Actual Windows app, installer and uninstaller resources and the installed Day/Night logos passed verification; Linux payload checks and macOS 0.4.4 bundle/signature checks passed. Native Dock/launcher appearance and remaining platform installation checks are still open. Host-selected singer-display logos remain independent. See `docs/app-icon-options.md` and `assets/branding/README.md`. Velvet Script, the standalone V and earlier alternatives are retained as historical explorations.

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
    "LRC lyrics | Parser foundation; playback pending"
  ],
  "side_heading": "Related Settings",
  "side_rows": [
    "Logo and next singers | Separate display choices"
  ],
  "footer_heading": "Preferences",
  "footer_rows": [
    "Cancel",
    "Save preferences"
  ],
  "detail": "Bundled animation loops behind original CDG lyrics; reimport existing conversions to change backdrop. Ordinary video stays unchanged. Singer Display also offers booth name, live logo preview/10–85vw sizing and timed top/bottom banner."
}
```

## Shared Star Ratings and Current Host Controls

**Available in 0.10.3 source:** exact recordings receive 1–10-star host ratings. A click saves immediately and closes the control only on confirmation; a failed save leaves it open with an error. Clear My Rating removes the vote. YouTube/Karaoke Nerds uses its case-sensitive YouTube ID. KaraFun uses `karafun:catalog:NUMERIC_ID` or `karafun:community:NUMERIC_ID` without an imported fingerprint. The matching validator is deployed on Linode III. Live disposable-voter lookup, vote, update and withdrawal checks passed in both namespaces on 15 November, with no retained test votes or SQL changes. Identified recordings use the authenticated global MySQL-backed service. A source-less file uses its imported SHA256 and stores its vote in local schema-5 `show.sqlite` (the rating table was introduced in schema 3), works offline and never sends its path or local fingerprint to the shared service. Identical contents share that local score; different converted CDG outputs can have different fingerprints. Provider metadata edits never merge distinct recordings.

The host lookup router returns per-key storage/write capability so local votes remain available when a remote profile is absent or shared lookup fails. A failed global write is never reclassified as a successful local save. Global writer identity comes from a separately provisioned private host credential; readers/public lookup cannot vote or see voter identities. One current vote is replaced or cleared explicitly. This is a host-installation vote, not an individual singer account; remote singer voting and cross-device person ownership remain planned.

The 0.4.0 workspace and keyboard behavior is documented in `docs/host-workspace.md`. Source-based Windows regressions and live QA-only service tests cover public catalog discovery, host voting, restart persistence, permissions, menu routing, template saving, transport readiness and shortcut capture. Physical display/audio/phone and native installation checks remain separate.

```mockup
{
  "id": "D12",
  "title": "Keyboard shortcut editor",
  "status": "Current",
  "description": "Wide grouped shortcut editing with multiple bindings, conflicts and immediate saved reset.",
  "layout": "panels",
  "toolbar": "Click a binding to record a replacement; Add assigns another shortcut.",
  "heading": "Application",
  "rows": [
    "Search Song Library | Ctrl+F, Cmd+F",
    "Open Preferences | Ctrl+Comma, Cmd+Comma, Alt+Comma",
    "Keyboard Shortcuts | Ctrl+Slash, Cmd+Slash, F1"
  ],
  "side_heading": "Playback and Queue",
  "side_rows": [
    "Play/Pause | Spacebar",
    "Player Fullscreen | F, Shift+F",
    "Previous | Unassigned",
    "Remove Waiting Request | Delete, queue only"
  ],
  "footer_heading": "Customization",
  "footer_rows": [
    "Reset to Defaults | Restore and save all defaults",
    "Edit custom shortcuts | Open keybindings.json"
  ],
  "detail": "Save Shortcuts applies the draft independently from other preferences. Printable custom bindings do not steal text entry, and shortcut capture does not trigger app actions."
}
```

```mockup
{
  "id": "D13",
  "title": "Song sources",
  "status": "Partial",
  "description": "Karaoke Nerds, curated YouTube discovery, KaraFun and Party Tyme consumer connections, plus other service metadata.",
  "layout": "panels",
  "toolbar": "Show in Search | Local · Nerds · YouTube · KaraFun · Party Tyme · Sunfly · Stingray",
  "heading": "KaraFun Account",
  "rows": [
    "Sign In | Official account window",
    "Session | OS-encrypted; verified restore after restart",
    "Library Search | Choose singer and queue",
    "Preparation | Private cache; no autoplay"
  ],
  "side_heading": "YouTube Karaoke Search",
  "side_rows": [
    "Query | Adds karaoke automatically",
    "Channels | Karaoke hints / Approved only",
    "Curate | Block ID or import subscriptions",
    "Choose Singer | Queue permanent download"
  ],
  "footer_heading": "Party Tyme Premium",
  "footer_rows": [
    "Connect | Private credentials file",
    "Search and Queue | Consumer recordings",
    "Play | Fresh account check every time"
  ],
  "detail": "Independent source switches hide discovery without disconnecting accounts or stopping queued songs. Party Tyme has yellow rows; its consumer Premium joins the unified queue. Other public service metadata remains search-only."
}
```
```mockup
{
  "id": "D14",
  "title": "Service catalog search",
  "status": "Current",
  "description": "Public catalog/store metadata beside local playback; optional developer access stays separate.",
  "layout": "panels",
  "toolbar": "Title / artist search | Sunfly Store: title or SF SKU; artist search unverified",
  "heading": "Service Catalogs - Search Only",
  "rows": [
    "Catalog Example | Sample Artist | KaraFun | Search only",
    "Another Example | Another Artist | Party Tyme | Search only",
    "Store Example | Artist unknown | Sunfly Store | SF123456",
    "Stingray | Developer API profile needed"
  ],
  "side_heading": "Local Queue",
  "side_rows": [
    "ON STAGE | Alex - Local Song",
    "NEXT | Casey - Saved Video",
    "Transport | Local playback unchanged"
  ],
  "footer_heading": "Catalog Access",
  "footer_rows": [
    "Public metadata | No login needed",
    "Profiles | Sources picker",
    "Playback | Pending"
  ],
  "detail": "Provider metadata appears in the shared library with source color/label and the common context menu. Unsupported queue/edit actions are disabled. Sunfly Store remains five first-page songs; store IDs/SKUs never prove streaming access."
}
```


```mockup
{
  "id": "D15",
  "title": "YouTube karaoke discovery",
  "status": "Current",
  "description": "Curated candidates, channel rules and deliberate queueing through singer selection.",
  "layout": "panels",
  "toolbar": "Song Library | Query includes karaoke | All Songs",
  "heading": "YouTube Karaoke",
  "rows": [
    "Example Song | Sample Artist | Karaoke channel hint",
    "Original video title | Suggested metadata",
    "Duration | 3:45 | Eligible non-live video",
    "Choose Singer | Open ordinary queue dialog"
  ],
  "side_heading": "Channel Rules",
  "side_rows": [
    "Mode | Approved channels only",
    "Approved | Channel ID / @handle",
    "Blocked | IDs override approvals",
    "Import | Takeout CSV or JSON"
  ],
  "footer_heading": "Acquisition",
  "footer_rows": [
    "Approved request | Permanent yt-dlp download",
    "Playback | First Play; next songs follow the gap"
  ],
  "detail": "Curated candidates share the global result list and queue menu. Receipts reject stale results; approved requests dispatch yt-dlp and auto-stage. Preparation alone never arms a new show. Video/channel hints do not guarantee quality."
}
```

```mockup
{
  "id": "D16",
  "title": "Song and artist blacklist",
  "status": "Current",
  "description": "Host-wide metadata rules hide every matching recording while preserving per-show policy.",
  "layout": "settings",
  "navigation": [
    "Appearance",
    "Song and Artist Blacklist",
    "YouTube Search",
    "Singer Display"
  ],
  "selected_navigation": "Song and Artist Blacklist",
  "heading": "Song and Artist Blacklist",
  "rows": [
    "Artist to blacklist | Sample Artist | Add",
    "Artists | Example Artist | Remove",
    "Song Artist | Another Artist",
    "Song Title | Example Song | Add",
    "Songs | Another Artist - Example Song | Remove"
  ],
  "side_heading": "Matching Scope",
  "side_rows": [
    "All sources and recording versions",
    "Complete artist/title identities",
    "Host settings across shows",
    "Context menu | Blacklist song / artist"
  ],
  "footer_heading": "Preferences",
  "footer_rows": [
    "Cancel",
    "Save Preferences"
  ],
  "detail": "Rules normalize case and typographic spacing without substring matching. Existing requests remain visible for recovery. Global rules never rewrite a show-specific allowlist."
}
```

```mockup
{
  "id": "D17",
  "title": "LAN singer-screen sharing",
  "status": "Current",
  "description": "Read-only lyric visuals on venue browsers, separate from singer request admission.",
  "layout": "panels",
  "toolbar": "Remote Sessions | LAN Singer Screens",
  "heading": "Host Sharing Controls",
  "rows": [
    "Sharing | Enabled explicitly",
    "Port | 4051",
    "Address | http://192.168.1.20:4051",
    "Viewers | 3 of 64 | Illustrative",
    "Stop Sharing | Close listener only"
  ],
  "side_heading": "Viewing Browser",
  "side_rows": [
    "Singer screen | Same captured lyrics",
    "Audio | Host output only",
    "Renderer unavailable | Waiting screen",
    "Network loss | Reconnect"
  ],
  "footer_heading": "Separate Request Link",
  "footer_rows": [
    "Viewing address | No queue or host controls",
    "Remote Session | Use invitation to request"
  ],
  "detail": "Concrete private-interface listeners plus loopback. Windows requires actual Private classification; unknown/Public is loopback-only. Trust rechecks every 30s with 5s classification bound; no firewall rule is installed. Hidden preview works without visible singer window."
}
```

```mockup
{
  "id": "D18",
  "title": "KaraFun vocal mix",
  "status": "Partial",
  "description": "Independent live levels for each stem actually supplied by a native KaraFun recording.",
  "layout": "panels",
  "toolbar": "Host Transport | Vocal Mix",
  "heading": "Vocal Mix - Current Recording",
  "rows": [
    "Instrumental | 100%",
    "Backing Vocals 1 - High | 65%",
    "Backing Vocals 2 - Low | 100%",
    "Lead Vocals 1 - Alex | 40%",
    "Lead Vocals 2 - Casey | 0%"
  ],
  "side_heading": "Per-Performance Controls",
  "side_rows": [
    "Live levels | Keep one playback clock",
    "Master Volume | Whole output",
    "Pause / seek / Previous | Retain mix",
    "New performance / Stop | Reset"
  ],
  "footer_heading": "This Song Only",
  "footer_rows": [
    "Reset This Song | Instrumental/backing 100%, lead 0%",
    "Done | Keep playing with current levels"
  ],
  "detail": "Host-only, authorized current generation. Unknown stems remain Other Audio; mixed voices cannot be separated. Synthetic five-stem audio and hidden-window controls verified. Physical mixer and real duet listening remain acceptance work."
}
```


```mockup
{
  "id": "M01",
  "title": "Mobile Host and Piggyback Modes",
  "status": "Partial",
  "description": "One mobile web interface powers the PWA and Android or iOS wrappers. Real phone acceptance remains separate.",
  "layout": "phones",
  "phone_titles": [
    "Choose Your Mode",
    "Full Host Mode"
  ],
  "phone_subtitles": [
    "Host or join an existing room",
    "Own player and singer queue"
  ],
  "phone_rows": [
    [
      "Full Host Mode | Play and invite singers",
      "Piggyback Mode | Join another host",
      "Room Found | Confirm then Join",
      "Room Name or Link | Manual fallback",
      "Install | Add to Home Screen",
      "Native Discovery | Optional network access"
    ],
    [
      "Search Songs | Karaoke Nerds and local",
      "Popular | Nada Surf",
      "Add to Queue | Singer optional",
      "Play or Pause | Timeline and volume",
      "Applause | Host controls and points",
      "Room | Name and share a singer link"
    ]
  ],
  "detail": "Public HTTPS rehearsals passed for catalog search, joining, requests, withdrawal, real YouTube playback, shell caching and room closure. Native compilation passes; store signing and physical Android or iOS checks remain."
}
```

```mockup
{
  "id": "M02",
  "title": "Mobile Room and Singer Requests",
  "status": "Partial",
  "description": "A singer requests a song on a phone or desktop host. Discovery suggests a room and never joins automatically.",
  "layout": "phones",
  "phone_titles": [
    "Piggyback Mode",
    "Your Karaoke Room"
  ],
  "phone_subtitles": [
    "Request songs on the host",
    "Full Host room settings"
  ],
  "phone_rows": [
    [
      "Room Found | Friday Night",
      "Join Room | Singer chooses",
      "Your Name | Casey",
      "Song Library | Host published songs",
      "Request | Check accepted status",
      "Applause / Photo | Credits and points"
    ],
    [
      "Booth Name | Friday Night",
      "Room Address | friday-night",
      "Open Room | Share singer link",
      "Suggest Nearby | Optional",
      "Between Songs | 5 second gap",
      "Your Data | Export show and history"
    ]
  ],
  "detail": "Web suggestions share a public internet connection and may cover different venues. Native DNS-SD uses public room beacons; manual HTTPS links remain available. Room closure resets guest access. No quizzes, mobile paid-provider login or casting is implied."
}
```
