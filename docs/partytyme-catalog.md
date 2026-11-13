# Party Tyme Catalog Search

Updated 13 November 2026. Party Tyme search uses the public catalog linked as **View Song Catalog** on [Party Tyme's official website](https://www.partytyme.com/): [the published catalog](https://www.partytyme.com/Party_Tyme_Pro_update.htm). This is an HTML metadata source, not a documented consumer search API. The app's provider-search interface searches its bounded in-memory snapshot.

The source publishes exact HD codes, title, artist, language, duration and other metadata. The read-only investigation returned 44,967 recording rows in an 8,325,378-byte UTF-8 table, including releases dated 13 November 2026. These counts describe that observation, not a permanent catalog size or a completeness guarantee.

## Host Behavior

Party Tyme catalog search does not require account credentials or a subscription. Results show **Party Tyme** and remain **search only**. They cannot be queued, downloaded or played by this adapter. The recording's HD code is retained for exact identity. **View at provider** opens the public catalog; a supported per-track player deep link has not been established.

The first search loads the public table. Later queries reuse the snapshot for 24 hours, and concurrent requests share one fetch. A failed refresh retains an existing snapshot with an explicit older-cache message. Failed initial loads produce an error rather than an empty successful search. Further attempts wait 15 minutes after a failure. This cache lasts for the current app process only; no credentials or catalog database are written by the adapter.

## Developer Contract And Limits

`src/main/partytyme-catalog-client.ts` requests only the fixed official HTTPS catalog URL, with redirects disabled and no cookies or Authorization header. It limits responses to 24 MiB, parsing to 60,000 recording rows, and each query to 50 results. Parsing yields to the event loop regularly. Exact expected headings, field bounds, duplicate codes and complete row/table markers are checked. Changed or malformed pages fail clearly; source HTML is not forwarded to the renderer. The endpoint is an observed public publishing format and can change without notice.

The owner's Party Tyme credential file was not read or transmitted for this public-metadata approach. An unqualified request to the old bare player host redirected to Muvika; no account information was sent to that destination. The official linked player path remains under `player.partytymeplayer.com/partytyme/karaoke/`. Player-vendor API access is separately advertised on [Party Tyme's professional offering](https://www.partytymeplayer.com/partytyme/site/?page_id=2345); no API partnership, account portability or playback integration is established by this catalog search.

Fixture tests cover exact identity/projection, Unicode/entity handling, invalid and changed tables, duplicate/active content, daily single-flight reuse, result bounds, failed-refresh fallback, timeout and provider-body redaction. No provider media, signed playback URL, subscription or account mutation is involved.
