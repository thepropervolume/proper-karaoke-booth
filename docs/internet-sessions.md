# Internet singer sessions

The 0.3.0 host has a **Remote Sessions** workspace for the experimental hosted singer flow. It uses `https://queue.thepropervolume.com` and an outbound connection from the booth; singers do not need a certificate, IP address, port number or account. The host computer remains responsible for the queue and all playback. No internet session starts automatically at launch.

## Host a session

1. Open **Remote Sessions** in the left menu.
2. Keep the suggested session name or enter your own, such as `proper-volume`. Names use 3–48 lowercase letters, numbers and interior hyphens. Reserved or currently owned names are unavailable.
3. Choose **Start Session** and wait for **Session online**.
4. Choose **Copy Link** and share the singer address, for example `https://queue.thepropervolume.com/proper-volume`. Anyone with that link can join while the session is active. It works for guests on venue Wi-Fi and on the internet; keep the booth connected and running.
5. Review joined singers in the workspace. **Remove Access** revokes a current singer session; a public link still admits new guests, so end the session if the link has spread beyond the intended group.
6. Choose **End Session** when finished. This revokes internet access without deleting songs, requests or show history, and leaves a separately opened local-network room independent.

The host needs a separately provisioned private `remote-queue-connection.json` in its app-data directory. This contains only the fixed service origin and that computer's scoped owner token. It is not a database or Karaoke Nerds key, is never sent to the renderer or singers, and is excluded from installers. The owner's current Windows booth is provisioned separately; another host computer needs its own configuration. Full self-service account/device provisioning remains planned. On Linux and macOS, the app requires this file to belong to its current user with no group or other-user permissions (for example, mode `0600`); it checks these permissions before opening and again while reading. Windows setup must protect the file with a current-user and SYSTEM-only access list, which is an external provisioning requirement because Node's file mode bits cannot verify Windows access lists.

## Singer flow

Open the shared link, enter your name, join and request songs from the host's available library. Watch request status, withdraw an eligible request or mark yourself temporarily unavailable from the singer page. The host's approval and future-request limits still apply. A queued YouTube recording downloads on the host computer once approved; it never downloads onto the singer's phone and completion never starts playback.

## Outages and limits

Session names reserve a temporary room, not a permanent account address. A configured host owner can hold up to four names during the lease window; reuse a prior name rather than making a new one for every restart. End revokes guest access but does not immediately release ownership of the name. The current relay lease is at most 12 hours. A temporary connection loss keeps the same room and singer credentials so guests can reconnect and recover their original request receipts. Ending, replacing or restarting the host session fences its old generation; guests then need to join again. An interrupted request can have an uncertain outcome, so the singer client checks its original receipt rather than silently sending a second performance request. An ended or replaced generation cannot route to another show that later chooses the same name.

The relay handles only a fixed, bounded set of singer operations. There is no arbitrary URL proxy or inbound host listener. The booth keeps the single local show database authority. Local songs and the running show remain available during an internet outage; internet singers cannot make new changes while the booth is disconnected. Physical phone, venue-network, non-root platform and long-show checks remain part of release verification. This is an experimental remote flow, not a paid-provider login or a full user-account system.

## Developer verification

After building the app and creating a synthetic MP4 fixture, run `node --import tsx scripts/internet-session-smoke.mjs . <synthetic-mp4>`. The rehearsal uses disposable Electron and Chromium profiles, generated test credentials and the actual relay HTTP handler/broker/store on loopback. Its in-memory SQLite lease store is a test fixture. Public relay URLs are intercepted only within these test processes; it neither contacts the public service nor uses a real host credential.

The Windows rehearsal passed Start/custom address/Copy/End, browser joining and requests, withdrawal, availability, missing-song requests, no autoplay, ended-generation rejection and app shutdown. This does not establish public-network or production-database operation. Focused tests also cover private-file permissions, malformed success responses, uncertain delivery, original receipt recovery and independent local-network access; the POSIX filesystem-permission test requires Linux or macOS and is skipped on Windows.

## Live verification

A packaged Windows 0.3.0 host and a separate Chromium singer exercised the real HTTPS/MySQL service: custom slug, copy link, join, request, withdrawal, availability, missing-song review, End and app-shutdown fencing. Deliberate response loss recovered the original committed request without duplication. Physical phone and venue-network checks remain. The host and singer used disposable data and synthetic media; the real show was untouched.
