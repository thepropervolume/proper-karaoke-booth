# Shared Karaoke Nerds catalog

Ordinary Song Library search uses the shared catalog when enabled. A new installation can use the public, read-only service at `https://apps.thepropervolume.com` without a private connection file or a bundled API key. Searches read the shared database snapshot; they do not call the upstream Karaoke Nerds feed. Linode III runs the upstream updater with a minimum 24-hour interval between attempts. Freshness remains unknown until the first successful refresh.

The public service routes are `GET /v1/catalog/public/status` and `GET /v1/catalog/public/tracks`. Private configured hosts retain the authenticated `/v1/catalog/status` and `/v1/catalog/tracks` routes. Both use the same bounded JSON contract and exact case-sensitive YouTube recording identity. Public requests contain no authorization header, browser cookies, provider keys, database password, or local media path. Server rate limits apply.

## Linux setup and recovery

Earlier installers omitted both the private catalog connection and the old local snapshot. Those installations fell back to an absent local snapshot and showed unavailable results. The current default uses public shared search instead. Existing explicitly selected private configurations retain their authority: an invalid, missing, denied, or unreadable selected file produces a configuration/access error, without silently changing to public results.

An existing default `catalog-connection.json` in the application data folder remains private configuration. On Linux, it must belong to the desktop user and have no group/world access (`chmod 600 /path/to/catalog-connection.json`). A private file copied with mode `0644` is rejected. In Sources or Preferences, check the connection and replace the private file if necessary. Do not put the upstream Karaoke Nerds key or a database login in the desktop connection file.

## Offline behavior and authority boundaries

The client stores up to 100 successful bounded search pages in an at-most-20-MiB cache. Public and private caches have separate scopes and files. Previously saved searches can be used on transient outages; new queries need a service connection. Cached results show their age. Unauthorized, forbidden, malformed, and incompatible replies do not become offline successes.

The 0.10.6 reader checks the database revision before reloading the full catalog. Exact artist and verified brand filters use in-memory indexes. Existing text matching and pagination continue to use the same published revision. The read path never calls the upstream feed.

In 0.10.13, desktop Song Library and Sources → Karaoke Nerds offer more results for shared and local catalog searches. Connected singer rooms continue fetching Karaoke Nerds matches when a singer taps **Load More Songs**. Changing the query starts a new search, and a catalog change can require restarting an earlier page sequence.

Changing credentials or configuration scope fences in-flight results from the old authority. Unsaved connection checks use separate status clients and cannot replace the active search authority or clear its offline queries. For integration, use `SharedCatalogConnection.publicSearch(query)` and `.publicStatus(active)` for the explicit public mode; preserve `.search(path, query)` and `.status(path, active)` for private mode. An unsaved public status check passes `active = false`.

Linux installation, physical venue networking, and long-show operation still require checks on the intended host. A public catalog connection does not grant paid-provider playback or establish rights to a linked recording.

On 12 November 2026, the live Windows Node client passed token-free public status and an actual catalog search with no private configuration, then retrieved that saved search after a client restart with a deliberately isolated network outage. This verifies the deployed public contract and scoped cache, not a new Linux installer or physical venue connection. The reusable check is `npx tsx scripts/shared-services-live-smoke.mjs /private/qa-rating.json`; its separately authenticated ratings checks use a synthetic recording and clear their QA vote.

The actual Electron app subsequently passed the same reader-free discovery path in an isolated profile: public artist/title search returned results through the host service boundary, and those results appeared in the ordinary Song Library search UI. `scripts/song-ratings-integration-smoke.mjs` covers that path alongside synthetic-media ratings. It does not copy the development host's catalog-reader file or use its normal application profile.
