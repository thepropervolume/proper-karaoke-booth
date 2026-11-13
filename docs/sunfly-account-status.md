# Experimental Sunfly account inspection

The read-only development operator checks the Sunfly protected v2 account endpoint. Sunfly must first issue an access key; see [Sunfly's protected API](https://api.sunflykaraoke.com/swagger-v2/) and [partner information](https://api.sunflykaraoke.com/). This tool is not exposed in the application and does not implement sign-in, catalog import, streaming, license acquisition, or playback. A response of `active` reports an account state and does not establish rights to play a particular song or provide the required playback SDK.

The separate 0.4.2 desktop metadata-search adapter accepts the same raw provider-issued key through **Sources → Third-Party Services**, then builds a complete bounded catalog snapshot before showing search matches. It caches that snapshot only in the running app process for up to 24 hours, excludes withdrawn entries and returns at most 20 matches; incomplete scans publish no partial matches. It is fixture-tested, but no issued key or live compatibility is confirmed. It does not expose the account-inspection CLI or connect playback. Windows 0.4.2 is packaged and installed, with unconfigured-provider state verified; this does not establish live Sunfly access. Linux 0.4.2 package checks remain in progress. See [provider catalog setup and limits](provider-catalog-search.md).

Place the provider-issued access key alone in a private local file. On Linux or macOS, the file must be a regular, non-symlink file owned by the current user with no group or other permissions, for example mode `0600`. On Windows, restrict access to the current user using the file's security properties and a private parent directory; the tool cannot verify Windows ACLs. Never put the key in the command line, a repository, a log, or a shared file.

Set `TPV_SUNFLY_ACCESS_KEY_FILE` to the absolute path to that file, then run from this checkout:

```text
node --import tsx scripts/sunfly-status.ts status
```

This contacts only the fixed Sunfly HTTPS account endpoint and sends the key in a header. It refuses redirects, caps the response and applies a timeout. It makes no request until explicitly run. The output is a single JSON status without credentials. `--help` prints usage without contacting Sunfly.

| Status | Exit code | Meaning |
| --- | --- | --- |
| `active` | 0 | Provider reported an active subscription; playback is not verified. |
| `inactive` | 2 | Provider reported an inactive subscription. |
| `unauthorized` | 3 | Provider refused the key; its documentation notes that an inactive key can also produce this response. |
| `rate-limited` | 4 | Provider asked the client to slow down. No retry is automatic. |
| `unavailable`, `timed-out` | 5 | The service could not be reached or did not respond in time. |
| `invalid-response` | 6 | The response failed bounded parsing or did not match the expected account shape. |
| `invalid-credential`, `configuration-error` | 7 | The key or its private-file configuration is invalid. |

These cases have only been verified with synthetic responses, not a real Sunfly account. The provider's account-specific schema, commercial terms, and supported SDKs must be confirmed when access is granted.

## Inspect a catalog change page

With the same private access-key file, `node --import tsx scripts/sunfly-catalog.ts changes` explicitly requests one metadata change page from Sunfly's protected v2 API. No request is made automatically. The default page limit is 100; set `TPV_SUNFLY_LIMIT` from 1 to 500, and optionally set `TPV_SUNFLY_DIRECTORY_ID` to a positive integer or `TPV_SUNFLY_CURSOR` to the UTC timestamp cursor from a previous result. The JSON result contains the projected track metadata, withdrawal flags, `nextCursor`, and `hasMore`; it omits provider paths, access keys, and raw response bodies. Check its status and exit code before using a result.

This CLI tool previews one page only: it does not persist catalog state, automatically follow cursors, import songs, obtain media links or licenses, or play video. The desktop adapter described above is a separate bounded full-snapshot consumer of that metadata client. Sunfly documents a 90-day withdrawal-notification window; an eventual persistent sync must handle a cursor older than that window with a complete resync rather than silently missing removals. The published response describes an example rather than a complete response schema. Parsing and failures were tested with fixtures only; a provider-issued account is needed to confirm real compatibility and applicable metadata rights.

Version 0.4.3 also offers credential-free [Sunfly Store title/SKU search](sunfly-store-catalog.md) when no developer profile is selected. Store identities and optional product-page artist metadata remain separate from the protected catalog and subscription playback described here.
