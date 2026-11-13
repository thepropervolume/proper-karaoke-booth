# Sunfly Store Metadata Search

Research and client prepared 13 November 2026. This is a public **store** metadata source, separate from Sunfly's protected streaming API, subscriptions and issued access keys. Version 0.4.3 wires it into Song Library and Sources; Windows installer and installed-app checks passed, while Linux 0.4.3 AppImage/Debian package checks passed from the same frozen runtime, including 52 focused tests and actual search/CLI/profile-clear checks. It remains search-only.

## Verified Public Route

The current [Sunfly store](https://www.sunflykaraoke.com/karaoke-/) publishes its WordPress REST root in the ordinary search configuration. The live [route index](https://www.sunflykaraoke.com/wp-json/) lists the public WooCommerce Store API operation `GET /wc/store/v1/products`, including `search`, `sku`, `page` and `per_page` arguments.

An explicit GET for `search=Our Song&per_page=5` returned HTTP 200, a JSON array of five products, and pagination headers reporting seven store matches across two pages. Product metadata contains the numeric store product ID, title, exact `SF…` SKU, categories and official product permalink. The same API queried with `search=Anne-Marie` returned zero results: artist search is **not verified** and must not be promised.

The linked [Our Song product page](https://www.sunflykaraoke.com/karaoke/anne-marie/our-song/) publishes a JSON-LD object typed as both `Product` and `MusicRecording`, containing the exact SKU `SF1124621`, title `Our Song`, artist credit `Anne-Marie & Niall Horan`, ISO duration `PT0H2M44S`, and additional music metadata. Artist display text comes from that structured field, never from a URL slug. Store product IDs and SKUs have not been mapped to the protected API's recording IDs or to subscription availability.

## Client Behavior And Limits

`src/main/sunfly-store-catalog-client.ts` exports `searchSunflyStoreCatalog(query)` and a testable `SunflyStoreCatalogClient`. Results use provider `sunfly`, label **Sunfly Store**, namespaced IDs such as `store:100`, and the exact provider SKU. Their message explicitly identifies first-page store title/SKU search and unavailable playback. They do not become playable library versions or queue entries.

The client returns at most five first-page individual karaoke songs. It filters out album/bundle/merchandise and backing-only products using the observed product kind, song/karaoke categories and individual-song SKU pattern. It does not claim to expose the complete Sunfly catalog. An exact `SF…` query uses the Store API's SKU filter; ordinary text uses its search field.

For up to five songs, at most two product-detail pages load concurrently. Enrichment requires the JSON-LD SKU, title and canonical product URL to match the search record exactly. Unavailable, ambiguous or mismatched detail metadata leaves artist/duration unknown rather than inventing credits or reusing another recording's data. The plain title, namespaced identity and official product link remain usable as store metadata.

Only fixed official HTTPS API/product paths are requested, with redirects denied and no cookies, Authorization header, credentials, cart operation or playback request. Each response is capped at 512 KiB; the complete query has a deadline. Results are projected to metadata fields, never provider media paths or raw HTML.

The running-process query cache holds at most 32 entries for five minutes, with one-minute failure caching. The separate detail cache holds at most 128 entries for 24 hours; failed detail enrichment is cached briefly. Concurrent identical queries and detail requests are coalesced. No persistent catalog, credentials or media are written. Store HTML/schema and public API availability can change, so failures stay explicit.

Protected catalog synchronization and playback remain separate: [Sunfly's partner API](https://api.sunflykaraoke.com/) states that its endpoints require credentials and account-specific metadata arrangements. Public store access does not establish those permissions, entitlement, SDK access or media rights.

Fixture coverage includes safe projection, exact identity cross-checks, unknown artists, album filtering, SSRF/redirect refusal, cache reuse/eviction, bounded input/body sizes, provider failures and late timeout responses.

The Linode verification host could read the public Store API but received HTTP 403 for the product-detail page. Artist/duration were explicitly unknown there; the same exact SKU enriched successfully on the Windows test connection. The client does not bypass that refusal or infer artist names from URL slugs.
