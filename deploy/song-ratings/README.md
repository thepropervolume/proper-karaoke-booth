# Shared song ratings service

Ratings use their own MySQL schema (`tpv_song_ratings`) and loopback API on port
8767. The catalog reader keeps SELECT-only access to its existing catalog;
ratings credentials grant no catalog, relay or website access. Public aggregates
and authenticated per-voter writes belong to this separate API. Individual voter
tokens and raw voter identities must never appear in public aggregate responses.

## Provision and initialize

Review these files, then run `python3 provision.py --apply` as root. Root socket
authentication creates a new MySQL schema and three localhost-only accounts:

- `tpv_sr_runtime`: SELECT, INSERT, UPDATE, DELETE.
- `tpv_sr_migrator`: those privileges plus CREATE, ALTER, INDEX, REFERENCES.
- `tpv_sr_backup`: SELECT, SHOW VIEW, TRIGGER for private dumps.

Database-level grants escape underscores. No account receives global grants,
remote access or privileges on other schemas. The provisioner creates root-owned
mode-0600 passwords, `production-runtime.cnf`, `production-migrator.cnf`,
`production-backup.cnf`, `production.env` and `managed.json` under root-owned
mode-0700 `/etc/tpv-song-ratings`. MySQL defaults put shared options in `[client]`
and `database=tpv_song_ratings` in `[mysql]`, so `mysqldump` does not receive an
unsupported database option.

The requested private database credential export is
`/etc/tpv-song-ratings/tpv-song-ratings-db-credentials-2026-11-12.json`, also root
0600. Its shape is `{schemaVersion,database,socket,accounts}`, with separate
runtime/migrator/backup `{username,password}` entries. Treat it as a server
credential export; it is not the desktop voter configuration and must not be
included in a desktop build or chat.

`provision.py --check` verifies managed file hashes, account identities and exact
grants without changing them. Recognized reruns preserve voter exports. Unknown
existing schemas/accounts, conflicting files and incomplete `.provisioning`
state are refused. Inspect incomplete state privately instead of deleting it
and blindly retrying. No credential values are printed.

Bundle the operator entrypoint `scripts/song-ratings-db.ts` as
`/opt/tpv-song-ratings/song-ratings-db.cjs`. Before starting the runtime, initialize
and check the schema under the migrator account and shared migration/backup lock:

```sh
set -a
. /etc/tpv-song-ratings/production.env
set +a
export TPV_RATINGS_MYSQL_USER=tpv_sr_migrator
export TPV_RATINGS_MYSQL_PASSWORD_FILE=/etc/tpv-song-ratings/migrator.password
umask 077
flock /run/lock/tpv-song-ratings/database.lock \
  /opt/tpv-song-ratings/node /opt/tpv-song-ratings/song-ratings-db.cjs init
flock /run/lock/tpv-song-ratings/database.lock \
  /opt/tpv-song-ratings/node /opt/tpv-song-ratings/song-ratings-db.cjs check
```

The runtime validates its schema and fails closed rather than running DDL. Keep
that same `database.lock` locked for every later migration. Do not reuse catalog
or relay tokens for ratings.

## Provision one voter

After schema initialization, run `python3 provision-voter.py`. It generates a
random 32-byte voter token, stores only its SHA-256 bytes in `voters.token_hash`,
and creates `/etc/tpv-song-ratings/host-rating.json` as root 0600:

```json
{"baseUrl":"https://apps.thepropervolume.com","token":"PRIVATE-VOTER-CAPABILITY"}
```

Transfer this file privately to the intended desktop. The token is a capability
for that voter, not proof of a unique human or a global administrator. A second
voter requires a separate export, e.g. `--name second-host-rating.json`. Reruns
verify/reuse the existing export and enabled voter; they do not rotate its token
or re-enable a disabled voter. If an earlier attempt wrote the export but failed
before registration, a rerun registers that same token without replacing it.
An unexpected duplicate token never updates another voter. Plaintext exists
only in the private client export; the API authenticates against hash-only DB
records. Backups include the registry hashes and votes, not plaintext exports.

## Install and verify the service

Install a trusted Node executable as `/opt/tpv-song-ratings/node` (a reviewed copy
of the existing catalog Node binary is available), and the tested bundle as
`/opt/tpv-song-ratings/song-ratings-service.cjs`. Install the operator bundle
`song-ratings-db.cjs` there as well. Keep the directory root-owned 0755, the binary
0755 and bundles 0644. Install `backup-ratings.sh` executable
and `verify-restore.py` beside the bundle. Install units into
`/etc/systemd/system/` and tmpfiles configuration into
`/etc/tmpfiles.d/tpv-song-ratings.conf`; validate and reload systemd without
enabling timers yet.

The service uses DynamicUser and a private mode-0700 runtime directory. systemd
loads `runtime.password`, then copies it as mode 0400 before Node starts; this
works with strict private-file checks even when credential mounts use mode 0440.
Only the MySQL runtime credential enters this process. Binding is loopback-only;
network access is restricted to localhost. The unit passes the
`TPV_RATINGS_MYSQL_SOCKET`, `TPV_RATINGS_MYSQL_DATABASE`,
`TPV_RATINGS_MYSQL_USER`, `TPV_RATINGS_MYSQL_PASSWORD_FILE` and
`TPV_RATINGS_PORT` environment contract.

Start the new service locally, then verify public aggregate reads, missing/bad
voter authorization, duplicate/edit/delete behavior, disabled-voter rejection,
transactional totals and recording-identity validation. Test that runtime DDL
and access to other schemas fail. Keep tokens out of argv, URLs, logs and browser
renderer storage. Native clients keep their private voter file outside the build.

The service validator accepts exact `karafun:catalog:<song ID>` and
`karafun:community:<song ID>` identities in addition to the existing YouTube and
SHA-256 identities. Deploy the updated service bundle before enabling KaraFun
ratings in desktop clients. The existing `recording_key` column already fits;
no database migration, voter reprovisioning or vote rewrite is required. Verify
the new namespaces with a separately provisioned test voter and clear only that
voter's test votes. Never use the host's personal voter for deployment checks.

Version 0.9.1 also accepts `partytyme:consumer:<numeric video ID>`. This is a
consumer recording identity, not a Pro HD code. The compatible validator was
[deployed and checked on 17 November](DEPLOYMENT-2026-11-17-PARTYTYME.md), with no
SQL change or retained QA vote.

The existing `apps.thepropervolume.com` certificate covers this API. Add only
the agreed ratings routes to that exact Apache vhost, pointing at 8767; keep
catalog routes on 8765 and preserve the default TLS deny vhost. Preserve Host
and enforce the exact public Host/Origin policy in the application. Strip all
incoming forwarding headers and overwrite one `X-TPV-Client-IP` from Apache's
verified `REMOTE_ADDR`; the service may trust it only from loopback. Apps DNS
currently points directly to this Linode, so the socket peer is authoritative.
If Cloudflare proxying is introduced, use only its reviewed published proxy
ranges in this vhost before accepting `CF-Connecting-IP`. Never trust arbitrary
client `X-Forwarded-For`. Apply bounded global/IP limits to public reads and
additional voter limits to writes; voter provisioning remains an operator task.
Logs must omit paths/queries, request bodies, credentials and voter identifiers.

Use Apache configuration validation and a graceful reload. No relay service
restart, room invalidation, provider refresh, DNS change or website activation
is part of this rollout. Verify catalog access and existing queue rooms after
the route change. Keep the prior ratings bundle and exact vhost configuration
available for rollback; do not drop ratings data when rolling back code.

## Backups and recovery

The daily timer runs at 07:00 UTC, using only the dedicated backup account.
`backup-ratings.sh` creates a transaction-consistent InnoDB dump, verifies gzip
integrity, publishes atomically without overwrite and retains 14 private dumps
under `/var/backups/tpv-song-ratings`. It excludes stored routines/events. A dump
or gzip check alone does not prove recovery. All files are root 0600 in a root
0700 directory; the private lock coordinates backups and schema migrations.

Before enabling the timer, stop only the ratings service, take a fresh dump with
its backup service, then run `python3 /opt/tpv-song-ratings/verify-restore.py
--apply`. It restores into a new disposable MySQL schema using a temporary
account restricted to that schema and compares DDL, row counts and canonical
contents, including binary voter hashes. The live schema is never overwritten.
The disposable schema/account are removed afterward. The source must remain
unchanged during comparison; use a fresh dump after stopping ratings if a stale
dump fails comparison. Catalog, relay and websites remain running.

After the actual dump/restore drill passes, restart ratings and enable its backup
timer. Keep private voter client exports and the server credential export under
separate secure backup procedures; a DB dump contains neither plaintext file.
Arrange off-host copies and repeat recovery drills independently. A real restore
requires an explicit reviewed target and a stopped ratings writer; never use the
verification helper to overwrite live data. Database rollback must preserve the
meaning of voter revocation and prevent old credentials from being re-enabled.
