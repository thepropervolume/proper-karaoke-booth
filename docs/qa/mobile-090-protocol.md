# Mobile 0.9.0 protocol and recovery review

Reviewed 17 November 2026 against the initial, uncommitted mobile implementation on top of `3f0fffa`. This is an independent review of that draft, not a claim that every finding remains in the delivered version. The implementing agent owns fixes and final regression status.

Scope: the public mobile relay additions, capability ownership, network suggestions, catalog adapter, mobile room lifecycle, guest authority and persistence boundaries. No provider credentials were read, no external services were contacted, and no production records were changed.

## Findings

| ID | Priority | Finding | Evidence | Initial status |
| --- | --- | --- | --- | --- |
| MP-01 | P1 | Previous-room singer credentials remain valid in a newly opened room | Reproduced against the retained authority; lifecycle inspection | Fix requested |
| MP-02 | P1 | A lost open response strands the chosen slug until lease expiry | Fault-injected fetch: two new owner capabilities, second open conflicts | Fix requested |
| MP-03 | P1 | Cancelling an opening room fails to close a late successful open | Fault-injected delayed open: zero close calls, orphan identity retained | Fix requested |
| MP-04 | P1 | An expired reply receipt permanently stalls host polling | Fault-injected real HTTP status: one poll, three failed replies, no resumed poll | Fix requested |
| MP-05 | P2 | A lifecycle signal disables per-request browser deadlines | Direct inspection of signal selection and all hosted-room calls | Fix requested |
| MP-06 | P1 | Production relay sandbox blocks the new catalog adapter's outbound HTTPS | Deployment unit and catalog URL inspection; live failure not induced | Fix requested before enabling |
| MP-07 | P1 | Anonymous mobile registrations can consume the trusted desktop reservation pool | Local relay store: 200 anonymous-style reservations block a trusted owner | Fix requested before public hosting |
| MP-08 | P2 | A temporary outage can permanently remove a still-open room from suggestions | Controlled clock and two-room reproduction | Fix requested |
| MP-09 | P2 | Accepted unavailable-song requests disappear on host reload | In-memory array and persistence schema inspection | Fix requested |
| MP-10 | P2 | Remote success can precede durable show persistence | Mutation, save subscription and reply ordering inspection | Recovery gap to resolve |
| MP-11 | P3 | Ephemeral public owners leave permanent MySQL owner rows | Production store insertion/expiry inspection | Maintenance improvement |

### MP-01 — Reset singer authority when the room ends

`src/mobile/room-authority.ts:13` retains session, join and resume maps for the lifetime of the authority. `MobileApp` memoizes that authority by show model, while `MobileHostedRoom.stop()` closes only the relay lease. Starting another room with the same app therefore exposes the same authority through a new room/generation. A previous singer who learns the new public slug can use their old session or resume secret without fresh admission. The relay correctly rejects the old room URL; the problem is credential reuse through the new room.

Reproduction: join the authority, close/reopen a room using that same authority, then send a snapshot/request through the new generation using the old singer session. The initial draft accepts the old session. Reset or replace guest authority and receipts for each room generation; deliberately preserve host queue metadata and define what happens to previous singer availability.

### MP-02 — Preserve an uncertain open operation

`src/mobile/hosted-room.ts:15` issues a new owner capability and creates a new `openId` for each attempt. Its catch branch forgets the capability. If `/host/open` commits but its response is lost, the subsequent attempt belongs to a different owner and receives a slug conflict. The caller cannot close or recover the committed room.

Reproduction: let the first open commit, throw a network error instead of returning its response, then retry the same slug. The independent probe observed two issued owner capabilities and “That room address is already in use.” Retain the same token and `openId` for an uncertain open and retry idempotently; distinguish confirmed rejection from an unknown outcome.

### MP-03 — Clean up cancelled late opens

`src/mobile/hosted-room.ts:59` snapshots `this.room` while stopping. If open has not replied, that value is null. A later response assigns `this.room` before the aborted check, then returns without closing it.

Reproduction: delay a successful open response, call Stop, then release the response. The probe observed zero close calls and a retained room identity. Fence each start with an attempt identity and close any late-created lease using that attempt's own token. Do not let late work overwrite a newer start's state.

### MP-04 — Classify terminal failures and expired reply receipts

`src/mobile/hosted-room.ts:35` keeps the reply batch across every error. The relay intentionally retains RPC reply receipts for only 60 seconds (`src/relay/broker.ts`, `reply()` and `remember()`). If the host reconnects after that window, `reply-not-pending` is a permanent 409. The mobile loop retries that reply indefinitely and never polls new singer commands. The same catch-all loop also treats revoked/expired room responses as retryable.

Reproduction: return one valid admission RPC from poll, then return `409 {error:"reply-not-pending"}` for its reply, representing an expired receipt. After 4.3 seconds the probe counted one poll and three replies; the room remained “reconnecting” with no further polls. Preserve safe HTTP status/error codes, explicitly handle terminal 401/410 and expired-reply responses, and use stable command outcomes to recover uncertain mutations. Do not silently re-execute a different command.

### MP-05 — Combine cancellation and deadlines

`src/mobile/api.ts:28` selects `options.signal ?? AbortSignal.timeout(30_000)`. Every hosted-room request supplies a long-lived lifecycle controller, so browser requests lose the 30-second deadline. A stalled open or response body can leave the UI busy indefinitely. Native HTTP has separate platform timeouts, so this finding specifically concerns the browser path.

Use a fresh per-request timeout combined with the lifecycle signal, and keep cancellation active while reading the bounded body. Add a stalled-fetch/body regression; this review did not wait indefinitely against a live network.

### MP-06 — Reconcile the catalog route with the service sandbox

`src/relay/mobile-catalog.ts` fetches `https://apps.thepropervolume.com/v1/catalog/public/tracks`. The committed production unit (`deploy/queue-relay/tpv-queue-relay.service:50`) uses `IPAddressDeny=any` and allows only localhost. That sandbox cannot reach the new public HTTPS dependency as written.

Serve the catalog through a narrowly configured loopback adapter with the correct Host boundary, or explicitly review a restricted egress configuration. Retain the existing origin/credential protections. Verify a mobile catalog query from the actual sandbox before describing deployed search as working. This is a configuration incompatibility confirmed from source, not a live outage reproduction.

### MP-07 — Protect trusted desktop hosting capacity

The mobile registration endpoint in `src/relay/http.ts` issues public ephemeral owners that can call the same host-open route as configured desktop owners. Both use the same 200-row reservation capacity in `src/relay/mysql-store.ts:256`; closed and replaced reservations remain until expiry. Each owner can reserve four different slugs.

Reproduction: allocate four slugs for each of 50 synthetic public owners in the local production-equivalent relay store, then open a trusted desktop room. The latter fails with `reservation-capacity`. IP registration limits slow a single source but do not isolate capacity from distributed public traffic or repeated registrations over the 12-hour lease. Bound public mobile reservations separately, restrict each ephemeral owner to its intended room, and reserve capacity for configured owners. Do not deploy an unbounded anonymous path into a trusted-show resource pool.

### MP-08 — Retain room metadata after advertisement expiry

`src/relay/mobile-access.ts:28` removes every entry whose 45-second advertisement TTL has elapsed. Its `refresh()` can only update entries that still exist. If room A has an outage and room B records/refreshes during it, A's entry is deleted. A's later successful polls cannot restore its suggestion, despite an online active lease.

Reproduction: record A, advance a controlled clock by 46 seconds, record B, refresh A, then discover A's network with lookup returning A online. The result remains empty. Keep bounded room metadata through lease expiry and apply the shorter heartbeat TTL only to visibility, or recreate owned metadata on successful poll. Disabling and re-enabling discovery should also recover without reopening the room.

### MP-09 — Persist unavailable-song requests before reporting success

`src/mobile/room-authority.ts:17` holds unavailable-song requests only in `missing`. They are absent from `MobileShowState` and `saveMobileShow()`. The singer receives a successful outcome, but host reload discards their request.

Persist these requests with bounded fields and review status, or explicitly disable the form until durable handling exists. Test reload after a confirmed singer submission. The direct protocol success path was tested; browser reload loss follows from the inspected persistence schema.

### MP-10 — Acknowledge durable mutations after commit

`src/mobile/App.tsx:35` schedules IndexedDB saves asynchronously from a model subscription. `MobileRoomAuthority.dispatch()` returns success immediately, and `MobileHostedRoom.poll()` posts the reply without awaiting the queued storage transaction. A quota failure displays an error on the host but does not revoke the successful singer outcome; an immediate crash can also lose the acknowledged request.

Make authority mutations await durable commit before returning success, or define an explicit volatile-session contract and recovery path. Retain command IDs/outcomes through any retry. A browser storage-failure/crash rehearsal remains required; this finding is based on execution ordering, not a fabricated crash test.

### MP-11 — Prune unused ephemeral owners

`src/relay/mysql-store.ts:243` inserts an owner row before opening a lease. Expiry removes leases and old opens but never removes orphan `relay_owners` rows. Configured owners were previously a small fixed registry; anonymous mobile registration changes that growth model.

Add a safe maintenance operation that prunes only owners without lease/open references, preserving configured owners and retry tombstones. This is an operational improvement rather than an immediate authorization bypass.

## Independently exercised checks

- Actual local HTTP relay rejected missing and foreign Origin on mobile capability registration.
- A mobile capability authenticated only its own room; polling another owner's room returned 403.
- Mobile catalog input rejected an arbitrary proxy URL field.
- Mobile capability authentication stopped exactly at its configured expiration.
- Existing mobile protocol tests exercised real `SingerClient` join, request, availability, withdrawal, missing-song submission, command idempotency and receipt ownership. Guest DTO projection stripped private media fields.
- No tested guest route provided playback, filesystem, provider-login or settings access.

Temporary probes are under ignored `release/mobile-protocol-qa.ts`, `release/mobile-protocol-more-qa.ts` and `release/mobile-protocol-reply-qa.ts`. They use synthetic data, stubbed responses and local in-memory test databases. The MySQL production adapter remains the shared database implementation; SQLite was used only for isolated relay tests. Those fault probes intentionally assert initial broken behavior and should be converted into maintained regressions after fixes.

## Verification still required

Final fixed-source regressions; durable IndexedDB failure/reload/crash handling; actual sandboxed catalog access; real iOS/Android foreground/background networking, permission denial and local discovery; separate public/trusted reservation quotas under concurrency; 12-hour lease/token boundary behavior; service restart with active mobile hosts. This report establishes no physical-device or production-show certification.
