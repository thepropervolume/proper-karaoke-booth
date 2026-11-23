# Song ratings

The current Booth library star adds or removes a recording in **KJ Picks**. The details below describe historical recording-quality votes and the retained ratings service. See [playlist help](host-workspace.md#catalog-and-kj-picks).

Development **0.7.0** extends the 0.5 local/shared split with native KaraFun IDs and separates shared recording votes from local-file votes. YouTube/Karaoke Nerds and native KaraFun recordings can have a community average from 1–10 stars and a vote count; a provisioned host can set **Your Host Rating**. Files without a provider recording ID save **Your Local Rating** in the host database and work offline without a remote profile. Choosing a star immediately saves or replaces the current vote; the dialog closes after confirmation, and remains open if saving fails. **Clear My Rating** removes the vote. Stars are distinct from clean/explicit content-policy ratings.

The shared service stores provider-identified votes/aggregates in its MySQL database behind `apps.thepropervolume.com`; the desktop never writes MySQL directly. The service derives voter identity from a dedicated per-host credential. Catalog-reader tokens and public lookup cannot submit votes. Local source-less votes stay in schema-3 `show.sqlite`, with their fingerprint and score never sent to the shared service. Full singer accounts and cross-device person ownership are not implemented; a host installation is not a verified individual singer account.

## Exact recording identity

- YouTube recordings use `youtube:<exact 11-character video ID>`, preserving case. A downloaded copy keeps that YouTube identity.
- Local source-less recordings use `sha256:<64 lowercase hexadecimal characters>` from the imported playable file fingerprint and are routed to local storage. Neither that key nor its filesystem path is sent by the host router. Historical remote SHA256 records are not automatically migrated or deleted.
- Each converted CDG MP4 currently has its own local asset fingerprint. Reimporting with a different backdrop can produce a distinct rating identity. Native CDG/LRC song identity remains future work.

Library search, queue and On Stage controls show the same recording's confirmed score. Identical local file contents share one local vote. Editing artist/title does not merge distinct recordings or change a YouTube key. An import must finish fingerprinting before its source-less file can be rated. Show backups include local ratings; global votes and the separate private writer profile are not part of that local database backup.

## Host setup

For global voting, keep the dedicated private configuration in `rating-connection.json` in the application's user-data folder. Local-file ratings do not need this file:

```json
{"baseUrl":"https://apps.thepropervolume.com","token":"<dedicated host voter token>"}
```

Provision the actual token separately. The file must belong to the current user with mode `0600` on Linux/macOS; use a current-user-only ACL on Windows. The token remains in the main process and is not included in installer resources, renderer data, media metadata, or logs. A missing default file allows aggregate-only reads. An existing malformed or rejected credential remains an error; it never silently becomes an anonymous vote or a different voter.

In **Preferences → Song Ratings**, choose a host voting profile or use the default `rating-connection.json`. **Check Rating Profile** performs an empty, read-only lookup that validates any supplied credential. Picking or checking a file is a draft operation; **Save Preferences** applies the path to the running host. The selection displays only the filename, with its full path on hover. Choosing a different path does not create or merge voter accounts.

## Service contract

`POST /v1/ratings/lookup` accepts `{"recordingKeys":[...]}` with at most 100 distinct valid keys. Its response is `{"items":[{"recordingKey":"youtube:Abcdefghijk","average":7.5,"count":2,"ownVote":null}]}`. Every requested key has one item, including unrated recordings (`average: null`, `count: 0`, `ownVote: null`). Tokenless reads return aggregates with `ownVote: null`; a valid dedicated bearer credential adds that host's own vote. Invalid supplied credentials must be rejected.

An empty lookup is valid and returns `{"items":[]}` after authorization. It confirms read-only connection/profile status without modifying a vote; the client must not replace this check with a local configuration-presence guess.

Authenticated `PUT /v1/ratings/vote` accepts `{"recordingKey":"youtube:Abcdefghijk","value":8}` or `value: null` to clear the vote. It returns the saved item directly. The client verifies the identity and acknowledged own vote before treating it as success.

`SongRatingsConnection` is the shared-service client, not the entry point for local file keys. The host composes it through `HostSongRatings.lookup(keys)`, returning `items`, `canVoteByKey`, `storageByKey` and a compatibility aggregate `canVote`. A mixed lookup can retain local scores/capability while reporting a shared `globalStatus` failure. `HostSongRatings.vote(key, value)` confirms the item and its `local` or `global` storage. A failed global write is never reported as a successful local save.

Use `{requireConfig:true}` for an explicitly selected shared profile so a missing selected file remains an error; only the optional default may be absent. The existing protected PC writer profile remains valid and unchanged. Other installations need their own provisioned writer profile for global voting. No credential enters the renderer.

## Historical Live Verification

On 12 November 2026, the deployed service passed a live client check using its dedicated QA voter and a newly generated synthetic SHA256 recording key. A score of 3 replaced by 9 retained one vote; authenticated reads showed the QA score while public reads exposed only average/count. An invalid supplied credential was rejected. Clearing the QA vote returned and publicly confirmed zero votes. Owner songs, owner votes and real show state were not modified.

Repeat with `npx tsx scripts/shared-services-live-smoke.mjs /private/qa-rating.json`. The script refuses the owner's profile filename, checks the QA token differs from the sibling owner profile when present, uses an isolated private copy, validates the staged copy, and clears any attempted synthetic vote before removing its private staging directory. Pass a configuration path, never a token value. A failed cleanup is reported for explicit review rather than claimed successful.

The pre-0.5.0 muted Electron app also passed `npx tsx scripts/song-ratings-integration-smoke.mjs /private/qa-rating.json`: a synthetic MP4 was imported into a positively verified disposable profile, its library heart button opened the dialog, UI votes 3 then 9 retained count 1, and the queue displayed the same exact recording's average and host vote. Restart retained the remote vote. An invalid draft profile check left active access unchanged; saving that invalid profile produced an explicit configuration error without changing the queue or starting playback. The test restored default QA access, closed the app, cleared the synthetic vote, confirmed zero votes, and removed only its own private staging directory. No owner profile or real show was used.

## 0.5.0 Verification

Focused tests cover SQLite migration/persistence, local/global routing, mixed failures and per-key capabilities. The private host UI rehearsal saves a seven-heart local rating without a writer profile. A separate provisioned QA voter passed global set/repeat/update/clear checks without changing existing human votes, credentials or service processes. The earlier imported-MP4 remote-vote rehearsal is historical evidence for the former remote-SHA flow, not the 0.5.0 local routing contract. Final complete-suite and packaged results remain part of the release closeout; physical show hardware is separate.


## Native KaraFun identities in 0.7.0

Native search results and queued songs use `karafun:catalog:<id>` or `karafun:community:<id>` directly, with canonical positive numeric IDs up to 12 digits. No download or imported fingerprint is needed. Catalog and community IDs stay separate. Existing YouTube IDs and local SHA-256 ratings retain their routing and existing votes. Shared keys require the authenticated global rating profile; provider account login does not grant voting permissions. The matching shared-service validator was deployed on Linode III on 15 November 2026. Both namespaces passed live lookup, vote, repeat/update and withdrawal checks using a newly provisioned disposable voter; no test votes or voter profile remain, and existing human votes/profiles were preserved. No MySQL migration was required. See deploy/song-ratings/API.md for exact contract and deployment evidence.
