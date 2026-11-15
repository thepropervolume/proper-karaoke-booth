# Native KaraFun Integration Investigation

Reviewed 14 November 2026 against KaraFun plugin commit `9abc10886597cd6e182cd4e1792979a0a5bdabac` and KHost commit `b397bdd8aa7a3c4e2a0ddced43567b3278424c6e`. Both were the current upstream main revisions when checked. This is an engineering investigation for the application after **0.5.0**, not a claim that direct KaraFun sign-in or native playback has shipped.

## Direction and Current Evidence

The goal is to sign into an existing eligible KaraFun account within TPV, find songs in the ordinary library, queue them for TPV singers and play them through TPV's transport and singer display. A second KHost queue or player is not the target experience.

The 0.5.0 KHost bridge was our interim architectural choice. It is not a demonstrated technical requirement. The upstream plugin separates its network/session provider from its `.kit` media and timed-lyric adapters; those responsibilities can be investigated for an independent implementation. The owner reports that their normal subscription login and playback work in KHost. That establishes their KHost setup works, not that the same account has passed a direct TPV implementation.

There is no KaraFun OEM binary SDK dependency in the inspected plugin project. It uses .NET 10, public KHost contracts, logging and Protocol Buffers for its optional guest connection. An ordinary HTTP client, strict XML parsing and a new TPV media adapter are a plausible native route. This is a source-based feasibility assessment, not live-provider verification. See the [plugin dependencies](https://github.com/ezhalden/KHost.Plugins.KaraFun/blob/9abc10886597cd6e182cd4e1792979a0a5bdabac/src/KHost.Plugins.KaraFun/KHost.Plugins.KaraFun.csproj#L17-L38) and [provider/rendering separation](https://github.com/ezhalden/KHost.Plugins.KaraFun/blob/9abc10886597cd6e182cd4e1792979a0a5bdabac/docs/how-it-works.md#L5-L18).

An isolated HTTP probe confirmed normal sign-in to KaraFun's official website using the owner's supplied account. The authenticated page's credentials callback matched the supplied login in memory. Credentials and cookies remained in memory and were neither logged nor saved. This establishes website authentication, not a TPV API session, eligible media acquisition or playback.

A separate isolated, muted Electron web-engine probe ended at its outer 100-second deadline without returning stage markers. Its child was terminated and its validated private temporary profile removed. Whether that process submitted its permitted login or reached an API request is unknown. This is an inconclusive startup/observability result, not evidence of a provider denial, challenge or mandatory OEM-only route. No successful direct TPV API login, session inspection, signed search, acquisition or native playback is claimed. The next account experiment needs reliable stage markers before observing the official web engine's normal session flow or testing independently accepted client identification.

## Authentication and Application Identity

The inspected consumer protocol opens a session with account credentials and application identification, receives an XML envelope, then uses the resulting session for subsequent requests. `session/info` checks a retained session. The provider reopens an expired session using its retained credential and previous-session continuity, rather than relying on an OAuth refresh endpoint. A transient network failure and an explicit credential rejection are separate outcomes. See [session opening and inspection](https://github.com/ezhalden/KHost.Plugins.KaraFun/blob/9abc10886597cd6e182cd4e1792979a0a5bdabac/src/KHost.Plugins.KaraFun/Client/KaraFunApi.cs#L109-L180) and [renewal behavior](https://github.com/ezhalden/KHost.Plugins.KaraFun/blob/9abc10886597cd6e182cd4e1792979a0a5bdabac/src/KHost.Plugins.KaraFun/KaraFunMediaProvider.cs#L1133-L1189).

The user's subscription and the software client's identity are different inputs. The source passes a client identifier/key during login and signs session-bearing requests. The presence of a paid account does not establish that an arbitrary TPV-specific client identity will be accepted. The application-key registration route, identity eligibility and TPV-specific acceptance remain unverified. Do not copy embedded upstream identity constants or signing material into TPV, diagnostics, fixtures or documentation. Do not report an official-client test as a successful independently identified TPV client. See [request construction](https://github.com/ezhalden/KHost.Plugins.KaraFun/blob/9abc10886597cd6e182cd4e1792979a0a5bdabac/src/KHost.Plugins.KaraFun/Client/KaraFunApi.cs#L65-L97) and [login parameters](https://github.com/ezhalden/KHost.Plugins.KaraFun/blob/9abc10886597cd6e182cd4e1792979a0a5bdabac/src/KHost.Plugins.KaraFun/Client/KaraFunApi.cs#L124-L145).

Normal account/session/XML behavior is implementable in principle; a concrete rejection of TPV identification would become an integration gate to resolve. The earlier Business management API's 402/403 responses do not answer that consumer-client question. Official OEM outreach remains a parallel route, not evidence that independent technical investigation must stop until an OEM contract exists.

### Credential Storage Correction

The upstream README and how-it-works text still describe a plaintext JSON credential cache. The current provider code instead calls `GetSecretAsync` and `SetSecretAsync`, migrates its legacy cache into the secret store, and clears that legacy entry after storage succeeds. KHost selects Windows Credential Manager, macOS Keychain or Linux Secret Service; unsupported platforms fail instead of silently storing credentials without protection. Source code governs this finding. See [legacy migration](https://github.com/ezhalden/KHost.Plugins.KaraFun/blob/9abc10886597cd6e182cd4e1792979a0a5bdabac/src/KHost.Plugins.KaraFun/KaraFunMediaProvider.cs#L489-L504), [saving and forgetting](https://github.com/ezhalden/KHost.Plugins.KaraFun/blob/9abc10886597cd6e182cd4e1792979a0a5bdabac/src/KHost.Plugins.KaraFun/KaraFunMediaProvider.cs#L1192-L1221) and [platform stores](https://github.com/riddlemd/KHost/blob/b397bdd8aa7a3c4e2a0ddced43567b3278424c6e/src/KHost.Secrets/SecretStores.cs#L3-L20).

For TPV, a provider password-equivalent value must receive the same protection as a password. Keep raw input in memory only for login. Remembered credentials and session material belong in an OS-protected store, outside SQLite, settings JSON, backups, renderer projections and logs. If secure persistence is unavailable, offer a clearly identified memory-only session or refuse remembering; never fall back to plaintext or a basic-text encryption backend. Sign-out must revoke local use and remove TPV's stored credential without deleting unrelated user credential files.

## Code Reuse and Independent Work

KHost's application code uses PolyForm Shield. Its `KHost.Abstractions` and `KHost.Common` projects are explicitly MIT, with notices required when reused. The separately owned KaraFun plugin has no explicit license grant found in its tracked files, project metadata, release notes or published 1.0.0 ZIP. This is a direct source/binary reuse question to clarify with that author; it is not proof that protocol analysis or an independently written implementation is technically impossible. See the [KHost license and contract exception](https://github.com/riddlemd/KHost/blob/b397bdd8aa7a3c4e2a0ddced43567b3278424c6e/LICENSE#L5-L28) and [plugin release](https://github.com/ezhalden/KHost.Plugins.KaraFun/releases/tag/v1.0.0).

The plugin DLL is not a drop-in Electron module. It expects .NET dependency injection, acquisition, interaction, user, cache and stream services. A separately authorized reuse route could provide an independent .NET sidecar with TPV adapters; a native TypeScript client and format implementation avoids that runtime dependency. Neither route requires copying KHost's show authority, queue or player implementation. Do not infer a code license from a public repository or a provider entitlement from a code license.

## Native Media Route

The inspected `.kit` reader describes an unencrypted chunked container with XML timing, Ogg audio members and artwork. Parsing that container must not be described as DRM decryption. Stem roles come from the timing's labels, not solely from stream numbers; duets can contain separate lead voices. The plugin hands stems and timed lyrics to KHost, which owns mixing, clocks, display and transport. See the [container](https://github.com/ezhalden/KHost.Plugins.KaraFun/blob/9abc10886597cd6e182cd4e1792979a0a5bdabac/src/KHost.Plugins.KaraFun/Kit/KitContainer.cs#L5-L63), [stem labels](https://github.com/ezhalden/KHost.Plugins.KaraFun/blob/9abc10886597cd6e182cd4e1792979a0a5bdabac/src/KHost.Plugins.KaraFun/Kit/KitStems.cs#L6-L69) and [renderer handoff](https://github.com/ezhalden/KHost.Plugins.KaraFun/blob/9abc10886597cd6e182cd4e1792979a0a5bdabac/src/KHost.Plugins.KaraFun/KaraFunKitRenderer.cs#L38-L79).

TPV should implement this route through its existing authority:

1. Store a distinct KaraFun recording identity and provider provenance, separate from local/YouTube IDs and from any community-song namespace.
2. Resolve an authorized media request, acquire into a managed temporary location, validate length/container/integrity, then publish without silent overwrite. Do not claim permanent caching or offline entitlement without verified provider/account behavior.
3. Demultiplex with strict byte/member/size limits. Parse only supported XML fields with external entities and arbitrary markup disabled. Decode audio and ignore unsupported artwork/effects safely.
4. Give the singer renderer one playback generation and one authoritative audio clock. Schedule instrumental/voice stems together; derive lyric highlighting and elapsed/remaining time from that clock.
5. Connect Play/Pause, Stop, Previous, seek, volume and explicit output recovery to the ordinary TPV transport. The host preview and LAN screen should mirror this same singer renderer, without another audio player.
6. Draw bounded timed lyrics over the selected silent TPV backdrop. Provider artwork or timing data must not execute code or replace the host's chosen output behavior.

Pitch and tempo, detailed stem faders, alternate vocal arrangements and faithful recreation of every provider visual effect are later phases. The first useful result is a complete song played through TPV's normal queue and singer screen with reliable timing and recovery.

## Phases and Acceptance Evidence

### Phase 1 Read Only Account and Search Proof

- Implement bounded HTTPS requests and strict XML/error parsing with sanitized diagnostics and cancellation.
- Authenticate an explicitly selected test account through an accepted client identity. Limit the first proof to login, session inspection and search; do not create remote rooms, modify account settings or acquire media implicitly.
- Distinguish invalid credentials, expired session, absent entitlement, application-identity rejection, rate limiting and transient failure. Reopen at most once for a verified stale-session condition; do not loop a refused credential.
- Verify protected remembering, restart reuse, sign-out and unavailable-keyring behavior. Assert that no raw or password-equivalent credential enters logs, IPC replies, JSON settings or SQLite.
- Record which client identity and account path were actually tested without publishing secrets. Synthetic XML tests and an official web login are separate evidence.

### Phase 2 Format and Player Foundation

- Independently test synthetic containers, corrupt/truncated lengths, duplicate members, excessive sizes and hostile XML without copyrighted provider media in fixtures.
- Play generated Ogg stems through a single clock; verify lyric timing, pause/resume, seeking, Stop, generation replacement and no restart autoplay.
- Verify the selected output, device-loss latch, silent looping backdrop, host preview and browser mirror. Retain real Windows/Linux/macOS hardware checks as explicit gates.

### Phase 3 Normal TPV Queue Playback

- Search returns library rows labeled KaraFun. Selecting a result uses TPV's ordinary singer dialog, acceptance and durable queue; it never creates a KHost queue entry.
- Preparation does not start playback. A host Play action starts the selected authorized recording through the TPV singer renderer; one completed generation consumes one turn.
- Test a real account and eligible recording end to end: search, queue, acquisition, lyrics/audio, pause, seek, completion, next singer, restart and recovery.
- Recheck relevant entitlement at acquisition/start according to observed/provider-approved behavior. A valid login alone must not be presented as proof that every recording, commercial use or offline retention is allowed.
- Keep the existing external bridge available as a clearly labeled optional path until native verification succeeds; do not silently switch a normal TPV request to external playback.

### Phase 4 Playback Depth and Distribution

- Add stem/voice controls, pitch/tempo and their per-song/per-singer defaults only after synchronized basic playback is dependable.
- Establish application identification, account/territory/venue eligibility, caching/retention, concurrency and any reporting obligations for distribution. Record confirmed terms rather than inferring them from consumer pricing or upstream plugin behavior.
- Verify installers, secret stores, codecs, output recovery and long-show operation on supported hardware. Version and document each delivered increment; reserve 1.0.0 for the approved release.

The implementation is accepted as native KaraFun playback only when Phase 3 has actual account/media evidence. Until then, report protocol research, format tests, account probes and external KHost handoffs as separate capabilities.

Implementation foundation: native recordings now have explicit catalog/community identities, separate from YouTube video IDs. Queue planning creates the recording and request atomically, respects host metadata and policy, and never starts playback. Show schema 4 is a data-format compatibility barrier with unchanged SQL tables: older clients must refuse the show instead of attempting to play a native KIT as a video. KaraFun recording ratings remain unavailable until the shared rating service supports their namespace; they must never be sent as YouTube or local-file votes.

The independent format reader verifies indexed multiplex totals, chunk boundaries, bounded UTF-8 XML and recognized Ogg members before handing data to the player. XML rejects DTD/entity declarations and enforces size, nesting and node limits through `saxes` 6.0.0 (ISC license). Tests use synthetic containers and timing documents. Account-scoped acquisition obtains a fresh private descriptor before reuse, streams and verifies expected size/MD5 plus a local SHA-256, and publishes exclusively into a private managed cache. Failed partial downloads are removed only from their owned staging directory; damaged existing files are retained while a repair receives a new name. Neither provider URLs nor sessions enter show state or sidecars. These format/cache tests are separate from real-account playback verification.
