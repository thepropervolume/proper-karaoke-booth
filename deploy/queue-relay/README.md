# Remote singer relay deployment

## Internet singer screen

The queue relay can serve a separate, read-only viewer at `https://booth.thepropervolume.com/<room>/screen`. The host explicitly starts sharing from an active internet room and distributes the full link, including its private fragment. The viewer receives short-lived still frames from the singer display. Audio plays at the venue.

Issue a dedicated `tpv-booth-screen` certificate for the booth hostname. Stage `apache-booth-screen.conf` as a separate HTTPS vhost and `booth-screen-systemd.conf` as a drop-in for `tpv-queue-relay.service`. Install `tpv-booth-screen-cert-reload` as an executable deploy hook for this certificate lineage. The Apache allowlist and the relay independently restrict this hostname to the viewer page, its script, and authenticated frame reads. The queue hostname retains existing room and host endpoints.

Back up the current bundle and test the new vhost with `apache2ctl -t` before reloading. With the updated relay running, use `curl --resolve booth.thepropervolume.com:443:127.0.0.1` at the origin to check TLS, `/<room>/screen`, unauthenticated frame rejection, and denial of non-viewer routes. Only then point the proxied Cloudflare record at the relay. Check a synthetic share through public HTTPS and confirm stopping sharing revokes frame access. Keep the existing queue origin healthy throughout verification.

## Mobile web and native clients

Version 0.9 adds `https://queue.thepropervolume.com/app/`. Build with `npm run build:mobile`; install only the resulting `dist/mobile` directory, root-owned and unwritable by the runtime, as `/opt/tpv-queue-relay/mobile/`. Install `mobile.conf` at `/etc/apache2/tpv-queue-mobile.conf` and include it in the HTTPS vhost before the catch-all proxy. The static allowlist rejects dotfiles/build manifests and includes the app shell, fonts, icons and fixed public YouTube player. Keep its origin referrer policy: a no-referrer override can cause YouTube error 153. Never serve the repository, native signing material or credentials as the web root.

`TPV_QUEUE_MOBILE=yes` enables bounded same-origin catalog search, nearby suggestions and temporary mobile-host capabilities. The catalog adapter reads the existing public snapshot on fixed loopback port 8765; the service's localhost-only IP sandbox remains in force, and no upstream Karaoke Nerds feed call is made. Mobile owners use a reserved UUID namespace, one reserved slug each and a maximum 50 reservations within the existing 200 total. The store retains configured owner IDs explicitly; expired anonymous owner rows are removed only after both lease and open tombstones have expired. No database migration or new credentials are required.

Version 0.10.12 adds cursor paging to the Karaoke Nerds browsing route and public KaraFun and Party Tyme Pro metadata search. Run `scripts/public-provider-catalog.ts` as a separate loopback worker on port 8768 with `tpv-public-provider-catalog.service`. Build it with `npx --no-install esbuild scripts/public-provider-catalog.ts --bundle --platform=node --format=cjs --outfile=release/public-provider-catalog.cjs`. Install the bundle in `/opt/tpv-queue-relay`, owned and writable by root only. The worker uses fixed public provider endpoints and receives no provider credentials. The existing relay keeps its loopback-only network sandbox.

Update the relay bundle with the companion client so new room catalog fields reach updated singers. Legacy clients receive the original fields. Before restarting, verify there are no live rooms. Test disconnected Karaoke Nerds cursors, public KaraFun and Party Tyme Pro metadata, and a desktop host’s source-aware search and request cycle. The public metadata route leaves host sign-in, playback and queue authority on the host.

Before restart, check for live rooms and avoid interrupting a show. Back up the existing bundle, static files and configuration to a new private rollback directory, verify disposable MySQL tests, check Apache syntax, then atomically install the reviewed bundle/static files and restart the relay. Confirm health, catalog results, headers, a complete mobile-host/singer queue cycle and old-generation revocation. Keep rollback assets and all existing database credential exports. Native deployment requires the public player at this exact HTTPS path; store signing and device tests are independent of static deployment.

These assets serve `https://queue.thepropervolume.com` through an isolated relay
on loopback port 8766. The desktop remains authoritative for show state, guests,
queue changes and command receipts. The server's separate MySQL schema `tpv_queue_relay` contains relay
lease metadata; its backup is not a show backup. The website and shared catalog
retain their independent configurations.

## Files and private owner configuration

Install the trusted Node executable from `/opt/tpv-karaoke-catalog/node` as
`/opt/tpv-queue-relay/node` using a copy, not a symlink. Install the tested bundle
as `/opt/tpv-queue-relay/queue-relay.cjs` and the fixed singer build as
`/opt/tpv-queue-relay/web/`. The directory and assets must be root-owned and
unwritable by the service: directories 0755, assets/bundle 0644, executable 0755.
Install `backup-leases.sh` executable and `verify-restore.py` beside the bundle.

Create root-owned mode-0700 `/etc/tpv-queue-relay`. Generate an owner UUID and a
cryptographically random high-entropy owner token privately. The root-owned
mode-0600 `owners.json` contains **only the token hash**:

```json
{"owners":[{"id":"OWNER-UUID","tokenSha256":"SHA256-HEX-OF-OWNER-TOKEN"}]}
```

Use lowercase 64-character SHA-256 hex. Keep the plaintext token only in a
separate root-owned mode-0600 client configuration export for secure transfer to
the authorized desktop. Never put it in argv, chat, repository files, invitation
URLs, renderer storage or request logs. Leave old owner records in place until a
reviewed credential change is required; deleting a record revokes that owner's
future authentication. Restart the service to reload a changed owners file.

`tpv-queue-relay.service` uses DynamicUser, private state and runtime directories,
and systemd credential loading. Its owner hash configuration is copied as
mode 0400 into the private runtime directory to satisfy strict private-file
checks on systems whose credential mounts use mode 0440. Persistent metadata is in MySQL over `/run/mysqld/mysqld.sock`. The runtime
account has SELECT/INSERT/UPDATE/DELETE only on `tpv_queue_relay`; the service
cannot create tables or write code/web assets. Runtime MySQL credentials are
loaded through systemd and copied into the same private runtime directory as
mode 0400 files.

## MySQL provisioning and migrations

Run `python3 provision-db.py --apply` as root only after reviewing the assets.
It creates a new isolated `tpv_queue_relay` schema and three accounts through root
socket authentication, preserving the existing owner registry and host exports:

- `tpv_queue_runtime`: SELECT, INSERT, UPDATE, DELETE.
- `tpv_queue_migrator`: runtime privileges plus CREATE, ALTER, INDEX, REFERENCES.
- `tpv_queue_backup`: SELECT, SHOW VIEW, TRIGGER, used only for private dumps.

All grants escape underscores and apply only to this schema. Passwords and role
`.cnf` files are root-owned mode 0600 under `/etc/tpv-queue-relay`. Client options
are in `[client]`; `database=tpv_queue_relay` is in `[mysql]`, so `mysqldump` does
not receive an unsupported database option. The separate `db-managed.json`
manifest tracks database files only. `--check` verifies account identities,
exact privileges and managed file hashes without altering them. Unknown existing
schemas/accounts, conflicting DB files and incomplete `.db-provisioning` state
are refused; inspect failures privately rather than deleting state and retrying.
No generated credential is printed and `owners.json` is never overwritten.

Apply the bundle's explicit MySQL schema initialization/migrations using the
migrator credential before starting the runtime service. Keep the shared
`/run/lock/tpv-queue-relay/database.lock` locked for DDL, just as the backup script
does. Keep the migrator credential out of the runtime unit and desktop builds.
The service must fail closed on missing/incompatible tables rather than creating
them with its runtime account. No production file database is used.

## Service and TLS activation

1. Verify the bundle and assets, owner configuration, provisioned MySQL schema,
   environment contract and installed Node version. Install the service and backup units into
   `/etc/systemd/system/`, and tmpfiles configuration into
   `/etc/tmpfiles.d/tpv-queue-relay.conf`. Create the private backup directory.
   Verify units and reload systemd, without enabling services yet.
2. Start the relay locally and confirm it listens only on `127.0.0.1:8766`.
   Check exact Host/Origin guards, owner authentication, guest authentication,
   slug lease isolation, duplicate/replayed commands, disconnected-host behavior,
   body/connection/rate limits and static asset path restrictions. The server
   must accept exactly one valid `X-TPV-Client-IP` only from the loopback proxy.
   Direct tests can use proxy trust disabled or explicitly supply that header;
   never add trust for arbitrary external forwarding headers.
3. Obtain a separate certificate lineage `tpv-queue` for
   `queue.thepropervolume.com` using the existing private Certbot Cloudflare DNS
   configuration. DNS A/AAAA records are managed by the PC owner; certificate
   issuance makes only the temporary ACME TXT changes. Preserve the catalog
   certificate and its renewal hook.
4. Install `tpv-queue-cert-reload` as executable root-owned
   `/etc/letsencrypt/renewal-hooks/deploy/tpv-queue-cert-reload`. It reloads Apache
   only for `/etc/letsencrypt/live/tpv-queue`, after a successful configuration
   check. Certbot's existing timer handles renewal scheduling.
5. Enable the required Apache modules, including `remoteip`. Install
   `apache-queue.conf` as `010-tpv-queue-relay.conf`; do not replace or reorder the
   existing catalog's first TLS deny vhost. Run `apache2ctl configtest` and
   inspect `apache2ctl -S` before reloading. The queue vhost serves only the exact
   hostname; other hostnames retain the existing deny fallback or website vhost.
   HTTP queue access is denied without a token-bearing redirect.
6. Verify HTTPS externally through Cloudflare and direct-origin tests, including
   invalid Host/Origin, spoofed forwarding headers and invalid tokens. Verify
   that catalog access and unknown-host denial still work. Test desktop show
   creation and singer join/request through the public hostname before enabling
   the relay at boot. Do not claim physical-device verification from local tests.

The proxy forwards every path to the relay. The relay itself must whitelist
routes and serve static assets exclusively from the configured immutable web
root. Apache preserves Host and Origin so the application can enforce exact
public origin. Both layers enforce bounded input. Access logs contain only time,
status, elapsed time and response size; error output for this vhost goes to
`/dev/null`. Application journals must remain free of tokens, bodies and request
URLs. Browser secrets belong in headers/bodies or invitation fragments, never
query strings; remove invitation fragments from browser history after reading.

## Trusted client addresses through Cloudflare

The queue vhost uses `CF-Connecting-IP` through `mod_remoteip`, trusting only
Cloudflare's published IPv4/IPv6 networks. These directives are vhost-local and
must never become a global unbounded trust setting. Late request-header edits
remove incoming `X-TPV-Client-IP`, `Forwarded`, `X-Forwarded-*` and Cloudflare IP
headers, then set exactly one `X-TPV-Client-IP` from Apache's verified
`REMOTE_ADDR`. Direct-origin clients retain their actual socket IP even if they
send spoofed forwarding headers. The loopback relay must never be exposed on a
public interface. Owner/session limits remain necessary alongside IP limits.

The checked-in range list was read from Cloudflare's official
[IPv4 list](https://www.cloudflare.com/ips-v4) and
[IPv6 list](https://www.cloudflare.com/ips-v6), following its
[visitor IP restoration guidance](https://developers.cloudflare.com/support/troubleshooting/restoring-visitor-ips/restoring-original-visitor-ips/).
Review later changes against those sources before updating and reloading; do
not download and activate unreviewed lists automatically. Apache documents the
[trusted proxy boundary](https://httpd.apache.org/docs/2.4/mod/mod_remoteip.html)
and [late request-header processing](https://httpd.apache.org/docs/2.4/mod/mod_headers.html).
If Cloudflare Pseudo IPv4 is configured to overwrite headers, adjust that setting
with the DNS owner before relying on IP limits; this proxy does not use arbitrary
client-supplied fallback IP headers.

## Lease metadata backup and recovery

The daily root backup service uses only the dedicated read-only MySQL backup
credential at `/etc/tpv-queue-relay/backup.cnf`. It creates a transaction-consistent
InnoDB dump with `mysqldump`, verifies gzip integrity, publishes it atomically
without overwriting another file, and retains 14 snapshots. Files are root-owned
mode 0600 under `/var/backups/tpv-queue-relay`; backup and DDL share a private
lock. Stored routines and events are excluded. Dumps contain lease metadata,
never authoritative show queues or plaintext owner tokens. A valid gzip file
alone does not establish recoverability.

Before enabling the timer, stop the relay, run the installed backup service once,
and run `python3 /opt/tpv-queue-relay/verify-restore.py --apply`. The drill requires
an inactive relay, restores the newest private dump into a new disposable schema
through a temporary account restricted to that schema, and compares DDL, row
counts and all lease contents to the unchanged source. The temporary schema and
account are removed afterward. No live schema is overwritten. If a stale backup
is selected, the comparison fails; take a new dump after stopping the relay.

After the actual dump/recovery drill succeeds, restart the relay and enable its
daily backup timer. Verify that process restart or restored lease metadata never
resumes a host connection, guest session, pending request or autoplay. A real
restore requires stopping the relay and reviewing the target, ownership and
schema version separately; the verification helper intentionally cannot restore
over the live schema. Arrange off-host copies separately if these leases must
survive server loss. Losing relay metadata must leave the desktop's existing
local show usable.

## Booth mobile accounts

Booth accounts use a separate `tpv_booth_accounts` database. The room lease schema,
desktop show ownership, and website member database retain their existing roles.
Room nicknames, playlists, and account sessions remain separate. The service stores
a normalized email, display name, salted scrypt password verifier, and hashes of the
temporary verification and session tokens. Account links expire after 30 minutes
and work once; sessions expire after 30 days. Password reset revokes old sessions
and outstanding account links. Lookups, sign-in attempts and mail are rate limited.

One-time setup on Linode III:

1. Keep the existing relay secrets and install the reviewed `booth-accounts.sql`
   and `provision-booth-accounts.py` beside one another. Run the provisioning
   script with `--apply` through root's MySQL socket. It creates only the Booth
   account database and runtime grant, reuses the verified sender from the private
   website staging mail configuration, and writes account credentials under
   `/etc/tpv-queue-relay` without printing them. A failed apply leaves a marker for
   private operator inspection and never replaces credentials.
2. Install `scripts/booth-account-mail.py` into `/opt/tpv-queue-relay/` and the
   private `tpv-booth-account-mail.service` into `/etc/systemd/system/`. The
   adapter uses the existing Google Workspace relay with verified STARTTLS over
   IPv4 and accepts only token-authenticated loopback traffic. Configure sender and
   envelope addresses on the same TPV domain. Start the unit and keep the queue
   relay itself restricted to localhost egress.
3. Install `booth-accounts.conf` as a queue relay service drop-in. Stage the
   reviewed relay and mobile web builds. Before restart, check for active rooms
   and preserve the current bundle, static app, and configs in a private backup.
   Restart only when idle. Confirm guest routes, Apache syntax, and
   `GET /v1/mobile/account/status` with `{"enabled":true}`, then verify actual
   email delivery during an account owner’s authorized test.
4. Keep the Booth account schema in the private database backup policy. It is
   independent of the existing queue lease dump. Protect account backups as
   user data. When retiring this beta feature, disabling the config and sidecar
   preserves the account data for a verified restore.

The HTTPS relay accepts credentials only on `/v1/mobile/account/` routes.
Native clients can use the app's fixed webview origins; room APIs keep their
previous origin policy. Email links carry the one-time proof in the fragment of
`https://queue.thepropervolume.com/app/?account=1`. Keep this public app path deployed with
matching link redemption. On iPhone and Android, users can paste the link into
Booth or verify in the browser and return to Booth to sign in with a password.