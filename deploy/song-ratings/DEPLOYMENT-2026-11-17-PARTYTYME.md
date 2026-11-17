# Party Tyme Rating Identity Deployment

17 November 2026, Linode III. The existing ratings service now accepts exact `partytyme:consumer:<numeric video ID>` keys alongside the existing namespaces. This changes validation only; the MySQL schema, votes, account roles and credential files are unchanged. Catalog, queue and website services were not deployed or restarted for this change.

Service source: `e398605`. The deployed `/opt/tpv-song-ratings/song-ratings-service.cjs` has SHA256 `4866d6dcbcbb807e799fdb3143fe6b9b3d6232dcc45df34f0cb912088d9cbacf`. The previous bundle, SHA256 `2abaa2c4ff64f7466fa616fbd060b4dfb1b2f5bbe930abf0fc6bad220291aa9d`, is retained under `/var/backups/tpv-song-ratings/code/partytyme-091-20261117T215440Z`. The installer checked the previous identity before replacing it atomically and restarted only `tpv-song-ratings`.

Verified the active service and new-namespace lookup, then used the separate existing QA voter to set three hearts, replace them with nine and clear that vote. The owner's voter was not used. Public HTTPS lookup subsequently returned the expected key with zero count and no own vote. Environment and QA credential bytes were unchanged. No database migration, credential rotation, account provisioning or retained test vote was required. The ignored local receipt is `release/partytyme-ratings-deployment-091.json`.
