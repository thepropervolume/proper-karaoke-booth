# Song ratings

Songs can have a community average from 1–10 hearts and a vote count. A provisioned host installation can set **Your host rating** to an integer from 1–10 or clear its vote. A new score replaces that host's current vote; it is not an additional vote. This is distinct from the clean/explicit content-policy rating.

The server stores votes and aggregates in the global remote database. The desktop never writes that database directly. The server derives voter identity from a dedicated per-host credential. Existing catalog-reader tokens do not grant rating-write access, and public access cannot submit a vote. Full singer accounts and cross-device person ownership are not implemented; a host installation must not be presented as a verified individual singer account.

## Exact recording identity

- YouTube recordings use `youtube:<exact 11-character video ID>`, preserving case. A downloaded copy keeps that YouTube identity.
- Local recordings use `sha256:<64 lowercase hexadecimal characters>` from the imported playable file fingerprint. Artist/title strings and local filesystem paths are not sent.
- Each converted CDG MP4 currently has its own local asset fingerprint. Reimporting with a different backdrop can produce a distinct rating identity. Native CDG/LRC song identity remains future work.

Ordinary searches and queue rows should display the same exact recording's aggregate. Local editing of artist/title does not merge different recordings or change a YouTube rating key.

## Host setup

Keep the dedicated private configuration in `rating-connection.json` in the application's user-data folder:

```json
{"baseUrl":"https://apps.thepropervolume.com","token":"<dedicated host voter token>"}
```

Provision the actual token separately. The file must belong to the current user with mode `0600` on Linux/macOS; use a current-user-only ACL on Windows. The token remains in the main process and is not included in installer resources, renderer data, media metadata, or logs. A missing default file allows aggregate-only reads. An existing malformed or rejected credential remains an error; it never silently becomes an anonymous vote or a different voter.

In **Preferences → Song Ratings**, choose a host voting profile or use the default `rating-connection.json`. **Check Rating Profile** performs an empty, read-only lookup that validates any supplied credential. Picking or checking a file is a draft operation; **Save Preferences** applies the path to the running host. The selection displays only the filename, with its full path on hover. Choosing a different path does not create or merge voter accounts.

## Service contract

`POST /v1/ratings/lookup` accepts `{"recordingKeys":[...]}` with at most 100 distinct valid keys. Its response is `{"items":[{"recordingKey":"youtube:Abcdefghijk","average":7.5,"count":2,"ownVote":null}]}`. Every requested key has one item, including unrated recordings (`average: null`, `count: 0`, `ownVote: null`). Tokenless reads return aggregates with `ownVote: null`; a valid dedicated bearer credential adds that host's own vote. Invalid supplied credentials must be rejected.

An empty lookup is valid and returns `{"items":[]}` after authorization. It confirms read-only connection/profile status without modifying a vote; the client must not replace this check with a local configuration-presence guess.

Authenticated `PUT /v1/ratings/vote` accepts `{"recordingKey":"youtube:Abcdefghijk","value":8}` or `value: null` to clear the vote. It returns the saved item directly. The client verifies the identity and acknowledged own vote before treating it as success.

`SongRatingsConnection.lookup(keys)` returns a ready result with `items` and `canVote`, or a structured failure. `.vote(key, value)` returns the saved `item` or a failure. Use `{requireConfig:true}` when constructing a connection for an explicitly selected profile, so a missing selected file is an error; only the optional default profile permits public aggregate fallback. Requests use HTTPS, bounded bodies and timeouts, no redirects or cookies, and no automatic vote replay after an uncertain response. A lost reply can be checked with a fresh lookup before an explicit retry. Rating failures must not remove a song, change its queue position, or interrupt playback. Replacing or invalidating credentials fences replies belonging to the previous host authority.

## Live verification

On 12 November 2026, the deployed service passed a live client check using its dedicated QA voter and a newly generated synthetic SHA256 recording key. A score of 3 replaced by 9 retained one vote; authenticated reads showed the QA score while public reads exposed only average/count. An invalid supplied credential was rejected. Clearing the QA vote returned and publicly confirmed zero votes. Owner songs, owner votes and real show state were not modified.

Repeat with `npx tsx scripts/shared-services-live-smoke.mjs /private/qa-rating.json`. The script refuses the owner's profile filename, checks the QA token differs from the sibling owner profile when present, uses an isolated private copy, validates the staged copy, and clears any attempted synthetic vote before removing its private staging directory. Pass a configuration path, never a token value. A failed cleanup is reported for explicit review rather than claimed successful.

The actual muted Electron app also passed `npx tsx scripts/song-ratings-integration-smoke.mjs /private/qa-rating.json`: a synthetic MP4 was imported into a positively verified disposable profile, its library heart button opened the dialog, UI votes 3 then 9 retained count 1, and the queue displayed the same exact recording's average and host vote. Restart retained the remote vote. An invalid draft profile check left active access unchanged; saving that invalid profile produced an explicit configuration error without changing the queue or starting playback. The test restored default QA access, closed the app, cleared the synthetic vote, confirmed zero votes, and removed only its own private staging directory. No owner profile or real show was used.
