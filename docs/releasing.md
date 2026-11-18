# Automatic desktop releases

The **Release on version change** GitHub Actions workflow builds the desktop packages and publishes them to [Karaoke Booth downloads](https://release.thepropervolume.com/). The latest version appears at the root and each release has its own page at `/vVERSION/`. Cloudflare DNS points the release hostname to the Linode server behind `apps.thepropervolume.com`.

## Publish an update

1. Increase `version` in `package.json` and `package-lock.json` together, for example with `npm version patch --no-git-tag-version`.
2. Commit the change and push or merge it to the default branch, currently **main**. The workflow also supports **master** if the default branch is renamed.
3. The workflow compares the version before and after the push. An unchanged version skips packaging. A downgrade or inconsistent lockfile fails with an explanation.
4. Windows, Linux, macOS and planning jobs build from the same commit and send verified files directly to private staging on Linode. The publisher waits for all four jobs from the same workflow attempt.

CI uses the `BOOTH_RELEASE_SSH_KEY` secret and the pinned `BOOTH_RELEASE_KNOWN_HOST` variable. The key can run only the release upload and publication commands. The workflow needs read-only GitHub repository access. See the [server runbook](../deploy/booth-downloads/README.md) for setup and diagnostics.

## Release contents

- Windows x64 setup installer and portable ZIP.
- Linux x64 AppImage and Debian package.
- macOS Apple silicon and Intel DMG/ZIP packages.
- Installer blockmaps, per-platform checksums and build/CI verification receipts.
- Word specification and Night/Day mockup PDF generated from `docs/product-specification.md`, with a source/hash receipt.
- A combined `release-manifest.json` and `SHA256SUMS.txt` covering the download assets.

The pipeline checks exact filenames, required architectures, consistent versions/source commits and file hashes. It also compares archive payloads and rehearses packaged launch/restart/branding in disposable profiles. macOS's existing native verifier checks both architectures and launches Apple silicon; Intel receives static checks. Linux uses a headless test launcher with test-only sandbox flags. These checks do not replace installation, physical audio/display or provider acceptance tests. Planning generation does not establish that planned features are implemented.

## Publication and recovery

The release server rechecks the complete file list, platform receipts, source commit and SHA-256 hashes before publishing the version directory. The latest page is replaced atomically. Version directories are immutable. Development builds use **0.x.y**. **1.0.0** remains the official release target and needs approval and an update to the packaging guard. Windows/Linux builds are unsigned. macOS builds use ad hoc signing.

Use **Actions → Release on version change → Run workflow** on the default branch to publish an existing version for the first time. The planner skips a version already on the downloads site. After a failure, inspect the failed step and select **Re-run all jobs** so all four staged batches have the same run attempt.

Run `npm run test:release` for the existing package and integrity checks. On Linux, run `python3 deploy/booth-downloads/test-release-command.py -v` with Node on PATH to exercise the server publisher in a scratch directory.

## Historical GitHub release

On 15 November 2026, the [first complete workflow run](https://github.com/thepropervolume/proper-karaoke-booth/actions/runs/43758999649) published [v0.8.0 on GitHub](https://github.com/thepropervolume/proper-karaoke-booth/releases/tag/v0.8.0) with 28 assets from source `753e221`. The [hosted v0.8.0 archive](https://release.thepropervolume.com/v0.8.0/) was copied and verified against all 28 GitHub asset hashes. Its combined manifest and checksum files match the GitHub copies byte for byte.
