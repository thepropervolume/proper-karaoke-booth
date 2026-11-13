# Product roadmap

The desktop host is the authority for a show. Singer participation is free; hosts or venues pay for the application in a future commercial release. Pricing, plans, trials, billing cadence, device limits and show limits are undecided. A show and a party are the same entity. The marketing site and branding guide are separate projects.

## Local rehearsal foundation

- Import local MP4 with metadata, fingerprinting, duplicate handling, explicit staging, and no automatic start. Add MP3/CDG pairs and ZIP after safe extraction, size limits and explicit ambiguity resolution are implemented; support relinking. Preserve source files by default. For a metadata edit, offer a per-edit choice to also update supported embedded file tags; local-only is the default and write-back must never occur implicitly. Report unsupported formats and write failures without losing the local edit.
- Verify video, audio, clock, pause, seek and completion on the actual laptop. Investigate CDG synchronization and seeking, pitch and tempo, filler fades, audio output selection, and second-display/device loss before selecting a permanent engine. Only one karaoke source may be audible; preparation must never start it. Pause does not start filler; intermission may. The engine owns time.
- Persist queue mutations and command receipts before acknowledgment; restore an interrupted show without autoplay. Check playback generation on callbacks. A staged item remains locked until explicitly released or replaced. Finish round-robin semantics for late arrival, holds, absence, restoration and manual reordering. A completed or confirmed skipped performance consumes exactly one turn; preparation failure consumes none.
- Default new requests to automatic approval, with an explicit moderation option; a change of mode must not silently approve existing pending requests. Support both arrival-order FIFO and fair singer rotation without losing requests when switching modes.
- Enforce version-based inclusion, exclusion and age policy through every future catalog, request, staging and playback path. Exclusions win. For age-restricted shows, unrated, uncertain and conflicting ratings are hidden and ineligible. Separate owner maintenance review from guest discovery. Policy changes invalidate future readiness but do not silently stop active playback.
- Establish a shared validated command boundary, roles, show IDs, host epochs, revisions and idempotency. Local API defaults off; add authenticated loopback with scoped, revocable tokens before exposing it, and document OpenAPI and event schemas. LAN mode requires authenticated TLS and explicit enablement. Do not expose private paths or credentials.

## High priority — paid karaoke providers

Investigate and pursue provider-approved integrations alongside show reliability, with the host's ability to connect an existing paid subscription as a key goal when the provider permits it. Research and access are not yet an integration: no playable service or existing-account linking is implemented. Compare KaraFun OEM, Party Tyme, Sunfly and Stingray, request their terms and test access when authorized, and verify Windows, macOS and Linux/Electron support, hosting rights, territory, pricing, subscription eligibility, offline behavior and reporting. See [provider research](provider-research.md) for sourced leads and discovery steps.

Build provider adapters for search, exact version identity, availability, entitlement, protected playback and usage reporting. Do not substitute recordings silently or bypass protected playback. Keep local operation available during provider outages. Keep the app subscription separate from provider entitlements, and design failure and expiry handling so a show is not unexpectedly interrupted.

## Later milestones

1. Harden local hosting: background imports, reconnect and relink, checkpointing, display and audio-device recovery, accessibility, keyboard and touch support, complete Day/Night/system themes, and cross-platform installation and tests.
2. Singer browser app, authenticated KJ remote and separately scoped staff queue manager. Host remains authoritative. Guest links are not staff credentials. Implement disconnect/pending/outcome-unknown states, authoritative refresh, no automatic replay of stale actions, and a separately tested HTTPS/WebSocket relay. Secure LAN browser access needs its own design.
3. Singer history, favorites, lists and per-version settings; uncertain wait estimates; pre-arrival planning and optional requests without reserved turns; opt-in notifications with in-app fallback and deduplication; accepted/declined group invitations. A duet consumes only its lead singer's turn. Guest choices can stay on-device; optional accounts provide cross-device controls and deletion.
4. Separate host subscription and provider entitlements. Server-verified subscriptions and signed device-bound offline grants are proposed. Define a bounded grant for a show already started before release. Development access must not be confused with production entitlement.

## Open decisions

- Age presets, thresholds, provenance and owner rating workflow; per-category severity, never an average that hides a severe category.
- Subscription plans, limits, trials, cadence and bounded show grant.
- Durable recovery UX and policy for an interrupted performance; exact hold/absence and manual reorder behavior.
- Final media engine, CDG synchronization, output-selection approach, filler mixing and per-platform packaging.
- Relay hosting, authentication, privacy, retention, profile deletion, notification delivery, and approved provider contracts.
- Embedded metadata write-back design: supported containers, safe update and recovery, concurrent file changes, and reporting. A local-only edit is always the default; opting into an embedded edit is an explicit choice for each edit.
