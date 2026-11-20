# Public queue search and singer screen deployment

On 20 November 2026, Linode III replaced the 0.10.1 relay with 0.10.3 and refreshed the public singer and mobile web assets. The host approved the restart. The follow-up booth configuration ran after the active room count returned to zero. No database migration was required.

`queue.thepropervolume.com` reports 0.10.3. The proxied `booth.thepropervolume.com` record uses a dedicated `tpv-booth-screen` certificate and Apache vhost. It serves the viewer page, script and authenticated frames. The queue host remains the destination for owner commands and singer requests.

The public QA room contained 66 synthetic versions, including one hidden source. The test verified a match beyond the first 50, all 65 visible matches over two pages, legacy paging, and access revocation when the room closed. Chrome independently verified search and loading the second page. A generated JPEG verified private frame delivery through the booth hostname, missing and incorrect credential rejection, and revocation on stop. The QA room closed. Physical desktop capture and venue network performance were outside these checks.

The installed relay bundle SHA-256 is `1d3d7cd61f7460da41b7300226020b8394d188e286ea3e18559b1bacdd6c8920`. Private rollback copies are under `/var/backups/tpv-queue-relay/code/queue-0103.ZpxfvCHg` and `/var/backups/tpv-queue-relay/code/booth-screen.uOi4jUXc`. The latter contains the 0.10.3 relay from before the booth origin was enabled.

## 0.10.5 follow-up

The public relay and mobile/singer assets were updated to 0.10.5 from `7a9379b7d04b61f575052eaba9ec597cf5985a38` with zero active rooms. Chrome confirmed that the singer page showed a prepared request as **Queued** and enabled successful withdrawal before playback. The live check also exercised public catalog search and the private viewer. After the disposable test, the relay database reported zero active leases and the public health endpoint reported 0.10.5.

The current relay bundle SHA-256 is `20789f86fb982ac2d07b3fa768fb59dce311170527064d6c2813dffcff159831`. The private rollback copy is `/var/backups/tpv-queue-relay/code/queue-0105.YL9JhM14`.

## 0.10.6 follow-up

Updated the relay, singer page, and mobile web app from `64a2395470f72fbe5cf3dd23627e56e16a836336` after confirming zero active rooms. The live mobile asset matched the candidate build. Separate Chromium host and guest profiles verified video storage, queue protection, removal through reload and relink, and the new photo review. The guest could request a song while a photo waited. Approval displayed it and awarded 24 points. Both disposable rooms were closed and verified offline, and the final guest lost access on room closure.

The relay bundle SHA-256 is `7290530b7457c1e18af8297cf58294bc362f8e260d69acf1323d8f9e9d6b53ed`. The rollback copy is `/var/backups/tpv-queue-relay/code/queue-0106.Hw4AZlr4`. Real-phone and native external display tests remain open.

## 0.10.7 follow-up

Updated the relay, singer page, and mobile web app from `b002f4470cb7ffde1b53f090fc7b0f2b34a17201` after checking for active rooms. HTTPS reported 0.10.7 and the current mobile entry matched the tested build. The updated guest page recognizes desktop singer holds. Release tests cover hold behavior through the relay protocol, and an isolated Windows rehearsal verified the host flow after a schema 7→8 upgrade.

The relay bundle SHA-256 is `1b4e079610958e0bd1616efef1c2548e7af20321569ecfbff31c0f0566d9eb0e`. The rollback copy is `/var/backups/tpv-queue-relay/code/queue-0107.lmMpclWL`.
