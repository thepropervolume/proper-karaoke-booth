# Karaoke Nerds community catalog groundwork

Karaoke Nerds granted access to its community metadata feed with the request that the feed be called about once per day and cached. One successful initial request returned 64,261 records. That snapshot has been seeded into a local SQLite prototype; it has not been deployed as a central service or exposed to the desktop or singer applications. The app does not automatically contact the feed.

The observed feed includes artist, title, brand, watch link and a nullable `Created` value. The links observed are YouTube watch pages, not downloadable video files. `Created` may be a .NET-style timestamp and is not verified as the video's publication time. No brand-prefix or track-code mapping was present. Do not infer publication order from the feed's `Created` field or invent identifiers. Metadata access alone does not grant rights to download, distribute or cache videos.

## Host preferences and future media caching

Preferences saves a base directory, an opt-in automatic-cache preference, and optional lists of brands and artists. These settings are preparatory: no media is fetched, copied or imported, and enabling the preference does not start a task. When appropriate authorized sources and reliable publication dates exist, the requested artist policy is the most recently published video for each artist and track; if competing versions cannot be ordered reliably, report the uncertainty rather than silently guessing.

The intended layout is:

```text
$BASE_CACHED_VIDEOS_DIR/$PROVIDER/Brands/$BRAND_PREFIX/$ARTIST/$BRAND_PREFIX-$TRACK_CODE - $ARTIST - $TRACK_NAME.$FILE_EXTENSION
```

For example, `/chosen/path/karaokenerds/Brands/PVOL/Nada Surf/PVOL-0382 - Nada Surf - Amateur.mp4`. The path planner sanitizes unsafe components and identifies case-insensitive or sanitized-name collisions. It does not write files; future writers must also reject symlink escapes and existing-file overwrites, validate source permissions and report per-file failures.

## Operator prototype

`src/catalog/karaokenerds.ts` stores one validated snapshot and the last attempt and success in one SQLite database. It acquires an attempt transactionally before making a request and enforces a minimum 24-hour interval between attempts, including failures. Invalid or failed responses leave the last good snapshot intact. The coordinator only protects callers sharing that same database; creating separate databases or independent clients bypasses the gate. Production needs a single centrally operated authority and a secure means to distribute cached metadata to clients, with no provider key embedded in the application.

`scripts/karaokenerds-catalog.ts` is an operator-only prototype with `seed`, `refresh` and `status` operations. It requires an absolute database path in `TPV_KARAOKENNERDS_DATABASE`; `seed` additionally reads an existing private response snapshot from the path in `TPV_KARAOKENNERDS_INITIAL_SNAPSHOT`, and `refresh` reads private credential material from the path in `TPV_KARAOKENNERDS_CREDENTIAL_FILE`. The latter must be accessible only to the authorized operator. Do not put credentials, raw catalogs or their private paths in Git, client builds, logs, bug reports or documentation. Keep the database private and back it up without making a second active updater.

With the repository's development dependencies installed and those environment variables set privately, use `node --import tsx scripts/karaokenerds-catalog.ts status` to see the record count and attempt times. Use the same command with `seed` to initialize an empty database from a prior snapshot, or `refresh` to request an update when due. Times are Unix milliseconds. The credential file contains the complete privately supplied endpoint URL; never pass it as a command-line argument or print it. The `seed` command establishes a fresh 24-hour cooldown from initialization, so seeding the first fetched snapshot does not immediately make a second call.

The seeded timestamp conservatively establishes the attempt cooldown. Refresh refuses an uninitialized database, and status or refresh refuses a missing database path; this prevents a typo from silently creating a new active updater. Check status before any later refresh; do not call the feed directly or reset the database to bypass the interval. Failed attempts also consume the interval. Run one supervised updater process: the database records the reservation time, so a process suspended for more than a day immediately before its network request could otherwise resume after a newer attempt. The prototype uses Node's SQLite support and is for controlled development; it is not a scheduled job, hosted database, high-availability coordinator or production service. If its database is lost or restored, reconcile the last upstream attempt time before resuming refreshes.

## Planning documents

`product-specification.md` is the source for the planning Word document and mockup PDF. After changing it, regenerate the planning artifacts using [planning generation](planning-generation.md) and visually inspect them before publishing. Until that happens, older generated files remain historical and may not reflect this integration groundwork.
