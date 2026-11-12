# Internet queueing integration and verification

The 0.3.0 candidate implements **Remote Sessions** in the host's left navigation. The host can start an internet session with a custom slug, copy a link under `queue.thepropervolume.com`, and explicitly end it. Singers join by name and browse and request songs from the host's published library. This path uses an outbound host connection and the same authoritative show, queue and policy service as the local room; local and internet access have separate scopes. Local playback and the separately controlled LAN room do not depend on the internet relay.

**Deployment and public end-to-end verification are pending.** The production relay and its MySQL schema are being finalized on Linode. Cloudflare strict TLS is scoped to the queue hostname; the existing website is unchanged. Do not promise availability or show readiness until deployment, security checks and real-device tests pass. Cloudflare and relay operators can handle guest traffic; define operational privacy and retention before public rollout.

## Host provisioning

Each host needs a separately provisioned private JSON configuration outside the installer; no token values belong in documentation, version control, logs or guest projections. The development Windows host has its own configuration, but another computer needs separate setup. Self-service host accounts and provisioning are not available. Starting a new session is deliberate; an invitation link grants singer admission, never host or staff access. Close the session when finished.

## Reconnection and command safety

A brief network interruption preserves the same host session generation and scope, so an existing command's original outcome can be recovered. Explicit End, a new Start, denial, expiry or host restart fences the old generation. Guest commands are committed by the host and carry durable receipts. After an uncertain result, the singer explicitly checks the outcome; if retry is offered they choose it, using the same command ID and payload. The client does not automatically send the action again. Changed payloads or old generations must not mutate the show. A relay outage must not stop local playback or silently create a second authority or SQLite writer.

Protect each route with bounded payloads and response sizes, rate limits, origin checks, authentication and role/ownership checks. Keep host credentials, local media paths and private notes out of singer responses. Monitor production failures without logging secrets. Test session lifecycle, denial, expiry, stale revisions and duplicate receipts, and isolate guest credentials between LAN and internet.

## Verification still required

Complete deployment and independently verify real public join, browse, request, review, withdrawal, uncertain-result check and same-ID retry. Exercise both modes at once, cross-scope credential rejection, internet interruption and recovery, explicit close, restart fencing and host shutdown. Test actual iOS and Android devices, venue internet/firewall conditions, abuse controls, TLS trust, service failure and recovery. Synthetic and loopback tests do not establish a working public deployment or live-show reliability.

The earlier Quick Tunnel design was exploratory and is not the current internet-session architecture.
