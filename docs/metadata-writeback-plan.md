# Optional file metadata updates

The host should choose for each artist/title edit whether to save only in the local library (the default) or also update supported tags in the original media file. Import and ordinary local edits must not change the source. Unsupported formats and write failures must be explained without losing the local correction. This choice is planned, not implemented; today edits are local-only.

## Why file writes are not enabled yet

An experimental MP4 remux using FFmpeg stream copying preserved the checked encoded streams but removed an unrelated custom container tag in a synthetic test. Stream hashes alone therefore cannot establish that the whole file's metadata is preserved. In addition, checking a file's hash immediately before replacing it does not prevent an external editor or Dropbox from changing it between the check and replacement. A backup made before that change would not contain the concurrent edit.

## Requirements before enabling the option

- Use a supported tag editing approach that preserves unrelated MP4 metadata, tracks, timing, chapters and relevant filesystem attributes, or reject files for which preservation cannot be established.
- Design and test platform-specific concurrency protection across the entire validation and replacement operation, including cloud sync, rather than assuming a hash check makes replacement atomic.
- Retain and clearly identify a recoverable original before an opt-in write; consider disk-space, permission, links, alternate streams and backup lifecycle.
- Ensure durable recovery across a crash between file and SQLite changes, including fingerprint and duplicate detection. Never overwrite an unexpected newer file during recovery.
- Verify the requested tags and report local-save and file-write outcomes separately. Avoid modifying a file currently in playback.
- Test with synthetic files containing arbitrary tags, multiple streams, chapters and artwork; inject failures, concurrent changes and process termination on each supported platform. Test read-only and unavailable files as well as missing tools.

Embedded tag reading, configurable source precedence, and support for formats other than MP4 are separate work.
