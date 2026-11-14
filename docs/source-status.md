# Karaoke Source Status

Reviewed 14 November 2026 for source development **0.5.0**. Package verification is recorded separately in [installation](installation.md). A searchable catalog, a consumer subscription and permission to integrate playback are different capabilities.

| Source | Current TPV capability | Access and remaining work |
| --- | --- | --- |
| Local MP4 | Import files/directories, search, queue and local playback. Source-less heart votes stay in the host database. | Media must remain readable. Physical codecs/output/device-loss checks remain open. |
| MP3 + CDG / single-pair ZIP | Convert paired assets into managed MP4 using the chosen silent lyric backdrop, then use the normal library/queue. | Requires external FFmpeg. Broader producer fixtures and real lyric/audio synchronization need verification. |
| LRC | Timed-lyric parsing and VTT conversion foundations are integrated. | Full LRC import, backdrop rendering, seek/resume and playback are not implemented yet. |
| Karaoke Nerds | Shared artist/title metadata discovery, exact YouTube identities, saved-query offline reuse and queued permanent acquisition through yt-dlp. | The recovered 64,261-record snapshot is searchable. Freshness, retirement state and upstream refresh history are unknown; automatic upstream refresh is disabled. Bulk brand/artist subscriptions remain planned. |
| YouTube | Bounded karaoke/video/channel filtering, approved-only mode, channel blocklists, Takeout subscription import and the ordinary singer-selection/request/download flow. | yt-dlp and FFmpeg are installed separately. Filters and artist/title suggestions are heuristics. Availability and download success vary by recording. The app does not access the private subscriptions feed or extract browser cookies. |
| KaraFun | Official public metadata catalog search, plus an implemented optional external KHost companion bridge for search/handoff to a separately installed KHost. | Native TPV subscription linking/playback is not connected. The owner reports their separate KHost subscription login/playback works; authenticated TPV bridge use on the target machine remains unverified and does not grant OEM access. |
| Party Tyme | Public metadata search. | Player-vendor API access, eligible account linking and playback are unconfirmed. |
| Sunfly | Public Store title/SF-SKU search, plus a separate fixture-tested protected catalog adapter. | Store coverage is limited; missing artist/duration stays unknown. Partner credentials, approved playback SDK and a quote are pending. |
| Stingray | Fixture-tested partner catalog adapter and private-profile selection. | No real developer key or playback entitlement is confirmed. Its November 12 reply directs us to commercial partnerships. |
| Google Drive | A locally synced, fully readable directory can use ordinary custom-directory import. | The proposed shared Drive folder is not an application source connector yet; remote indexing, account access and managed acquisition remain unfinished. |

## Provider Correspondence

The connected TPV Gmail account was searched for relevant provider replies. The only substantive reply found was **Stingray on November 12**, explaining that API access is offered through commercial partnerships. This search does not cover dashboard-only correspondence or other mail systems.

With the owner's authorization, four messages were successfully sent from **ben@thepropervolume.com** through the connected TPV Gmail account on **November 14**:

- **KaraFun:** follow up on OEM content/playback access, existing-subscription linking, the observed Business API HTTP 402/403 responses, SDK/platform support and all fees/minimums.
- **Stingray:** reply to Luke in the existing support conversation and request an introduction to the commercial karaoke API team, pilot access, eligible account models and pricing.
- **Sunfly:** request Protected API v2 access, its Node/Electron SDK, the advertised trial and a licensing/subscription quote.
- **Party Tyme:** request the player-vendor API contact, documentation/trial access, eligible subscriptions and partnership/offline terms.

Sending these messages does not establish approval, credentials, a purchase or a contract. Private email bodies, ticket-routing addresses and credentials do not belong in this repository. Record a subsequent provider response here after reviewing it.

## Official Integration Routes

- [KaraFun OEM](https://business.karafun.com/oem) describes partner content/playback APIs and existing-user subscription entitlements. Eligibility for the owner's particular subscription and Electron/OS support still need confirmation. The Business room/device management token is a separate integration; its earlier 402/403 responses do not prove content access.
- [Sunfly API and content licensing](https://api.sunflykaraoke.com/) offers an SDK for Node/Electron on request, a 30-day API/content trial, and subscriptions per venue or customer. New integration guidance points to Protected API v2. Pricing is quoted, not established by the consumer subscription price.
- [Party Tyme's professional/player-vendor page](https://www.partytymeplayer.com/partytyme/site/?page_id=2345) advertises an API for player vendors. Its public monthly Pro offer is $49.99, above the owner's under-$20/month per-additional-service target. The page also lists a separate 48-hour offer; that is not a monthly API plan. No approved integration has been confirmed within the target budget.
- [Stingray API delivery](https://www.stingray.com/streaming-distribution/formats/api-delivery/) is the commercial route identified in its reply. Catalog and media documentation alone do not provision a partner account.

## KHost Findings and Boundary

The [independent KaraFun plugin](https://github.com/ezhalden/KHost.Plugins.KaraFun/blob/9abc10886597cd6e182cd4e1792979a0a5bdabac/docs/how-it-works.md) demonstrates an external application's consumer sign-in, search, acquisition and lyric/stem playback path; it is not an official OEM SDK. Its documented `.kit` container is unencrypted, so container parsing must not be misrepresented as DRM decryption. No private KaraFun endpoint was called during the repository review.

Subsequent private investigation confirmed normal website authentication for the owner's supplied account. It did not establish a native API session. An isolated official-web-engine probe timed out without stage markers; it is inconclusive, not a provider rejection. Native account/search/playback remain unfinished. The [native investigation](karafun-native-integration.md) records the technical route and exact proof boundaries.

[KHost core](https://github.com/riddlemd/KHost/blob/b397bdd8aa7a3c4e2a0ddced43567b3278424c6e/LICENSE) uses PolyForm Shield, while its public contracts/Common have separate MIT licenses. No explicit license grant was found for the separate KaraFun plugin. We have not copied the host/plugin implementation or its consumer-client identity/signing material. Although its README still describes plaintext credential storage, the inspected current provider code uses `GetSecretAsync`/`SetSecretAsync` and migrates its legacy cache into KHost's OS secret store. See the [source-based storage correction](karafun-native-integration.md#credential-storage-correction). The optional TPV companion plugin uses independently written code against public MIT contracts and leaves account sign-in, downloads and playback inside the separately installed KHost. Its exact package/setup and verification status belong in [the bridge guide](khost-bridge.md).

The external relay was our interim choice, not a demonstrated requirement. The [native integration investigation](karafun-native-integration.md) separates an independently implementable consumer session/media path from unresolved TPV client identity, direct code-reuse permission and actual provider/account verification. Official OEM outreach continues in parallel. Native TPV sign-in and playback are not yet verified; external search/handoff must never masquerade as a playable TPV queue record. Confirm applicable distribution, entitlement and reporting terms before treating a technical proof as an approved commercial integration.
