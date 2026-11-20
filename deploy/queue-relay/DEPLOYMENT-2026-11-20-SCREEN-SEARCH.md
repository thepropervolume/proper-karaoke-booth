# Public queue search and singer screen deployment

On 20 November 2026, Linode III replaced the 0.10.1 relay with 0.10.3 and refreshed the public singer and mobile web assets. The host approved the restart. The follow-up booth configuration ran after the active room count returned to zero. No database migration was required.

`queue.thepropervolume.com` reports 0.10.3. The proxied `booth.thepropervolume.com` record uses a dedicated `tpv-booth-screen` certificate and Apache vhost. It serves the viewer page, script and authenticated frames. The queue host remains the destination for owner commands and singer requests.

The public QA room contained 66 synthetic versions, including one hidden source. The test verified a match beyond the first 50, all 65 visible matches over two pages, legacy paging, and access revocation when the room closed. Chrome independently verified search and loading the second page. A generated JPEG verified private frame delivery through the booth hostname, missing and incorrect credential rejection, and revocation on stop. The QA room closed. Physical desktop capture and venue network performance were outside these checks.

The installed relay bundle SHA-256 is `1d3d7cd61f7460da41b7300226020b8394d188e286ea3e18559b1bacdd6c8920`. Private rollback copies are under `/var/backups/tpv-queue-relay/code/queue-0103.ZpxfvCHg` and `/var/backups/tpv-queue-relay/code/booth-screen.uOi4jUXc`. The latter contains the 0.10.3 relay from before the booth origin was enabled.

## 0.10.5 follow-up

The public relay and mobile/singer assets were updated to 0.10.5 from `7a9379b7d04b61f575052eaba9ec597cf5985a38` with zero active rooms. Chrome confirmed that the singer page showed a prepared request as **Queued** and enabled successful withdrawal before playback. The live check also exercised public catalog search and the private viewer. After the disposable test, the relay database reported zero active leases and the public health endpoint reported 0.10.5.

The current relay bundle SHA-256 is `20789f86fb982ac2d07b3fa768fb59dce311170527064d6c2813dffcff159831`. The private rollback copy is `/var/backups/tpv-queue-relay/code/queue-0105.YL9JhM14`.
