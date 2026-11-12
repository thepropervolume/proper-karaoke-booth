# Ratings and public catalog deployment, 2026-11-12

Server portion for development client 0.4.0, supplied as a narrow source delta
to the PC app chat. Existing catalog contract remains version 1. No upstream
provider requests were made and the upstream refresher remains disabled.

Public catalog GET routes and ratings lookup/vote routes are live on
`https://apps.thepropervolume.com`, behind the existing exact-host TLS vhost.
The catalog service binds only `127.0.0.1:8765`; the new ratings service binds
only `127.0.0.1:8767`. The catalog process retains its existing SELECT-only
account. Ratings use isolated MySQL database `tpv_song_ratings` and three
localhost-only roles, verified to have no global/other-schema grants.

`tpv-song-ratings.service` is enabled at boot. Its daily backup timer runs at
07:00 UTC and retains 14 root-only dumps. Configuration recovery snapshots and
the previous catalog bundle/vhost are retained privately. Rollback code and
routes without dropping ratings data. The catalog's public-read drop-in is
separate from its unchanged managed credentials and environment file.

Protected owner client configuration: `/etc/tpv-song-ratings/host-rating.json`.
Separate QA configuration: `/etc/tpv-song-ratings/qa-rating.json`. Each contains
only `{baseUrl,token}`; the token grants that one voter. The three-role private
database export is
`/etc/tpv-song-ratings/tpv-song-ratings-db-credentials-2026-11-12.json`.
All are root-owned mode 0600 under a mode-0700 directory, outside source,
packages, renderer state and chat. Earlier catalog/website/relay exports remain
unchanged. Transfer using the existing protected SCP workflow.

Validation completed:

- 49 focused tests passed, including 11 real MySQL checks; strict TypeScript
  passed. Tests cover current-vote replacement/clear, exact identities,
  concurrency, rollback, credential rotation/revocation, scope projection,
  request limits, disconnected authentication and three-second slow bodies.
- Live runtime access to catalog/queue/website databases and DDL were denied.
- A real transaction-consistent dump with a saved QA vote was restored through
  a restricted disposable account. DDL, row counts and every canonical row,
  including binary credential hashes, matched. Temporary account/schema removed.
- Public HTTPS checks verified empty and populated lookups, reader-token denial,
  one current vote on repeated requests, update/clear, own-vote isolation and
  saved QA vote persistence across service restart. Only the separate QA voter
  was mutated; its test vote was cleared. No owner vote was written.
- Public catalog status reports 64,261 raw and searchable records. Existing
  private routes still reject missing credentials; public routes reject supplied
  credentials. Search returns only the approved catalog DTO.
- Catalog snapshot, revision, cooldown and credential hashes match the baseline.
  Relay process ID, restart count, owner/configuration hashes and vhost match
  the baseline. No queue restart or room invalidation occurred.

The app chat owns desktop integration, canonical product/help documents and
packaged 0.4.0 verification. This receipt establishes deployed backend behavior;
it does not claim a newly built desktop installer or hardware test.
