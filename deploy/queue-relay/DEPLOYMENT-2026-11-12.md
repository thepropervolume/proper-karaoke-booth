# Queue relay deployment verification

Version 0.3.0 is live at https://queue.thepropervolume.com. The relay binds to loopback behind Apache and its separate valid TLS certificate. Cloudflare DNS has a proxied A record for this hostname. A hostname-only configuration rule enforces strict origin TLS and disables browser analytics; existing global SSL, website and catalog settings were preserved.

Production ownership and temporary slug leases use dedicated MySQL schema `tpv_queue_relay`. Runtime, migration and backup accounts are isolated from website and catalog accounts. Runtime has no DDL grant. Guest bearer credentials, payloads and replies are not persisted in the relay database; bounded pending calls and reply tombstones remain in memory. SQLite is used only by isolated test adapters.

The service is enabled at boot. Daily private MySQL backups are active; a nonempty production-metadata dump restored to a separate scratch schema/account with matching DDL, counts and contents. A controlled service stop/restart passed. Backups still require a separate off-host copy for server-loss recovery.

Live validation used an actual packaged Windows 0.3.0 host and a separate Chrome singer over the public HTTPS endpoint. Custom URL, copy, join, request, withdrawal, availability, unavailable-song request, End fencing and app shutdown passed without autoplay. A deliberately lost successful request reply recovered the original receipt with exactly one host request. True asynchronous polling observed a forced brief connection failure recover with the same guest scope, followed by further successful guest actions. Final replay used a separate QA owner so it could not rotate a human booth session.

Private owner configuration and all database credential backups were transferred over pinned SSH to the protected Windows setup folder; no credentials were committed, logged or bundled. Earlier backups remain. Temporary test reservations were removed only after exact owner and inactive-state checks. The original Karaoke Nerds provider refresher remains disabled while historical refresh authority/cooldown is unknown.

Physical phone, venue Wi-Fi/mobile networks, production concurrency/abuse, prolonged outages and real show hardware remain release checks. This deployment is an experimental guest flow, not self-service accounts, delegated staff roles, paid-provider playback or a complete 1.0.0 release.
