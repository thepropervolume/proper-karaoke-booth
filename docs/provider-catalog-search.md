# Provider Catalog Search

Version 0.4.2 adds metadata search for KaraFun, Party Tyme, Sunfly and Stingray. It does **not** connect their subscription playback. Windows 0.4.2 setup/ZIP and the actual 0.4.1→0.4.2 upgrade are verified. Live public KaraFun/Party Tyme metadata search passed in both the packaged and installed app. Linux 0.4.2 package checks passed; no native macOS build is claimed. See [installation status](installation.md) for delivered artifacts.

## Host Workflow

1. Open **Song Library** and search for an artist or title with **All Songs** selected. Local matches appear immediately, Karaoke Nerds follows its existing search, and **Service Catalogs — Search Only** loads independently after a short typing pause.
2. Each service result shows its own service name alongside the artist, replacing the local DJ/brand-code position. These rows cannot be selected as playable songs, double-clicked into the queue, or added as local library versions. **View on Provider**, when available, opens an approved official page; it does not start booth playback.
3. Open **Sources → Third-Party Services** to see configuration status, search the service catalogs directly, or select a private Sunfly/Stingray provider profile. No account password or access key is entered into the renderer.
4. Disable **Preferences → Karaoke Services → Search service catalogs in Song Library** to stop this discovery. Save Preferences to apply the change. Local songs and Karaoke Nerds continue to work normally.

Service results appear only under **All Songs**. The library's local metadata review and content filters do not establish provider content coverage. The host authority also refuses all service discovery when the show is age-restricted or has a version allowlist, because these records have not been approved for that show. Changing the query, selected profile, enablement or policy hides obsolete results; late responses cannot replace the latest search. An unavailable service reports its own status without removing local or Karaoke Nerds matches.

## Available Catalogs

| Service | Metadata Source | What Is Verified | What Is Still Required |
| --- | --- | --- | --- |
| KaraFun | Its official [catalog-download page](https://www.karafun.com/karaoke-song-list.html) and linked public CSV. | The 13 November 2026 export parsed 90,284 records, preserving provider IDs, title, artist, language and the source's explicit-content advisory. Public metadata search needs no login or paid API plan. | Account linking, subscription entitlement, playback SDK/API, reporting, platform support and applicable usage rights. |
| Party Tyme | Its official [public catalog table](https://www.partytyme.com/Party_Tyme_Pro_update.htm). | The 13 November 2026 table parsed 44,967 rows. Search retains provider code, title, artist, language and duration where valid. Public metadata search needs no login or paid API plan. | Player-vendor access, account linking, subscription playback, reporting and applicable usage rights. |
| Sunfly | Its protected developer catalog API, with a provider-issued access key. | The desktop adapter is fixture-tested and searches only a complete, bounded catalog snapshot. | A real approved developer key and live schema/catalog validation. An ordinary Sunfly account password is insufficient. |
| Stingray | Its documented v1 device login and song-search API, with a provider-issued API-key profile. | The desktop adapter is fixture-tested for device authentication and metadata-only song search. | An issued API key and authorized device profile, plus live compatibility and account/usage validation. Consumer sign-in and the separately documented OAuth flow are not interchangeable with this profile. |

The record counts describe the inspected exports, not a promise that every recording is playable or available in a particular territory. Title/artist similarity does not merge recordings across services: each result retains its provider and provider-specific ID. A catalog row, explicit-content advisory or successful login does not establish a playback entitlement. Public searches do not read the owner's KaraFun or Party Tyme website credentials, reuse a Business management token, or reconstruct private web-player request signatures.

## Caching and Failures

KaraFun and Party Tyme fetch their public snapshots on demand and reuse complete snapshots for up to 24 hours **in the running app process**. Concurrent searches share a load. Refresh failures apply backoff rather than repeatedly fetching on each keystroke; an existing complete public snapshot can still be searched with an older-cache warning. A cold start without internet cannot recover those snapshots. They are not persisted to disk or copied to the shared MySQL catalog, and this is separate from Karaoke Nerds' durable saved-query cache.

Each public service returns at most 50 matches. Refine the artist/title phrase for a narrower result. Text searches are bounded and invalid input is rejected before network work. Authentication, rate limits, timeouts and malformed provider data produce a classified message without provider bodies, credentials or private file paths.

Sunfly's complete snapshot is cached in memory for up to 24 hours per validated profile and returns at most 20 matches. The adapter follows bounded catalog pages and handles withdrawal state before publishing results; an incomplete or timed-out scan returns no partial matches. Stingray searches the provider on demand and returns at most 20 projected matches. Its query is limited to 3–40 characters; Sunfly requires 3–128. Live partner-provider access remains unverified.

## Private Provider Profiles

Use **Choose Service Profile…** in Sources only after the provider issues developer access. The main process reads the selected file and stores its path in settings; it does not copy the credential into settings or return it to the renderer or singers. Keep the file in a private folder. Linux/macOS require current-user ownership and no group/other permissions; symlinks are rejected. Restrict Windows folder ACLs to the account that runs the app; the client does not verify Windows ACLs.

Stingray expects a UTF-8 JSON object with **only** these four fields, using provider-issued values:

```json
{
  "apiKey": "PROVIDER_ISSUED_API_KEY",
  "deviceId": "PROVIDER_APPROVED_STABLE_DEVICE_ID",
  "languageCode": "en",
  "countryCode": "US"
}
```

`languageCode` is `en` or `fr`; `countryCode` is a two-letter uppercase code. The API-key/device flow differs from Stingray's client-ID/client-secret OAuth inspector. See [Stingray operator details](stingray-catalog.md).

Sunfly expects a UTF-8 text file containing **only** the raw provider-issued access key, with an optional trailing newline. It does not accept an email/password pair or a JSON website account export. See [Sunfly diagnostics and catalog details](sunfly-account-status.md).

In `settings.json`, `providerCatalogEnabled` defaults to `true`. `providerCatalogProfiles` is a record with `karafun`, `partytyme`, `sunfly` and `stingray` keys, each defaulting to an empty path. The two public catalogs require no profile; use the native picker for partner services. A profile's presence means it is configured, not that its account or network access has been verified. Invalid files and rejected access remain explicit failures.

## Developer Boundary

The host renderer calls `getProviderCatalogStatus`, `searchProviderCatalog`, `chooseProviderCatalogProfile` and `openProviderCatalogSong` through host-only IPC. Search results contain projected metadata and `playbackAvailable: false`; they are not show versions or commands to play. Provider credentials, tokens, media URLs and licensing payloads stay outside the renderer and singer projections. Official external links are resolved from the latest search by provider/ID and checked against an HTTPS allowlist rather than accepting an arbitrary renderer-supplied URL.

The initial local control API/CLI does not yet expose provider search or connection mutations. No playback, media download, license acquisition, play reporting or subscription change occurs during catalog search. These capabilities need their own approved implementation and tests. Keep metadata discovery available independently from a future playable-provider adapter, and preserve local hosting during provider failures.

## 0.4.2 Verification Scope

Windows setup/ZIP use frozen runtime source `e501475`; the later `f7d4c4e` change affects only a QA helper. The full Windows suite passed 723 tests with seven skips, and type checking passed. Actual packaged and installed rehearsals checked live public KaraFun/Party Tyme search, explicit unconfigured partner states, search-only rows that cannot enter playback/queue, the saved search toggle, restored restrictive-policy guards and no autoplay. The app/setup executables contain all nine approved icon frames and all 69 branding hashes passed.

Before the actual Windows upgrade, a private backup was retained at `C:\tmp\tpv-karaoke-backups\before-0.4.2-20261113T180532Z`. All seven checked original show/configuration file hashes were unchanged afterward. These results do not verify live Sunfly/Stingray access, any paid-provider playback, physical show hardware or Linux 0.4.2 installation; Linux package checks passed; actual Linux installation remains unverified.
