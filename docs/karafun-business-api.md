# KaraFun Business API investigation

On 11 November 2026 the owner supplied `karafun-business-openapi.yaml` (OpenAPI 3.0.3, API version 1.0.0) and the path to a privately stored dashboard-generated token. The original specification remains in the owner's sibling `resources` directory; credentials remain outside the repository. No credential values, account names, room IDs or response bodies are recorded here.

## What the supplied API documents

The documented server is `https://api.business.karafun.com`, with HTTP bearer authentication. Operations cover room/device listing and editing, session scheduling and editing, and per-room KaraFun API-token management. This matches KaraFun's public [Business dashboard API description](https://business.karafun.com/resources-start-karaoke-business/1501-discover-the-new-api-feature-in-your-dashboard.html) and [booking API description](https://business.karafun.com/box/features/api-integration.html).

The Business bearer credential and the separately managed room tokens are distinct concepts. `/karafun-api-token/` creates a room-bound credential and returns its value once; `/karafun-api-token/list` lists metadata, without returning secrets. Revocation is documented to close live sessions on the account. Creating or revoking these tokens is not part of this investigation or the read-only diagnostic.

The supplied document has no song search, catalog, playback/media, SDK, user-login or existing-subscription linking operations. It does not identify the downstream service or protocol that consumes the room tokens. A successful management request would therefore not prove the app can stream karaoke. The separate [OEM offering](https://business.karafun.com/oem) advertises content and login integration; access and commercial terms remain unconfirmed.

## Live read-only findings

The owner authorized checking the supplied token against the documented service. Two explicit GET requests were made, with the token in the Authorization header and redirects disabled:

| Operation | Result on 11 November 2026 | Interpretation |
| --- | --- | --- |
| `GET /device/list` | HTTP 402 | Request is payment-gated. This response is not documented in the supplied specification; it does not identify a required plan, price or prove credential validity. |
| `GET /karafun-api-token/list` | HTTP 403 | The specification describes this as no KaraFun API access for the account. Room-token management is not available in this check; playback access is still unverified. |

No room, session, subscription or credential was created, changed or revoked. No payment was made. The private token file was preserved. Do not buy a Box subscription based on these statuses alone.

The owner has already submitted an OEM inquiry. When KaraFun replies, ask which content/playback API or SDK accepts the room tokens, its documentation and base URL, what account/room entitlement enables it, and whether this Business token is relevant to linking the owner's existing subscription. Confirm all fees and platform support before implementing paid playback.

## Developer constraints

### Read-only diagnostic

Set `TPV_KARAFUN_BUSINESS_TOKEN_FILE` to the absolute path of a private UTF-8 file containing the raw bearer token (a trailing newline is accepted), then explicitly run from the checkout:

```text
node --import tsx scripts/karafun-business-check.ts status
node --import tsx scripts/karafun-business-check.ts --help
```

Only `status` makes network requests. It checks the two GET endpoints once each, with no redirects, retries, subscriptions or writes. Output is JSON containing endpoint statuses and successful record counts, never token values, room identifiers/names, private paths or provider response bodies. Network and body sizes are bounded. `--help` and invalid arguments do not read a token file or contact the service. Nothing is loaded automatically at app startup or exposed to renderers or singers.

Use a regular file rather than a symlink. On Linux/macOS it must be owned by the current user with no group/other permissions. On Windows choose a private directory with appropriate ACLs; the helper does not verify those ACLs. It does not copy, delete or change the token file. Never place a token in command arguments, settings JSON or the repository.

Exit codes are 0 for both checks successful, 2 for payment required, 3 unauthorized, 4 rate limited, 5 unavailable/timeout, 6 invalid response, 7 invalid configuration/credential and 8 restricted API access. Each endpoint's status is retained in JSON when failures differ; a 402 does not imply valid credentials, and success does not grant playback. Fixture tests cover these outcomes and secret redaction without using a real key. Recheck only deliberately after KaraFun clarifies or changes access.

Keep management and playback capabilities separate; do not mark a music provider connected or make songs playable merely because management authentication succeeds. Never send the Business token to a guessed playback host. Any future room/session mutation needs a deliberate product workflow and authorization.

The supplied specification declares `id` as a query parameter for `/device/{id}/` and `/session/{id}/` despite containing a path placeholder. Resolve this inconsistency with KaraFun before generating write clients. Prefer full ISO 8601 timestamps with timezone for sessions; the older local-time parameters are deprecated.
