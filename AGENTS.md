# Project documentation

Use a local checkout for active development. On the owner's Windows workstation the active checkout is `C:\Users\hello\Projects\proper-karaoke-booth`. The Dropbox checkout is a user-maintained mirror; do not update it as part of routine development or builds. Generate artifacts under the local checkout's ignored `release` directory.

The maintained product and interface planning source is `docs/product-specification.md`. When app behavior, product requirements, or interface designs change, update that Markdown in the same work, distinguishing shipped features from planned work. Regenerate the Word specification and mockup PDF from it using `docs/planning-generation.md`; do not independently edit generated documents. Update relevant host, singer, and developer help when behavior changes.

Keep changes and their tests and documentation in small, focused commits. Push completed commits to the configured GitHub repository when access permits.

# Application versions

Use semantic `0.x.y` versions for development updates and reserve `1.0.0` for the approved official release. Bump the version in `package.json` and the lockfile for each delivered application update, include the version in installer filenames, and report it in the user-facing completion update. A group of focused commits delivered together may share one version; documentation-only corrections do not require a new binary version. Do not describe a configured platform target as a built or verified installer.
