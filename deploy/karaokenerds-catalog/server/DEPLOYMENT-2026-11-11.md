# Shared catalog deployment — 11 November 2026

## Sole updater handoff on 23 November 2026

Checked the managed Windows workstation, its Debian WSL instance and Linode
III for a scheduled legacy updater. Staged the supplied credential privately
and enabled the Linode refresh timer against the existing 64,261-record
snapshot. The service returned `not-due` at startup and left the snapshot,
revision and unknown attempt and success timestamps intact. The first upstream
attempt becomes eligible at 03:42:37 EST on 24 November 2026. The first
eligible hourly timer check makes the request. No upstream fetch was made during
the handoff.

## Reader update on 20 November 2026

Deployed the revision-checking reader from `5833192` when the queue relay reported zero active rooms. The updated service returned 64,261 searchable records at revision 1. Public HTTPS exact-artist and text search found Nada Surf’s “Amateur”. The reader bundle SHA-256 is `9a29f723756feb77b07303daabdac20eabac6b9e86dd0797062dbd3be314bd24`. The previous reader bundle is preserved at `/var/backups/tpv-karaoke-catalog/reader-0106.xGo30jrO`. The schema and saved snapshot are unchanged, and the upstream refresh timer remains disabled.

The Linode III server now runs the authenticated catalog at
`https://apps.thepropervolume.com`. Both `/v1/catalog/status` and
`/v1/catalog/tracks` require the scoped catalog bearer credential. The desktop
receives this credential through a private configuration file; database and
provider credentials are not distributed to clients.

The dedicated MySQL 8 schema `tpv_karaoke_catalog` contains the recovered saved
snapshot: **64,261 records, all searchable**. Validated artist/title text and exact
YouTube IDs are preserved. Brand codes remain available; a verified brand-page
slug is unknown and represented by an empty string. Searches match all query
terms across artist and title. The show, queue, media and playback databases
remain local to the booth application.

The original SQLite catalog and its refresh history have not been recovered.
Read-only seeding therefore preserves `lastAttempt`, `lastSuccess` and retirement
state as unknown, rather than inventing timestamps. This is a working read
service, not a completed transfer of provider refresh authority.

- Reader service is enabled at boot, bound only to loopback port 8765 behind TLS.
- The existing Linode cloud firewall now also allows inbound TCP 443 on IPv4 and
  IPv6. SSH, the default inbound drop policy and outbound rules were preserved.
  Windows live HTTPS status/search and durable offline query reuse passed.
- MySQL remains bound to loopback; separate reader, writer, migrator and backup
  accounts have privileges only on the catalog schema.
- Daily private backups run at 06:30 UTC and retain 14 successful dumps locally.
- An actual backup was restored to a temporary schema through a separate
  restricted account. Schema, all table contents, snapshot hash, revision and
  refresh state matched, and temporary objects were removed.
- The refresh service/timer are installed but **disabled**. No provider credential
  or activation gate is installed. The database also rejects refresh before
  network access while its attempt history is unknown.
- Existing website databases and website virtual-host activation were preserved.

Validation covered real MySQL import/seeding, authenticated HTTPS and certificate
checks, pagination, unknown brands, multiword artist/title search, invalid tokens,
methods, routes, limits and Host isolation. Request access logs omit URLs and
credentials. Per-vhost Apache error output is discarded; sanitized service
startup/failure messages remain in the system journal.

Before enabling provider updates, recover/reconcile the former refresh history,
independently stop every former updater, establish one refresh authority and
follow the reviewed migration/activation procedure. Do not fill in NULL attempt
times or reset an interval to force a refresh. Local backups still need a separate
off-host destination to cover loss of this server.
