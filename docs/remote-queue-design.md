# Remote singer queueing design

Remote requests are not implemented. The host wants singers to be able to join from both the venue's local network and the internet. The desktop host must remain the only authority for show state, queue and playback; local hosting must continue to work without internet access. Complete the requested host and audio controls before enabling remote queueing.

The intended experience is an explicitly enabled show with a shareable link or QR code, a singer-facing catalog and request flow, visible request status, and a host-controlled way to revoke access or close the room. Local and internet connections must obey the same host approval, content policy and rotation rules. The host chooses which connection modes to enable. Internet access needs a separately deployed relay or equivalent hosted infrastructure; it must not require opening an unprotected inbound port on the host computer. The final link, provisioning, service ownership and operating costs are not yet decided.

## Proposed local-network boundary

The listener must be off by default. A host who explicitly enables a LAN show can serve a separate singer page and versioned API over HTTPS on the selected interface. Do not fall back to plain HTTP, expose filesystem paths or give singers transport, moderation or output permissions. Internet access is a separate relay design; a local listener alone does not provide it, and a relay outage must not change the authority or corrupt the local show.

Guest browsers need a trusted certificate valid for the hostname they use. For an offline venue this may be a previously provisioned certificate and host-controlled name resolving to the private address. Public certificate issuance and renewal can require internet and DNS administration. A newly generated self-signed certificate will not be trusted automatically by ordinary phones; do not ask singers to bypass browser warnings or install a private root certificate as the default flow.

The host can show a short-lived, high-entropy QR admission secret, preferably in a URL fragment so it is not sent in ordinary HTTP request logs. The guest exchanges it over verified HTTPS for a revocable, guest-scoped session. A displayed QR is shareable and therefore grants admission; it does not establish real-world identity. Session identity, singer ownership and role are determined by the server, not submitted role fields. Host and staff credentials are separate.

## Required implementation and validation

- Filter catalog search and direct lookups through the same version policy used by the host; never expose private paths, credentials, notes or media URLs to guests.
- Validate Host and Origin, protect state-changing requests against CSRF, bound request sizes and rates, use restrictive CSP and same-origin access, and avoid wildcard CORS.
- Extend the command boundary with authenticated singer registration and caller-supplied IDs, show/epoch and expected revision. Persist original outcomes with mutations; handle unknown outcomes and reconnect without replaying stale playback controls.
- Use authoritative snapshots and simple polling first; provide explicit offline, reconnect and request-pending states. Revocation, shutdown and expiry must invalidate guest sessions.
- For internet access, specify and test host-to-relay authentication, guest-to-show authorization, relay isolation across shows, secure transport, expiration and revocation, deployment, failure recovery, and what data the relay can see or retain. Define reconnect and duplicate-request behavior for interrupted relay connections. Do not promise internet availability when the venue or relay is offline.
- Test certificate errors and hostname mismatches, authentication/revocation, impersonation, CSRF, DNS rebinding, policy-filter bypass, concurrent requests, duplicate commands, restart and transaction interruption, rate limits, and Windows firewall/network isolation. Verify real iOS and Android browsers on a venue network.

The [remote queue boundary prototype](remote-queue-foundation.md) tests a transport-independent part of this design but is not connected to the app. See [local API design](local-api.md), [architecture](architecture.md), and [the development handoff](handoff.md). Certificate provisioning and internet relay details remain open product and infrastructure decisions.
