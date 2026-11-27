# Internet singer sessions

The 0.3.0 host has a **Remote Sessions** workspace for the experimental hosted singer flow. It uses `https://queue.thepropervolume.com` and an outbound connection from the booth; singers do not need a certificate, IP address, port number or account. The host computer remains responsible for the queue and all playback. No internet session starts automatically at launch.

## Host a session

1. Open **Remote Sessions** in the left menu.
2. Keep the suggested session name or enter your own, such as `proper-volume`. Names use 3–48 lowercase letters, numbers and interior hyphens. Reserved or currently owned names are unavailable.
3. If this is a new Linux or macOS host, use **Choose Connection File…** to install the private connection file issued for this computer. Choose **Start Session** and wait for **Session online**.
4. Choose **Copy Link** and share the singer address, for example `https://queue.thepropervolume.com/proper-volume`. Anyone with that link can join while the session is active. It works for guests on venue Wi-Fi and on the internet; keep the booth connected and running.
5. Review joined singers in the workspace. **Remove Access** revokes a current singer session; a public link still admits new guests, so end the session if the link has spread beyond the intended group.
6. Choose **End Session** when finished. This revokes internet access without deleting songs, requests or show history, and leaves a separately opened local-network room independent.

Each computer needs its own private connection file from the room administrator. Booth stores it as `remote-queue-connection.json` in its app-data directory. It contains the fixed relay origin and a device-scoped owner token and stays in the host process. Linux and macOS install the selected profile with mode `0600` and check ownership and permissions when opening it. Windows uses a separately provisioned file with a current-user and SYSTEM-only access list. Connection profiles are excluded from installers. Self-service device provisioning is planned.

If Booth asks for a connection file on a new computer, request one for that device. If the relay rejects a profile, request a replacement. If Booth reports that the show needs recovery, restart the app before trying again. When the relay could not confirm a room opened, choose **End Session** to resolve the previous attempt before retrying.

## Singer flow

Open the shared link, enter your name, join and request songs from the host's available library. Watch request status, withdraw an eligible request or mark yourself temporarily unavailable from the singer page. The host's approval and future-request limits still apply. A queued YouTube recording downloads on the host computer once approved; it never downloads onto the singer's phone and completion never starts playback.

## Outages and limits

Session names reserve a temporary room, not a permanent account address. A configured host owner can hold up to four names during the lease window; reuse a prior name rather than making a new one for every restart. End revokes guest access but does not immediately release ownership of the name. The current relay lease is at most 12 hours. A temporary connection loss keeps the same room and singer credentials so guests can reconnect and recover their original request receipts. Ending, replacing or restarting the host session fences its old generation; guests then need to join again. An interrupted request can have an uncertain outcome, so the singer client checks its original receipt rather than silently sending a second performance request. An ended or replaced generation cannot route to another show that later chooses the same name.

The relay handles only a fixed, bounded set of singer operations. There is no arbitrary URL proxy or inbound host listener. The booth keeps the single local show database authority. Local songs and the running show remain available during an internet outage; internet singers cannot make new changes while the booth is disconnected. Physical phone, venue-network, non-root platform and long-show checks remain part of release verification. This is an experimental remote flow, not a paid-provider login or a full user-account system.

## Developer verification

Run `npm run build` and `npm run build:mobile`, then run `node --import tsx scripts/internet-session-smoke.mjs . <synthetic-mp4>` with a synthetic MP4 at least 30 seconds long. The rehearsal runs the mobile web app in Chromium, opens an internet room in Electron and confirms that a mobile clap reaches the desktop singer screen during a performance. It also checks credits and points. The browsers and the loopback relay use disposable profiles, generated credentials and an in-memory lease store. The fixture intercepts public relay URLs.

The Windows rehearsal passed Start/custom address/Copy/End, browser joining and requests, withdrawal, availability, missing-song requests, no autoplay, ended-generation rejection and app shutdown. This does not establish public-network or production-database operation. Focused tests also cover private-file permissions, malformed success responses, uncertain delivery, original receipt recovery and independent local-network access; the POSIX filesystem-permission test requires Linux or macOS and is skipped on Windows.

## Live verification

A packaged Windows 0.3.0 host and a separate Chromium singer exercised the real HTTPS/MySQL service: custom slug, copy link, join, request, withdrawal, availability, missing-song review, End and app-shutdown fencing. Deliberate response loss recovered the original committed request without duplication. Physical phone and venue-network checks remain. The host and singer used disposable data and synthetic media; the real show was untouched.
