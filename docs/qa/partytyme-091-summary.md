# Party Tyme and QA Guide Verification

Reviewed 17 November 2026 for development 0.9.1. The separate [plain-language QA guide](qa-test-guide.md) covers the 0.9.0 baseline in language suitable for manual test execution. Its Word edition has seven visually reviewed pages, 15 scenarios and explanations of all 38 original findings. The guide preserves the distinction between fixed source, automated/browser evidence and unperformed phone or hardware checks. Ten document-generator tests passed, including independent step numbering for each scenario.

## Application verification

The final source suite passed **1,090 tests**, with **eight explicit platform/environment skips**, zero failures and 1,098 total checks. All **20 release-rule checks** passed. Root type checking, production build, mobile web build and 101 branding hashes passed. New tests cover credential encoding/privacy, accepted-session restore, expiry and non-Premium refusal, stale search selection, exact provider identity, blacklist/age policy, atomic optional-singer requests, each-start authorization, private CDN redirects, cancelled/incomplete preparation, cache tampering and transactional schema-6 upgrade recovery.

The real-account, muted Windows rehearsal used a disposable profile and the existing private credentials file. It passed consumer Premium sign-in, OS-protected session storage, unified library context menu, unassigned queue request, background preparation and actual 1280×720 video decoding for Oasis **Wonderwall** (258.07 seconds). It also passed seek to 60 seconds, Previous, pause, app restart without playback, explicit reauthorization of the cached recording, and sign-out pause/refusal. Only the beginning and selected positions were played; this is not full-song or audible output acceptance. The original credential file and owner show were not changed. Repeat using the opt-in [real-provider rehearsal](../../scripts/partytyme-live-smoke.mjs); normal automated tests never read private accounts. Ignored evidence is in `release/partytyme-live-091.json`.

The initial Pro login rejection was resolved by identifying the distinct consumer account system. The saved credentials work and do not need replacement for this path. A live metadata check also found that `meta.actors` lists songwriters; the parser now uses the provider's original-artist credit. No remote JavaScript is evaluated or DRM removed. An ordinary interactive sign-in window, Pro/mobile playback, cache management and wider platform/device acceptance remain follow-up work.

## Shared ratings

The compatible consumer recording namespace was deployed to the existing Linode ratings service. Public HTTPS lookup and the separate QA voter's three-heart vote, nine-heart replacement and clearing passed. Public lookup then showed zero votes. No owner vote, SQL schema, credential, catalog or queue service was changed. The [deployment receipt](../../deploy/song-ratings/DEPLOYMENT-2026-11-17-PARTYTYME.md) records source and bundle identities and rollback location.

## Planning documents

The canonical specification generated a 44-page Word edition and 51-page Night/Day mockup PDF. Root inspected changed Word pages 1, 17–20 and 37 and changed PDF pages 1, 3, 36 and 37 at full resolution. All were readable and within margins. The other 38 Word bodies and 47 complete PDF pages match the previously reviewed 0.9.0 images. All 44 final Word footers passed page-number and footer-band checks. The source and artifact hashes and page comparisons are retained under ignored `release/planning/planning-091-*.json`.

Installer checks, native build uploads, physical audio/monitors, real phones and distribution/hosting permission remain separate evidence. A passing source test or provider subscription does not complete those checks. Preserve a pre-upgrade backup: desktop schema 6 prevents an older binary from opening the new provider source format.
