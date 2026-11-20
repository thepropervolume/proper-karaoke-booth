# The Proper Volume Karaoke Booth

A desktop app for hosting karaoke: find songs, manage singer rotation, accept requests and play karaoke on a separate singer display.

- One search for local files, Karaoke Nerds, YouTube and connected service catalogs.
- Queue management, optional singer assignments, playlists and song ratings.
- A host preview, customizable singer screen and bumper music between songs.
- Phone requests through remote sessions and optional local-network singer screens.

Desktop KaraFun and Party Tyme consumer Premium playback are experimental. Other paid services currently provide search results only. The official release target is **1.0.0**. See [source status](docs/source-status.md) for availability and limitations.

## Install or Run

Download Windows, Linux and macOS installers from the [Karaoke Booth downloads page](https://release.thepropervolume.com/booth/). Back up your show before upgrading. See the [installation guide](docs/installation.md) for prerequisites.

For development, with Node.js and npm installed:

```sh
npm ci
npm run build
npm start
```

Run checks with `npm test`. Install yt-dlp for YouTube downloads, FFmpeg for CD+G and LRC conversion, and FFprobe for LRC conversion and embedded MP4 metadata preview.

## Documentation

- [Host guide](docs/host-workspace.md) · [Singer guide](docs/singer-guide.md)
- [Plain-language QA test guide](docs/qa/qa-test-guide.md)
- [Mobile Host and Piggyback modes](docs/mobile-app.md)
- [Sources](docs/source-status.md) · [Remote singer screens](docs/singer-screen-sharing.md)
- [Architecture](docs/architecture.md) · [Remaining work](docs/remaining-work.md)
- [Automatic releases](docs/releasing.md)
- [Product specification](docs/product-specification.md) — the maintained source for generated planning documents.
