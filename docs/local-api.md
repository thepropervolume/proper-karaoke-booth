# Local API design starting point

No API listener exists in the rehearsal build. It defaults to off by absence. The shared command and permission rules in `src/domain` are the beginning of the boundary; the current host bridge does not expose external IDs, scoped tokens or full retry semantics. Do not enable an unauthenticated listener.

Before an API release: authenticate and authorize every request with revocable scoped credentials; bind to loopback by default; require an explicitly enabled, separately secured TLS mode for LAN; use stable IDs, pagination, structured errors, capabilities and effective settings; publish OpenAPI and event schemas; redact media paths, URLs and credentials; enforce personal-library ownership and content restrictions on both list and direct lookup. Commands need caller-supplied IDs, host epochs, expected revisions and durable original outcomes, including errors. Replay must not repeat a mutation or start playback. Web clients must reconnect to authoritative state and must not automatically replay stale controls.

Planned families: `/v1/capabilities`, `/v1/preferences`, `/v1/parties`, `/v1/users`, `/v1/users/{id}/library`, `/v1/catalog`, `/v1/playback`, `/v1/outputs`, `/v1/providers`, `/v1/policies`, `/v1/commands`, and `/v1/events`. Show and party denote the same entity. These names are proposals, not supported endpoints.
