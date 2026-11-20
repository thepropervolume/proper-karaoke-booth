# Booth release server

The release workflow sends verified packages to a restricted SSH command on the release server. Apache serves completed versions and the latest downloads page from `public`. Use the [release runbook](../../docs/releasing.md) for the CI workflow and download URLs.

## Server layout

Install Python 3 and a Node.js runtime compatible with the release scripts. Create a dedicated account with a valid shell for SSH forced commands and a private home directory. The account needs write access to `incoming` and `public`. Keep the state root and installed code owned by the server administrator. Use one filesystem for both state directories so that publication can rename a completed version into place.

| Location | Owner and access |
| --- | --- |
| `/opt/tpv-booth-releases/` | Administrator, readable by the publisher |
| `/srv/tpv-booth-releases/` | Administrator, mode `0755` |
| `/srv/tpv-booth-releases/incoming/` | Publisher, mode `0700` |
| `/srv/tpv-booth-releases/public/` | Publisher, mode `0755` |

Copy the two publisher scripts and the page generator with their required layout:

```text
/opt/tpv-booth-releases/
  release-command.py
  publish-release.mjs
  scripts/
    release-artifacts.mjs
    render-downloads.mjs
  assets/branding/web/icon-180.png
```

Add a dedicated CI deploy key to the publishing account's `authorized_keys` with a forced command and SSH restrictions. The default Node path on Linode III is `/opt/tpv-song-ratings/node`. To use another runtime, append `--node /absolute/path/to/node` to the forced command.

```text
restrict,command="/usr/bin/python3 /opt/tpv-booth-releases/release-command.py" ssh-ed25519 <CI public key>
```

The Cloudflare DNS-only CNAME `release.thepropervolume.com` resolves to `apps.thepropervolume.com`. Install [the Apache virtual host](apache.conf) on Linode III with the existing `tpv-booth-releases` certificate. Install [the download hub](release-index.html) as `/srv/tpv-downloads/public/index.html`. The vhost mounts the existing Booth release directory at `/booth/` and the Studio release directory at `/studio/`.

The download pages and stable aliases are publicly readable. Each publisher maintains its own hidden `.latest.map`. Booth versionless `/booth/latest/` aliases redirect to `/booth/vVERSION/`. Legacy `/latest/`, `/vVERSION/`, and `/archive/` links keep working. The alternate `/boothl/` path redirects to the canonical Booth path. Test Apache configuration before reload, then verify anonymous GET and HEAD for both products and the legacy routes.

## Verification and recovery

Each transfer is a flat USTAR archive for one platform or the planning documents. The server reads the same filename allowlist as the package verifier. It keys batches by workflow run, attempt, version and source commit. The final job requires every desktop, mobile and planning batch and runs the package, planning and checksum verifier against the staged files. It creates the checksum manifest, writes the downloads pages, then moves the complete version and latest page into place. Repeating `publish` for the same version and commit can repair a missed latest-page update. Published version contents keep their original hashes.

A failed upload leaves no completed batch for that platform. Attempts expire after 24 hours and are cleared by the next release command. Staging is limited to 8 GiB and preserves 5 GiB of free filesystem space. Publication keeps the five newest verified download sets. Before older installers are pruned, their release history and available notes and metadata are retained for browsing at `/archive/vVERSION/`, without links to removed installers. Pruning and index/redirect updates must run under the same publication lock; do not follow symlinks or delete outside the release root.

The private publisher umask also applies to newly created archive directories. The publish step explicitly sets the public archive root and validated version directories to mode `0755`. During a release check, verify anonymous GET for an older archive and confirm that its retired installer returns HTTP 404.

On Linux, run `python3 deploy/booth-downloads/test-release-command.py -v` with Node on `PATH` to exercise a complete scratch publication. The tests also cover mixed attempts, conflicting commits and rejected commands and archive paths.
