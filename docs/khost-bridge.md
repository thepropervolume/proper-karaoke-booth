# Optional KHost Companion Bridge

Implemented in source development **0.5.0** as an optional external search/handoff integration. The owner reports their separate KHost subscription works. Loading this bridge and performing authenticated search/handoff on their target machine remain unverified; source implementation, synthetic interoperability tests and an existing consumer subscription are separate evidence.

This bridge was an interim implementation choice. It is not evidence that TPV needs KHost for native playback. The primary goal remains direct account sign-in, acquisition and playback through TPV's own queue and singer screen; the [native integration investigation](karafun-native-integration.md) describes the source findings and proof still needed.

The bridge connects The Proper Volume to a **separately installed, running KHost** with its KaraFun plugin. It searches that installed provider and can explicitly hand a selected result to KHost's normal **Enqueue** action. Playback, singer selection, downloads, licensing checks and account sign-in remain in KHost. A bridge result is not a playable TPV library version; **Send to KHost** must not be described as playing a song through TPV.

This is an independently written plugin using KHost's separately MIT-licensed public contracts. The KHost application implementation and the third-party KaraFun plugin were not copied. It does not call KaraFun directly, read its password or session files, or use a consumer-client identity/signing key. The user's successful KHost test establishes their KHost setup works; it does not establish native TPV playback or provider approval for this app.

## Host Setup

1. Install KHost with contracts **1.x, at least 1.0.0**, install its KaraFun plugin, and sign in there using an eligible account. Confirm normal KHost search/playback works first. Older contracts and other major versions are not supported by this bridge build.
2. Close KHost. Extract `TPV-KHost-Bridge-0.1.0.zip` into its plugins directory, retaining the `tpv-companion-bridge` folder and its files. Current KHost defaults are `%LOCALAPPDATA%\KHost\plugins` on Windows, `~/Library/Application Support/KHost/plugins` on macOS, and `plugins` beside the executable on Linux; `KHOST_DATA_ROOT` can override the data root. Follow KHost's own manual-plugin instructions if your installation differs.
3. Enable **The Proper Volume Companion Bridge** on KHost's Plugins page and restart. Enabling that plugin is the opt-in step; TPV does not silently enable or install it.
4. In TPV, open **Sources → KaraFun via KHost** and choose **Choose Private Bridge Profile…**. Select the private `connection.json` shown in the plugin's startup note. Normally it is `TheProperVolume/KHostBridge/connection.json` below the operating system's local application-data directory. On Windows that is `%LOCALAPPDATA%\TheProperVolume\KHostBridge\connection.json`. Selection is explicit; the empty `khostBridgeConfigFile` setting never silently discovers or enables another application.
5. Use **Search KaraFun Through KHost** to find up to 20 unblocked matches. Select the singer in KHost, then choose **Send to KHost (External Queue)** on the desired row. The explicit handoff invokes the installed provider's offered Enqueue action, so it can affect KHost's queue and show KHost prompts. Start and operate playback in KHost. It never starts playback in TPV.
6. A pending or uncertain handoff locks further sends. TPV checks the original request ID without enqueueing again; **Check Handoff Status** observes it manually. If the connection changed or its result remains unknown, check KHost's queue/downloads before choosing **I Checked the KHost Queue — Clear Warning**. That acknowledgment only clears TPV's warning and never resends the song. Re-search before making a deliberate new request.

The connection file contains only the bridge's loopback address and random 256-bit token. It is owner-only, is replaced with fresh bridge credentials at each KHost start, and stays on disk after exit. Reuse its selected path after restart; the old token/port cannot reconnect until the file has been refreshed. Do not copy it into a shared configuration, send it to singers or expose its port through a network proxy. **Remove Profile Selection** clears TPV's saved path and retains the actual file. Default CLI/API settings projections redact this private location; credentials never enter a renderer projection.

The bridge is **not** KHost's built-in HTTP API: KHost does not expose catalog search as a normal HTTP endpoint. Its existing screen SignalR hub is a paired display protocol. This optional plugin starts its own authenticated listener on a dynamic IPv4 loopback port. It serves no media files or arbitrary paths and cannot be used by remote browsers or LAN singers.

## Commands And Limits

The main-process `KHostBridgeClient` supports `status()`, `search(query)`, `handoff(resultId, requestId)` and `handoffStatus(requestId)`. `readKHostBridgeProfile(path)` validates the native owner-only profile and rejects symlinks, file replacement races, remote/DNS URLs and malformed credentials. Credentials stay outside host/singer renderer projections.

- `GET /v1/status` reports the installed provider and truthful capabilities: external playback, no embedded TPV playback, and no standalone acquisition API.
- `POST /v1/search` takes only `{ "query": "Artist Song" }`, two to 200 characters, and returns at most 20 bounded metadata rows. It never enqueues. A sign-in prompt from the provider becomes `sign-in-required`; sign in within KHost.
- `POST /v1/handoff` takes only opaque `resultId` and caller-generated UUID `requestId`. A result is valid for three minutes and can only invoke its actually offered Enqueue action. Handoffs are asynchronous; `complete` means the provider action returned, not that TPV started playback or every download is necessarily complete.
- `GET /v1/handoffs/{requestId}` observes the action. Reusing an existing request ID with the same result does not enqueue again; a different result conflicts. Completed request IDs are retained for at least 30 minutes, and there is at most one pending handoff. After an ambiguous network failure, poll the original ID; do not automatically create a new ID and repeat the side effect.

Requests require the exact loopback Host and bearer token; browser Origins are refused, there is no CORS allowance, bodies are capped at 4 KiB, and the native client bounds its response to 128 KiB with a deadline. Error projections never include raw exception text or credentials. Search and handoff each have a single concurrency slot, retained until the installed provider returns.

TPV's host-only authority filters search rows through current song/artist blacklists, remembers only the latest approved opaque result IDs, and checks the current show policy, selected protected profile and its contents before dispatch. Age-restricted shows and approved-version-only shows block these unrated external recordings. Policy, blacklist and profile changes immediately hide stale UI results and revoke cached authorization; late replies cannot restore it. Renderer-supplied metadata cannot authorize a handoff. An unresolved handoff retains its original request ID when settings or credentials change; read-only recovery remains bound to the original profile. Remote singer clients have no bridge command surface.

## Developer Build And Verification

Build with the .NET 10 SDK and the **MIT KHost.Abstractions 1.0.0** NuGet package. KHost's documented contracts-packing procedure creates a local NuGet feed when that package is not publicly published. No KHost application implementation is needed in this plugin project.

```powershell
./plugins/tpv-khost-bridge/build.ps1 -ContractsSource /path/to/local/contracts/feed
```

The script creates an allowlisted ZIP in `release`: the bridge DLL, dependency manifest, plugin manifest and Markdown instructions/notices. The host contracts assembly is deliberately excluded from the ZIP; its dependency identity remains in `.deps.json` so KHost can enforce its compatibility gate. SHA-256 and source-revision build receipts are generated. The desktop installer does not silently install KHost or this optional plugin.

```sh
dotnet run --project plugins/tpv-khost-bridge/tests/BridgeSmoke.csproj --configuration Release --source /path/to/local/contracts/feed
node --import tsx plugins/tpv-khost-bridge/tests/interop.mjs /path/to/dotnet /path/to/BridgeSmoke.dll
node node_modules/tsx/dist/cli.mjs --test tests/main/khost-client.test.ts
node node_modules/tsx/dist/cli.mjs --test tests/main/khost-connection.test.ts tests/domain/khost-settings.test.ts tests/control/protocol.test.ts
```

The HTTP smoke uses a synthetic provider and disposable protected profile; the interoperability test runs the real Node client against that real C# listener. Tests cover request authority, deadlines, bounds, search without queue mutation, explicit handoff, idempotency, result expiry and error projection. Windows checks also read the actual native-protected connection file through the Node client. Host-authority tests cover policy/blacklist changes before dispatch, replaced credentials, stale replies, immutable metadata, cancellation, concurrent handoffs, coalesced status polls and ambiguous-outcome recovery.

**Still unverified:** loading this compiled plugin inside a real KHost installation, search/handoff using the owner's authenticated KaraFun account, other host contracts versions and native macOS/Linux plugin execution. No KHost process was running on the Windows development PC during implementation. This bridge does not decode `.kit`, create HLS playback inside TPV or replace the pending approved native provider integration.

Sources: [KHost public plugin contracts](https://github.com/riddlemd/KHost/tree/b397bdd8aa7a3c4e2a0ddced43567b3278424c6e/src/KHost.Abstractions), [KHost README](https://github.com/riddlemd/KHost), [KaraFun plugin documentation](https://github.com/ezhalden/KHost.Plugins.KaraFun). Provider and KHost licensing remain separate from interoperability with their installed software. KHost's [Shield license](https://github.com/riddlemd/KHost/blob/b397bdd8aa7a3c4e2a0ddced43567b3278424c6e/LICENSE) also restricts competing uses; obtain the author's clarification before distributing a competing product that relies on KHost as its playback backend. The MIT contracts grant permits independent plugins, and this package supplies no expanded permission for the separate host or provider.
