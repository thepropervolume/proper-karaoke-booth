# Local control API and CLI

This is the initial adapter-based foundation in `src/control`. The current desktop source connects read/navigation adapters and provides **Preferences → Local API and CLI**, disabled by default. Save the explicit enable preference to start the listener. The actual Windows and Linux 0.4.0 packages and bundled wrappers passed private-profile rehearsals. Constructing the server without `enabled: true` also leaves it disabled: no listener or discovery file is created. API startup failures must not interrupt the show.

Starting with 0.10.9, Windows setup, the Debian package and the macOS PKG register `tpv-karaoke-booth` automatically. Open a new terminal and run `tpv-karaoke-booth --help`. [Install the CLI](installation.md#install-the-cli)

For a Windows ZIP, macOS drag-and-drop install or a user PATH repair, use **Preferences → Local API and CLI → Install CLI to PATH**. On Linux and macOS the preference creates a managed `~/.local/bin/tpv-karaoke-booth` launcher and adds PATH entries to Bash or Zsh startup files. Other shells and a custom Zsh `ZDOTDIR` receive manual instructions. The Windows preference registers the current user's PATH. Control commands still require explicit API opt-in, while `--help` is available immediately.

After upgrading a Debian installation from 0.10.7 or earlier to 0.10.8, run **Install CLI to PATH** again if you used it before. The launcher needs the new installation path.

The API provides bounded reads, desktop navigation and a separate opt-in for queue changes. It delegates changes to the running desktop host and its existing show database writer.

## Routes and adapter

The [OpenAPI 3.1 contract](local-control-openapi.yaml) describes these routes, owner-discovery authentication, response shapes, errors and limits. The raw host-state snapshot remains an internal format.

| Method and route | Behavior |
| --- | --- |
| `GET /v1/capabilities` | API version, application version, available reads, navigation capability flags and limits. `completeApplicationControl` is false. |
| `GET /v1/state` | Authorized host snapshot supplied by `adapter.getState(signal)`. |
| `GET /v1/settings` | Validated settings, with private configuration/media-tool paths blanked and listed in `redactedFields`. |
| `GET /v1/settings?includePrivatePaths=true` | Explicit owner-authenticated request to include those setting paths. Credential file contents are never read or returned. |
| `GET /v1/shortcuts` | Effective validated shortcut bindings from the authority. |
| `POST /v1/actions` | Only `{"action":"settings"}` or `{"action":"keybindings"}`, and only when the corresponding adapter callback is provided. |
| `GET /v1/queue` | Show ID, active host epoch, revision, and up to 100 upcoming and pending requests. `truncated` indicates additional entries. |
| `GET /v1/library` | Saved songs visible in the host library. Search by title, artist, DJ/track code or source. Results are sorted by title and paged without exposing file paths. |
| `POST /v1/queue/commands` | Revisioned add, approve, reject, remove, move or promote command. Requires **Allow Local API to change the queue**. |

`LocalControlServer` accepts `getState`, `getSettings` and `getShortcuts` callbacks, plus optional `openSettings` and `openKeybindings`. Callbacks receive an abort signal. Navigation callbacks should check the signal before dispatching their named desktop action. A successful navigation response confirms callback completion, not a screenshot or proof that a window was painted. No arbitrary IPC channel, shell command, SQL statement, path action or caller-supplied command name is exposed.

Success responses are `{"ok":true,"instance":{"pid":123,"instanceId":"…","profileId":"…"},"result":…}`. Errors are `{"ok":false,"error":{"code":"…","message":"…"}}` with safe static messages. Raw adapter exceptions, request data and credential contents are not logged or returned. Accidentally supplied credential-named fields are redacted during bounded response serialization. Adapters must still supply intentional host projections rather than arbitrary application internals.

The raw state is currently unpaginated. A large library may exceed the response limit and return `response-too-large`. Use the smaller queue view for request operations.

## Discovery, authorization and lifecycle

The server binds **only `127.0.0.1` on an ephemeral port**. It has no LAN or internet listener. Each start creates an independent random 256-bit bearer token and 128-bit instance ID. The owner-only `control-api.json` discovery file is stored in the canonical application profile directory and includes format, literal host, port, PID, instance ID, profile-directory hash/path and token. The token is never accepted as a CLI argument, sent to a renderer, included in capabilities or committed to the repository.

Discovery is staged privately, synchronized, and published exclusively without overwriting an existing live-PID owner. The server serializes start/stop operations and removes only the discovery inode/instance it published. A verified dead-PID discovery can be replaced; a live PID is treated conservatively, including possible PID reuse. The CLI reports stale/mismatched discovery and does not delete files automatically. Confirm the host has stopped before manually reviewing/removing a stale live-PID discovery.

Permission operations are asynchronous, so discovery rechecks the open handle and named inode after the final ACL verification. Publication fences the canonical profile and staged directory before and after protection, write and verification; a changed directory/junction or staged file is rejected before linking. Deletion performs a bounded synchronous inode/version/payload fence immediately before unlinking. Staging cleanup removes only its own file inode and an empty directory; unexpected entries and replacements remain for review. These checks are covered by deterministic native Windows fault injection, including preserving an outside-owned marker and a replacement discovery instance.

On Linux/macOS, discovery must be a regular nonsymlink file owned by the current user with no group/world access. Windows uses a protected ACL allowing the current owner and SYSTEM only. Its native Windows PowerShell permission helper uses matching built-in module paths so a launching PowerShell7 session cannot substitute incompatible modules. Permission checks fail closed. Existing application profile-directory permissions are not rewritten; only newly created control staging/file permissions are set.

The reader verifies bounded UTF-8 JSON, strict fields, stable file identity across reads, canonical profile binding and the active PID. Every authenticated response also carries matching instance/profile/PID headers and JSON identity. The client checks those values before returning host data. Another service on a reused port, a different profile, an old token or a malformed response is not silently accepted or retried anonymously.

## Request boundaries

- The literal `Host` must exactly match `127.0.0.1:<port>`; duplicate Host/Authorization headers and non-loopback peers are rejected.
- Any `Origin` or browser `Sec-Fetch-Site` header is rejected. There is no CORS support, browser sign-in, proxy-header trust or DNS hostname authority.
- Every route requires the per-start bearer token. No query-string or cookie authentication is accepted.
- Defaults: 8-KiB headers, 2-KiB action body, 2-MiB response, five-second request/adapter deadline and four concurrent requests. Navigation bodies must be uncompressed JSON with exactly one allowed action. Response serialization charges the cumulative escaped UTF-8 bytes while walking the snapshot; it rejects early before allocating an oversized JSON result or visiting the remaining repeated entries.
- A timed-out adapter is signaled to abort and retains its bounded concurrency lease until its promise settles. Stop closes transport/discovery, requests cancellation and waits a bounded drain. If work remains, stop rejects `busy` and status reports `stopped` with `pendingOperations`; it does not pretend the adapter is drained. Restart is refused until those retained promises settle, so stop/start cannot bypass concurrency limits. Callers must retain the server/authority and must not dispose its Store or other dependencies after a failed drain. Current desktop read adapters are synchronous; future asynchronous adapters must honor cancellation and the same ownership contract.
- The CLI does not automatically replay commands. Retain the original queue command JSON until you get a result. An identical retry within the same host epoch returns the saved outcome. A new epoch requires a fresh queue view and a review of existing requests before submitting new commands.

## CLI

Development entry:

```sh
npx tsx src/control/entry.ts --help
npx tsx src/control/entry.ts --profile-dir /path/to/app-profile capabilities
npx tsx src/control/entry.ts --profile-dir /path/to/app-profile settings
npx tsx src/control/entry.ts --profile-dir /path/to/app-profile open settings
```

The packaged CLI reuses the included Electron runtime. It reads the owner-only discovery file and checks the advertised API identity and capabilities. The running host handles show reads and writes. `--discovery /path/to/control-api.json` is an alternative to `--profile-dir`.

Commands are `status`, `capabilities`, `state`, `queue`, `queue command JSON`, `settings`, `shortcuts`, `open settings`, and `open keybindings`. `--settings` and `--keybindings` are navigation aliases. `settings --include-private-paths` explicitly asks for private setting paths. JSON is the default output. Errors use stderr. `--help` reads no discovery or credential file.

Use `tpv-karaoke-booth library "Oasis Wonderwall"` to find the exact saved recording ID for a request. For more results, pass the same query plus the returned `nextCursor`. The CLI returns 50 entries per page. If the show or its visible results change, start the search again without its cursor.

For a queue change, enable the separate queue preference and save it. Copy `showId`, `hostEpoch`, and `revision` from `tpv-karaoke-booth queue`. Set `expectedRevision` to that revision and assign a new lowercase v4 UUID to `commandId`. The `command` field can contain `{"type":"removeRequest","requestId":"your-request-id"}`. See the OpenAPI schema for the other command shapes. Save the envelope as UTF-8 JSON and pipe it to `tpv-karaoke-booth queue command -` (on PowerShell, `Get-Content -Raw queue-command.json | tpv-karaoke-booth queue command -`). A domain rejection returns exit code 5 and the original result in `result`. Check `result.code` before preparing a fresh command, especially after `REVISION_CONFLICT` or `STALE_SHOW`.

Without a selector, the CLI uses the established profile name `proper-karaoke-booth` under Windows APPDATA, macOS Application Support, or Linux XDG_CONFIG_HOME/`.config`. A separately launched profile requires its matching selector. The desktop executable's existing `--settings` and `--keybindings` launch/single-instance flags remain independent of this API and should continue working when it is disabled.

| Exit code | Meaning |
| --- | --- |
| 0 | Success or help |
| 2 | Invalid usage/request |
| 3 | Disabled, absent or dead-PID host |
| 4 | Authorization, owner-permission or discovery-access failure |
| 5 | Transport, timeout, busy or host-operation failure |
| 6 | Capability not implemented by this host |
| 7 | Invalid/incompatible or mismatched response |

## Validation and remaining integration

The focused Windows run passed 29 tests with one POSIX symlink skip. It covers default-disabled behavior, native owner-only protection and broadened-permission rejection, discovery profile/PID binding and asynchronous replacement/junction races, strict Host/Origin/auth handling, cumulative response budgeting and path redaction, action allowlists, body/header limits, adapter errors, retained hung callbacks across stop/restart, truthful publication status, client identity checks, CLI exit codes, and a compiled standalone Node CLI against the real loopback adapter. Independent reviewers reproduced and then confirmed the cleanup, directory-junction, staged-file, lease and cumulative-budget fixes. Tests use synthetic adapters and private temporary profiles.

Windows and Linux packaged wrapper behavior, shutdown and navigation passed the rehearsals below. The macOS 0.4.4 wrapper at `Contents/Resources/control/tpv-karaoke` passed `--help` on macOS 27.0.1 Apple silicon without external Node. Full macOS lifecycle and queue checks, provider operations, events, pagination, user-scoped tokens and remote use remain open.

The actual Windows app and compiled CLI passed a private-profile rehearsal: default-disabled behavior, Preferences enable/save, native owner-only discovery, all read commands, both navigation actions, restart token rotation, stale-token denial, singer persistence without autoplay, disable and quit cleanup. This is app-source verification; distributed wrapper/package verification is recorded separately in the installation guide.

The Windows 0.4.0 package passed the same rehearsal through its real `tpv-karaoke.cmd` wrapper and Electron runtime, with no external Node dependency. Both direct desktop navigation flags focused the same running profile while the API was disabled; cold `--settings` also opened Preferences without autoplay.

Linux 0.4.0 AppImage and Debian artifacts had their hashes verified locally. The extracted AppRun passed launch, public-catalog access and private-profile restart. Its LF/0755 wrapper passed with Node absent from PATH: API enable/reads/navigation/disable/quit, same-instance `--settings`/`--keybindings` while the API was off, and cold wrapper `--settings`. All 76 targeted POSIX checks passed without skips. The rehearsal used root/Xvfb and test-only sandbox/GPU flags; it does not establish normal-user desktop sandbox behavior, installation, physical show hardware or CDG conversion on Linux.

Provider profile paths in `providerCatalogProfiles` follow the same privacy rule as flat configuration paths: default settings reads return empty strings and name the redacted fields; `--include-private-paths` is required to return those paths. Projection does not mutate the running host settings. Provider passwords and API-key contents are never settings values.
