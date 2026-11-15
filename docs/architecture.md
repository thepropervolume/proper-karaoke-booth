# Architecture and Progress

Updated 15 November 2026 for source development **0.7.0**. Source behavior, synthetic rehearsals, actual-account evidence and platform package verification are separate claims. See [installation](installation.md) for delivered artifacts.

## Single Host Authority

Electron main owns show rules, local SQLite writes, media paths, provider accounts and process/network operations. Isolated host/singer renderers have narrow preload bridges. Validated domain commands commit before acknowledgement; expected revisions, durable receipts and generation-bound events prevent stale callbacks from consuming another turn. The internet relay, singer clients and CLI never become another SQLite writer.

SQLite uses WAL and synchronous FULL. A new host epoch is issued on restart; interrupted karaoke is always restored paused. Schema 4 distinguishes native KaraFun assets from MP4s. Backups cover the database, not media/settings/private profiles; in-app restore remains planned. Metadata corrections remain local-only until the explicit per-edit embedded-write option is implemented. Failed future write-back must retain the local edit.

## Playback, Staging and Preview

Main creates one hidden, painted singer renderer at startup with background throttling disabled. It owns ordinary video, native KaraFun stems/lyrics and bumper audio. Showing the singer display reveals that same window; Close hides it. Host preview and optional LAN screens consume bounded JPEG captures using `stayHidden`/`stayAwake`, never a second media player or sink. Capture epochs/demand checks reject stale frames and avoid overlapping captures.

Approved requests automatically stage without starting karaoke. Pending moderation stays pending. A staged request remains locked through reorder/policy changes; explicit track/singer edits keep the same ID/status. `ShowAdvance` is armed only by natural completion or confirmed Skip, and waits for the committed gap and eligible media readiness. It is never armed by launch, queue insertion or download completion alone. Its cancellation and identity checks fence async authorization/hash/output operations. Stop/Pause/error/device loss cancels it. Failed media retains the staged turn and asks for recovery.

Bumper launch and between-song options default on. Launch has no old karaoke generation; between-song music waits for its matching silence acknowledgement. The controller stops bumper with acknowledgement before any karaoke start/resume. The system default sink is accepted. Fade-in defaults to 1000 ms, configurable 500–1700 ms, with cancellation and live-volume support. Gap zero avoids a filler flash when the next song is ready. Output recovery is deliberate; operating-system rerouting can precede device notification and needs physical tests.

Main passes booth name, logo size (10–85 viewport-width percent), banner position/text/expiry and next-singer information to the presentation renderer. Banners are disabled on launch unless persistence was explicitly selected; saved text remains. Host logo-picker preview uses host-only IPC. These updates never start karaoke.

## Unified Discovery and Provider Accounts

The sidebar search remains visible on every host workspace. All eligible local, Karaoke Nerds, YouTube, native KaraFun and public-service matches share one selectable list/context-menu flow; source capability decides which actions are enabled. Three-pixel source borders use local purple `#601CE9`, Karaoke Nerds blue `#007bff`, YouTube red `#ff0033` and KaraFun pink `#d5167a`. Long results scroll while the transport stays visible. Blacklists and show policy are rechecked at discovery, request and start boundaries.

Karaoke Nerds supplies metadata/YouTube IDs. Approved requests dispatch bounded serial yt-dlp acquisition to permanent host storage; FFmpeg/yt-dlp are external prerequisites. Completion attaches media to the same version/request identity. Automatic brand/artist batches and verified daily-refresh coordination remain planned. A separate manually opened YouTube preview has an audio gate against show playback.

Native KaraFun uses official-window account login, canonical search, account-scoped checksum-verified KIT media, bounded archive/XML/Ogg decoding and one clock for synchronized stems/lyrics. Each start/resume obtains current authorization; a cached path is insufficient. The primary completed-lyric color is KaraFun pink; source video/CDG colors are unchanged. User stem mixing, pitch/tempo, native community playback, fixed-mix fallback and approved distribution/venue terms remain unfinished.

`KaraFunSessionVault` stores only accepted owned session material through Electron safeStorage. Linux basic_text/plaintext fallback is rejected; without usable OS protection sessions remain memory-only. Startup restore validates the saved session without opening a browser and preserves its opaque account cache scope. Normal close retains the encrypted vault; explicit sign-out deletes it and revokes active playback. Expiry/unavailable validation produces a normal reconnect path, never unexpected playback. Real Windows cross-process protected storage and synthetic account checks passed; every platform's keychain behavior still requires release verification.

The optional independently written KHost bridge uses separately licensed public contracts for external search/handoff only. KHost owns its own login, queue and player. It is unnecessary for native TPV KaraFun. Sunfly/Stingray protected catalog adapters still need real partner access; public service metadata never creates playback entitlement.

## Shared Data and Ratings

The dedicated MySQL catalog at `apps.thepropervolume.com` serves the recovered 64,261 valid unique Karaoke Nerds YouTube records. Fresh installs use bounded public search; optional private reader profiles stay main-only. Up to 100 successful scoped queries/20 MiB can be reused offline with a stale label. Feed freshness/retirement history is unknown and automatic refresh remains disabled; never infer it from file dates.

Shared ratings use exact `youtube:ID` and `karafun:catalog:NUMERIC_ID` / `karafun:community:NUMERIC_ID` keys. KaraFun support is implemented in client/service validation without a SQL schema change; production needs that validator deployment before accepting the new keys. Public readers receive aggregates; a separately provisioned voter can replace/clear their own vote. Unknown source-less files use local SHA256 votes in `show.sqlite` and never send those keys remotely. Provider/reader credentials, media fingerprints and profile paths stay main-only. Remote singer voting and person ownership remain planned.

## Remote Access and Local Control

Trusted local singer request rooms and the deployed `queue.thepropervolume.com` relay delegate to the same show authority with separate scopes. Browser request/recovery rehearsals passed; physical phones, real networks, self-service accounts, wider roles/privacy and long-show verification remain unfinished.

The optional read-only LAN singer-screen HTTP service has no host-control API or extra audio. It binds concrete trusted private interfaces plus loopback, never a wildcard. Windows additionally requires actual Private classification; unknown/Public results fall back to loopback. Classification has a 5-second bound and trust is rechecked every 30 seconds, closing removed/untrusted listeners. No firewall rule or managed policy is changed. Stream/viewer limits and backpressure bound slow clients.

The local control API is disabled by default and binds loopback with an owner-only per-start credential. Initial routes expose capabilities, bounded state/settings/shortcut reads and Preferences/Keyboard Shortcuts navigation. The compiled CLI reuses that authority; general playback/queue/provider mutations remain planned. Disable/quit removes only its own discovery file; restart rotates the token.

## Verification and Remaining Work

Muted isolated Electron rehearsals cover hidden preview, launch bumper, gap advancement, Stop/restart fences, concurrent Play, Previous, display placement and readiness timeout/retry. Actual-account native KaraFun Windows playback was verified separately in 0.6.0, muted and without touching the original show. Source tests do not establish new installers or audible output. Latest delivered package evidence is in the installation guide.

Physical mixer/speaker output, external-monitor hot-plug, device loss, full-song timing, real phones, supported-platform installations and long shows remain acceptance gates. Native CDG rendering, LRC playback, key/tempo, richer intermission policies, accounts/roles, general API mutations and billing remain planned. Preserve one authority, verified media and deliberate recovery as these are added.
