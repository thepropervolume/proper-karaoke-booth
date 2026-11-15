# The Proper Volume Karaoke Booth

A desktop app for hosting karaoke: find songs, manage singer rotation, accept requests and play karaoke on a separate singer display.

- One search for local files, Karaoke Nerds, YouTube and connected service catalogs.
- Queue management, optional singer assignments, playlists and song ratings.
- A host preview, customizable singer screen and bumper music between songs.
- Phone requests through remote sessions and optional local-network singer screens.

**Pre-release:** native KaraFun playback is experimental; other paid services currently provide search results only. The official release target is **1.0.0**. See [source status](docs/source-status.md) for availability and limitations.

## Install or Run

See the [installation guide](docs/installation.md) for Windows, Linux and macOS packages, prerequisites and upgrade instructions. Back up your show before upgrading.

For development, with Node.js and npm installed:

```sh
npm ci
npm run build
npm start
```

Run checks with `npm test`. YouTube downloads require yt-dlp; CD+G conversion also requires FFmpeg. Neither tool is bundled.

## Documentation

- [Host guide](docs/host-workspace.md) · [Singer guide](docs/singer-guide.md)
- [Sources](docs/source-status.md) · [Remote singer screens](docs/singer-screen-sharing.md)
- [Architecture](docs/architecture.md) · [Remaining work](docs/remaining-work.md)
- [Product specification](docs/product-specification.md) — the maintained source for generated planning documents.
