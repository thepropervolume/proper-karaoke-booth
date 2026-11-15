# Song quality ratings API, version 1

Origin: `https://apps.thepropervolume.com`. All responses use `Cache-Control:
no-store`; no endpoint returns voter IDs, tokens, database rows, paths, notes or
provider credentials. The desktop main process owns private credentials and
network requests. Do not expose the token through renderer state, URLs or logs.

`POST /v1/ratings/lookup` accepts only `{"recordingKeys":[...]}`, with zero to
100 unique exact recording keys. Tokenless requests receive global averages
and counts with `ownVote:null`. An optional ratings Bearer adds that voter's
current vote. Every supplied Bearer is checked even for an empty connection
check; malformed, unknown, rotated or disabled credentials return 401. A reader
or queue token grants no ratings capability and never falls back to anonymous.

```json
{"items":[{"recordingKey":"youtube:AbCdEf012_-","average":8.5,"count":2,"ownVote":8}]}
```

Unknown recordings return `average:null,count:0,ownVote:null`. Items preserve
input order. Empty lookup returns `{"items":[]}`. Aggregates are exact current
votes; no title/artist matching or personal identity is inferred.

`PUT /v1/ratings/vote` requires a separately provisioned ratings Bearer and
accepts exactly `{"recordingKey":"...","value":8}`. Values are integer hearts
1 through 10, or `null` to clear this voter's vote. The response is one rating
object with the same four fields, without an `items` wrapper. Each voter has
one current vote per recording; repeating a request cannot add another vote.
The credential determines the voter. Payload voter IDs, roles or extra fields
are rejected. Credentials are rechecked under a database row lock at mutation
and authenticated lookup, fencing concurrent token rotation or revocation.

The first client labels this capability **Your host rating**. It authenticates
a provisioned host voter, without claiming verified personal singer identity.
The same token on another installation represents the same voter. Operators
provision another voter explicitly; there is no public enrollment endpoint.
Plaintext tokens remain in private client exports; MySQL stores only SHA-256.

Exact recording keys are `youtube:<11 case-sensitive characters>`,
`karafun:catalog:<song ID>`, `karafun:community:<song ID>` or
`sha256:<64 lowercase hex characters>`. KaraFun song IDs are canonical positive
decimal integers up to 12 digits; the catalog namespace distinguishes otherwise
equal IDs. Provider recordings can be rated directly in search before playback
or download. Preserve that provider identity for downloaded assets so search and
queue refer to the same recording. Other local media use the current immutable
playable MP4's SHA-256 and are rated locally by the desktop. CDG conversions
with different backdrop output are separate exact assets for this version.
Never send a filename, local path, artist/title alias or mutable track ID as
global recording identity. Do not automatically upload offline rating drafts.

The KaraFun namespace addition is compatible with the existing MySQL schema and
requires a service bundle update, without a database migration or voter changes.
Keep the existing YouTube and file-identity votes when deploying or rolling back.

Errors are bounded generic JSON: 400 invalid request, 401 unauthorized, 403
unexpected Host/Origin, 404 unknown exact route, 405 unsupported method, 429
rate limited, 503 unavailable. Requests require JSON, have a 12-KiB body bound
and three-second body deadline. There are at most eight in-flight requests;
global/client/voter token buckets and fixed-size ephemeral maps bound load.
Client addresses are hashed in memory solely for throttling and are not
persisted or logged. The proxy overwrites forwarded address claims. A retry
after a lost reply replaces the same current vote; show unavailable on network
failure instead of implying the vote was saved.
