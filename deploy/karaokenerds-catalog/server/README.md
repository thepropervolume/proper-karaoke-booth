# Shared Karaoke Nerds catalog server

The optional public read routes are `GET /v1/catalog/public/status` and
`GET /v1/catalog/public/tracks`, with the same projected response and search
parameters as the private routes. Install `public-read.conf` as the documented
systemd drop-in to enable them explicitly. New desktop installations can use
these routes without a private reader configuration or any bundled token.
Public routes reject every supplied Authorization header; existing private
routes continue to require the existing reader credential. Public reads share
a 60-request burst bucket refilling at one request per second. Every 30 seconds
under traffic, concurrent searches share a primary-key catalog revision check.
The service reloads the full snapshot when the recordings change and indexes
exact artist and verified brand filters in memory. A failed revalidation makes
the service report unavailability. Paging remains tied to the snapshot revision.
Restart the reader after restoring an older database backup so it starts with a
fresh projection even if the restored database later reuses a revision number.

Ratings run in the separate service and schema documented in
[`../../song-ratings/README.md`](../../song-ratings/README.md). The catalog
reader remains SELECT-only and cannot provision voters or write ratings.

These are deployment assets, not an installed service. They use a dedicated MySQL
schema (`tpv_karaoke_catalog`), authenticated read-only loopback service on port
8765, and exact-host HTTPS at `apps.thepropervolume.com`. Website schemas and
website migration virtual hosts are independent. No provider URL or key is in
these files. Reader/updater service users are isolated dynamic systemd users;
MySQL accounts and private files are separate for reader, writer, migrator and
backup roles. systemd credentials are copied into each service's mode-0700
runtime directory as mode-0400 files, satisfying the application's owner-only
private-file checks even on systems where credential mounts use mode 0440.
Runtime copies are removed when the service stops.

## Prepare and provision

1. Review these files, the service/operator bundle being deployed, and the existing
   certificate. Confirm `apps.thepropervolume.com` DNS points to the intended
   machine. The certificate paths below already exist on the inspected server.
2. Install a trusted Node executable as `/opt/tpv-karaoke-catalog/node`, and tested
   current bundles as `catalog-service.cjs` and `catalog-operator.cjs` in that
   directory. The Node executable at
   `/opt/tpv-catalog-synthetic-rehearsal/node-v24.15.0-linux-x64/bin/node` is an
   available local source; verify the intended version/artifact before copying.
   Keep this directory and all executable/bundle files owned by root, with
   directory mode 0755, executable mode 0755, and bundle mode 0644.
3. Install `verify-refresh-gate.py` there, and the existing
   `../db/backup-catalog.sh` as `backup-catalog.sh`, executable and root-owned.
   Copy the supplied units to `/etc/systemd/system/` and the tmpfiles file to
   `/etc/tmpfiles.d/tpv-karaoke-catalog.conf`. Installation alone must not enable
   either timer. Run systemd unit verification and `daemon-reload`.
4. Run `python3 provision.py --apply` as root. It creates a new schema and accounts
   through root MySQL socket authentication, generates private credentials under
   `/etc/tpv-karaoke-catalog/`, and prepares backup/lock directories. No credential
   is printed. `--check` validates a managed rerun without altering accounts.
   Unknown preexisting schemas/accounts, changed private files, extra grants,
   unsafe ownership and incomplete `.provisioning` state are refused. Inspect
   incomplete state privately; do not delete the marker and blindly retry.

Private `production.env` contains only socket/database settings. Load it into the
root operator environment, then use the required role and private password file:

```sh
set -a
. /etc/tpv-karaoke-catalog/production.env
set +a
export TPV_KN_MYSQL_USER=tpv_kn_migrator
export TPV_KN_MYSQL_PASSWORD_FILE=/etc/tpv-karaoke-catalog/migrator.password
flock /run/lock/tpv-karaoke-catalog/production.lock \
  /opt/tpv-karaoke-catalog/node /opt/tpv-karaoke-catalog/catalog-operator.cjs initialize
```

Root/migrator access is for operators only. Desktop applications receive only the
catalog bearer credential through their private client credential file. Do not
put MySQL credentials, provider credentials or bearer tokens in chat, argv,
repository files, URLs, renderer storage, or desktop settings JSON.

## Seed and verify before serving

The current PC source contains the saved real snapshot with 64,261 records, but
its original SQLite cooldown database has not been found. Use the operator's
`seed-readonly` operation to load that saved snapshot without an upstream call.
Select the writer account/password and the private input path:

```sh
export TPV_KN_MYSQL_USER=tpv_kn_writer
export TPV_KN_MYSQL_PASSWORD_FILE=/etc/tpv-karaoke-catalog/writer.password
export TPV_KN_RAW_SNAPSHOT_FILE=/absolute/private/path/to/saved-snapshot.json
export TPV_KN_REFRESH_DISABLED=yes
/opt/tpv-karaoke-catalog/node /opt/tpv-karaoke-catalog/catalog-operator.cjs seed-readonly
```

Verify the snapshot checksum and record count. This mode must leave
`last_attempt_ms`, `last_success_ms` and
`sqlite_retired_ms` NULL: freshness and the original request cooldown are unknown.
It permits read-only serving while the updater remains disabled. Label that
unknown freshness clearly to clients. Do not invent a successful fetch time or
set a retirement/cooldown value merely to make refresh run.

If the original SQLite database is recovered, stop and verify all old refresh
jobs on every machine, retire its updater, and export the existing snapshot with
its last-attempt cooldown, including failed or interrupted attempts. Transfer
the export privately. Preserve the original snapshot and export checksum. A
full migration must follow the operator's import rules and must not overwrite
an already seeded live database; use a reviewed migration or a fresh isolated
schema if required.

Select the writer account/password in the operator environment, set
`TPV_KN_SQLITE_EXPORT_FILE` to the absolute root-only export path and
`TPV_KN_LEGACY_UPDATER_STOPPED=yes`, then run the operator's `import` command in
the fresh schema intended for that full migration.
Use its `status` command to compare record count and refresh state to the export.
The writer cannot create or alter tables. Keep all DDL under the same
`production.lock` used by backups.

Start only the reader service and test authenticated tracks/status, unauthenticated
rejection, response projection, pagination and offline client fallback. Its
bearer token is `/etc/tpv-karaoke-catalog/service.token`; use a private HTTP client
configuration or code that reads the file rather than exposing it in shell args.
The service must support both `/v1/catalog/tracks` and `/v1/catalog/status`.

After local verification, review/install `apache-catalog.conf` as
`000-tpv-karaoke-catalog.conf`, enable its listed modules, run `apache2ctl
configtest`, inspect virtual-host order, then reload Apache. The first TLS vhost
must be the supplied deny fallback. The existing disabled
`000-tpv-migration-default-ssl.conf` also claims `apps`; leave it disabled and
update future website migration instructions to avoid enabling both. Preserve
existing website configurations and their activation state. Only the catalog
hostname and its two exact routes may reach the reader. Unknown hosts and other
paths are denied. This configuration adds no HTTP virtual host or token-bearing
redirect; existing HTTP behavior is independent. Request logs contain
only timestamp, response status and duration; this vhost sends error messages
to `/dev/null` to avoid query/header leakage. Service lifecycle errors remain in
the systemd journal without request details. Verify HTTPS externally, including
wrong hostname, wrong token, malformed path/query, and non-GET methods, before
enabling the reader at boot.

## Backups and restore

Run the installed backup service once and restore that dump into a disposable
schema. Compare schema, row counts, snapshot hash and all cooldown/attempt state.
Use a separate restricted restore account; never restore over an active catalog
or run migrations concurrently. Only after that drill, enable the daily backup
timer. It uses `production-backup.cnf`, creates private gzip dumps, keeps 14
production backups and skips stored routines/events. Read `../db/README.md` for
limitations. Arrange off-host copies and recovery checks separately; a local
dump does not survive loss of this server.

## Enable the single updater only after verification

Verify which machines or jobs made upstream requests and stop the other
updaters before the new timer starts. Transfer the upstream URL privately to
root-owned mode-0600 `/etc/tpv-karaoke-catalog/upstream.url`. Create the
root-owned mode-0600 `refresh-enabled.json` in the same directory.
For a migrated catalog with verified attempt history, use:

```json
{"legacyUpdatersStopped":true,"importAndCooldownVerified":true,"singleUpdaterConfirmed":true}
```

For a serving snapshot created with `seed-readonly` and no recoverable attempt
history, use a seeded handoff:

```json
{"legacyUpdatersStopped":true,"singleUpdaterConfirmed":true,"seededHandoff":{"seedSha256":"<existing seed checksum>","quiescenceVerifiedAtMs":0}}
```

Replace the checksum with the protected seed marker from `tpv_kn_state` and
replace the example timestamp with the current MySQL server epoch time in
milliseconds after verifying the other updaters are stopped. The updater
requires 24 hours of quiet time after that observation. It checks the saved
snapshot under the existing database lock and leaves unknown attempt and success
timestamps empty until a real request. Use the installed gate checker and run
the service during the hold to confirm it reports `not-due` and the first
eligible timestamp before enabling its timer.

The gate checker is an operator attestation; it cannot discover other machines.
The updater still refuses an uninitialized catalog and relies on the database's
durable cooldown and cross-process coordination. Its timer wakes **hourly**; that
is not an hourly provider request. The database permits at most one provider
attempt per rolling 24 hours, including failed attempts. Hourly wakeups avoid
missing an entire day when a refresh finishes slightly after a daily timer slot.
Interrupted attempts require an operator to stop the interrupted updater and use
`recover-refresh`; do not reset cooldown timestamps to force a retry.

Install the private upstream file and gate, verify the gate manually, and only
then enable the timer. Test coordination/cooldown with synthetic upstream data
first. Do not manually run a real refresh merely to test deployment. Deleting
the gate and stopping/disabling the timer immediately prevents scheduled work;
stop any already-running refresh separately before recovery or migration.
