# Automatic GitHub Releases

The **Release on version change** Actions workflow publishes desktop downloads to the repository's [Releases page](https://github.com/thepropervolume/proper-karaoke-booth/releases).

## Publish an update

1. Increase `version` in `package.json` and `package-lock.json` together, for example with `npm version 0.8.1 --no-git-tag-version`.
2. Commit the change and push or merge it to the default branch, currently **main**. The workflow also supports **master** if the default branch is renamed.
3. The workflow compares the version before and after the push. An unchanged version skips packaging. A downgrade or inconsistent lockfile fails with an explanation.
4. Windows, Linux, macOS and planning jobs build from the same exact commit. Only after every job passes does publication start.

No separate token, scheduler or local computer is required: the publishing job uses its short-lived `GITHUB_TOKEN` with `contents: write`; build jobs have read-only repository access. Actions must remain enabled and repository/organization policy must permit that publishing permission.

## Release contents

- Windows x64 setup installer and portable ZIP.
- Linux x64 AppImage and Debian package.
- macOS Apple silicon and Intel DMG/ZIP packages.
- Installer blockmaps, per-platform checksums and build/CI verification receipts.
- Word specification and Night/Day mockup PDF generated from `docs/product-specification.md`, with a source/hash receipt.
- A combined `release-manifest.json` and `SHA256SUMS.txt` covering the download assets. GitHub supplies the tagged source archives separately.

The pipeline checks exact filenames, required architectures, consistent versions/source commits and file hashes. It also compares archive payloads and rehearses packaged launch/restart/branding in disposable profiles. macOS's existing native verifier checks both architectures and launches Apple silicon; Intel receives static checks. Linux uses a headless test launcher with test-only sandbox flags. These checks do not replace installation, physical audio/display or provider acceptance tests. Planning generation does not establish that planned features are implemented.

## Version tags and publication

Releases use tags such as **v0.8.1**, pointing to the exact built commit. **0.x.y** versions are published as development prereleases and appear on the Releases page. **1.0.0** remains the approved official-release target; the packaging guard must be deliberately updated when that release is approved. The workflow does not add publisher certificates or notarization: Windows/Linux packages remain unsigned and macOS is ad-hoc signed.

The publisher stages an unpublished draft, uploads the complete allowlisted set and checks GitHub's reported asset sizes and SHA256 digests before publishing it. A failed upload leaves a draft; incomplete builds never enter publication. Published versions and their assets are not overwritten. Only failed or mismatched assets in a same-commit unpublished draft may be replaced during retry.

## First release and recovery

Use **Actions → Release on version change → Run workflow** on the default branch to seed its current version without a new version bump. The same manual action can retry an unpublished version. Rerunning the original failed workflow preserves its exact source commit; this is required when its version already has a tag or draft. Later commits must not silently move that tag. Already published versions skip without rebuilding or replacing assets.

Inspect the failed job before retrying. Correct package or test failures first; all platform jobs are required. A version-tag conflict or an unexpected draft attachment requires review rather than automatic deletion. The publish job downloads exact artifact IDs from the successful jobs so it cannot combine an older retry's files accidentally. Workflow artifacts expire after 14 days; published Release assets persist independently.

Validation helpers are in `scripts/github-release.mjs`, `scripts/release-artifacts.mjs` and `scripts/release-platform.mjs`. Run `npm run test:release` for version, completeness, hash, draft/retry and immutable-publication checks. `npm run test:ci` limits application-test concurrency to four workers to avoid resource contention during native builds.

## Initial verified release

On 15 November 2026, the [first complete workflow run](https://github.com/thepropervolume/proper-karaoke-booth/actions/runs/43758999649) published [v0.8.0](https://github.com/thepropervolume/proper-karaoke-booth/releases/tag/v0.8.0) with all **28 assets** from source `753e221`. All platform and planning jobs passed. Independent API checks confirmed the published tag's commit, complete asset set, download sizes and SHA256 digests against the downloaded manifest/checksum files. The [preceding push run](https://github.com/thepropervolume/proper-karaoke-booth/actions/runs/43758972604) correctly skipped packaging because its version was unchanged. Twenty release-rule tests and the native application suites passed; no new application version or local installation was needed for this infrastructure change.
