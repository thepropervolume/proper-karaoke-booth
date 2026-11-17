# Party Tyme Consumer Account Playback

Development 0.9.1 adds an experimental desktop connection to the consumer **Party Tyme Karaoke Premium** service. This is separate from **Party Tyme Pro**, whose public catalog was already searchable. Their accounts and recording IDs are not interchangeable. A consumer connection does not establish Pro or commercial hosting rights or a player-vendor partnership.

## Connect and use

Open **Sources → Party Tyme → Connect Party Tyme…** and choose your private credentials file. It can contain one `username:password` line, or a JSON object with `username` (or `email`) and `password`. Do not place it in the repository or an installer. The app reads it only in the main process and sends the normal login request only to the official consumer service. The existing file is retained. A conventional interactive provider sign-in window remains a usability follow-up.

An accepted session is remembered using the computer's protected credential storage when available; the password is not copied into that saved session. A fresh account check is required after restarting. Linux will not remember a session using Electron's insecure plaintext fallback; connect for the current launch if a real desktop keyring is unavailable. **Sign Out** forgets the remembered session and stops provider playback.

Use the global search, right-click a Party Tyme result and choose **Add to Queue**, or double-click it. Singer assignment is optional for host requests. The normal queue, automatic staging, preparation progress, Play/Pause, seek, Previous, volume and singer display apply. The source label is **Party Tyme**, with its existing amber result border. **Prepare Song / Retry** is available on saved Party Tyme results and in Sources. While connected, the unified list uses authenticated consumer results instead of the separate search-only Pro export.

The host prepares an account-scoped MP4 in private app storage. This is playback preparation, not a permanent library export or licensed offline feature. Every start and resume checks the current account and recording again; cached bytes do not grant access. A disconnected, expired, non-Premium, blocked or unsupported recording cannot start. Other local and online sources continue to work independently.

Consumer recordings are mixed videos with embedded lyrics. This path does not supply KaraFun-style separate vocal stems, key/tempo processing, Pro account support or mobile paid-provider playback. No DRM is removed. The current path accepts only provider-returned non-DRM progressive MP4 content after a real Premium check. Provider contracts, platform coverage and commercial permissions still need confirmation before representing this as an approved distribution partnership.

## Verified on 17 November 2026

The owner's saved login was accepted by the consumer service with Premium permission. The Pro web player separately rejected it; that was an account-system mismatch, not evidence that the consumer password needed replacing. The owner does not need to answer the earlier account-type question to continue this connection.

An isolated, muted Windows Electron rehearsal passed actual Sources connection, protected session persistence, global search, common result context menu, optional-singer queueing, video preparation, 1280×720 decoding and playback-clock advancement for Oasis **Wonderwall** (258.07 seconds). Restart restored sign-in and left the show paused; explicit Play reauthorized the cache. Signing out paused the performance and refused cached resume. The disposable profile was removed; the original credential file, owner show and Dropbox mirror were untouched. This verifies the beginning of one recording, not full-song listening or venue hardware. Ignored evidence is in `release/partytyme-live-091.json` and its screenshots.

Focused automated tests cover normal form encoding, changed account and blacklist checks, exact identity, atomic requests, non-Premium/expired refusals, encrypted-session handoff, malformed provider data, safe media locations, incomplete/cancelled downloads and cache tampering. These are separate from physical audio/display acceptance. Seek, automatic completion, long shows and additional real recordings should also be exercised with the QA workflow.

## Implementation and service contract

- `src/main/partytyme-account.ts` reads public web configuration from the fixed official site, authenticates through `api-ott.partytymestreaming.com`, validates current permissions, searches exact consumer video IDs and obtains the provider's normal embedded-player descriptor. It parses a narrow progressive-source literal without evaluating remote JavaScript. No private player-vendor key is embedded.
- `src/main/partytyme-host.ts` owns short-lived search receipts, show-policy checks, transactional queue plans and background preparation. The renderer selects an issued receipt rather than supplying media URLs or arbitrary metadata.
- `src/main/partytyme-media.ts` follows only the inspected Kaltura playback hosts, bounds video size and transfer duration, checks MP4 format and file hashes, and publishes completed files with no authentication token in their metadata. Cache entries are scoped to an opaque account identifier.
- The verified original artist comes from the provider's **Made Popular By** credit. Its `meta.actors` field contains songwriters and must not be used as the original artist.
- Consumer IDs use `{provider: "partytyme", catalog: "consumer", videoId}` and global rating keys `partytyme:consumer:<video ID>`. They do not collide with Pro HD codes, local fingerprints or KaraFun IDs. The [shared ratings validator deployment](../deploy/song-ratings/DEPLOYMENT-2026-11-17-PARTYTYME.md) passed public lookup and separate QA vote/update/clear checks, with no SQL migration or retained test vote.
- Desktop **schema 6** marks the new saved source identity; no SQL column change is needed. The version marker is transactional. Back up before upgrading; an older binary refuses schema 6, and downgrade requires the pre-upgrade backup. Session files, preferences and media need their own protected backups.

The integration was observed through the official [consumer website](https://www.partytymestreaming.com/), its linked client resources and authenticated normal account responses. These web interfaces can change without notice and are not a promised third-party API contract. The separate [Pro page](https://www.partytymeplayer.com/partytyme/site/?page_id=2345) advertises a player-vendor API; it does not establish this project's partner access or transfer a consumer subscription to Pro.

## Manual acceptance case

On a backed-up test profile, connect the consumer account, find a known song and confirm its artist, queue with no singer, wait for Ready, and press Play. Check sound, lyrics and video fit through a whole recording. Pause, seek forwards and backwards, use Previous, then test automatic transition to a second song. Restart the app and verify no unexpected audio. Resume explicitly, sign out during playback and confirm it stops and cannot resume from cache. Repeat with an expired or non-Premium test account when one is available. Record the platform, build, network and whether sound was actually heard. Do not use a production show to test interruptions.

Remaining improvements include an interactive sign-in flow, aggregate cache management/eviction, broader platform/device acceptance and confirmation of provider integration and hosting terms. The existing [QA test guide](qa/qa-test-guide.md) covers the wider application in plain language.

The opt-in real-provider rehearsal is `node scripts/partytyme-live-smoke.mjs /absolute/path/to/private-credentials-file`. It creates a separate muted profile, uses the actual account without a provider mock, checks seek/Previous and sign-out fencing, and removes only its own disposable profile. Run `npm run build` first. The source launcher reports its Electron runtime version in the UI; installer identity is verified separately. The normal test suite uses synthetic data and never reads that file.
