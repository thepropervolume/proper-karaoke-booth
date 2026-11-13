# KaraFun Web And Catalog Investigation

Read-only investigation on 13 November 2026. The owner authorized inspecting their account and supplied the path to a private credential file. Credential values, session keys, signatures, cookies, client keys and account identifiers are deliberately excluded from this document and the repository.

## Observed Consumer Web API

The normal [KaraFun Web player](https://www.karafun.com/web/discover/) loads discovery, search, queue, transport and sign-in controls. This is separate from the Business management API previously checked with HTTP 402/403 responses.

The owner's supplied `GET https://api.karafun.com/search/top` request was replayed successfully: HTTP 200, XML rather than JSON, containing search sections and community suggestions. This verifies that particular consumer search request, not a general unauthenticated API contract, complete song search, or subscription playback. Do not copy the example's session or signature into application source or assume it will stay valid.

The publicly delivered web client references separate session-open/session-info, song-info, song-lyrics, song-request and several search operations. Session opening includes client configuration and account credentials; subsequent requests use session context and timestamped request signatures. Discovery of route names does not grant a playback entitlement. No request-signing code, client credential or private session is shipped by this update.

A normal website sign-in form submission using the private account file returned a redirect to `/web/`, without a remaining sign-in form. Cookies were held only in the short-lived probe process. This did not independently establish the account's active playback entitlement. No subscription, device, queue, playlist or payment was modified; no media, decryption key or playback licence was obtained.

## Search Milestone: Public Official Catalog

The [official catalog-download page](https://www.karafun.com/karaoke-song-list.html) exposes a full CSV with stable recording IDs, titles, artists, explicit-content flags and languages. The captured catalog contained **90,284 records**; that count is an observation, not a freshness guarantee.

Version 0.4.2 searches this official metadata through the desktop's main-process catalog service. It discovers the CSV link on the catalog page, accepts only the expected same-origin link, bounds network/parse work, rejects incomplete or malformed snapshots, and caches a complete snapshot for up to 24 hours in the running app. Failed refreshes retain an older complete public snapshot with a visible warning. Restart loses this in-memory cache; persistent/central provider snapshots remain future work.

This implementation needs no account login, consumer session key or paid API access. Each result retains the exact KaraFun ID and is labelled **KaraFun / Search Only / Playback Pending**. It cannot enter the show queue or the local playable library. Provider-issued account linking and playback remain separate work.

KaraFun's [OEM offering](https://business.karafun.com/oem) advertises supported existing-user login and user-linked subscription entitlements. The owner's inquiry is already pending; do not submit another on their behalf or assume the Business token or ordinary account password grants OEM access. Confirm the supported playback/authentication route before a playable provider is announced.

See [service catalog setup and limits](provider-catalog-search.md), [Business API findings](karafun-business-api.md), and the [remaining work list](remaining-work.md).
