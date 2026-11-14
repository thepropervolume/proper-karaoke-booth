# Host Workspace

## Workspace Refresh in 0.5.0

The interface refresh from `opencode-audit` adds sidebar icons and request counts, clearer Song Library and Host Queue headings, an always-visible compact transport, and Preferences with a sticky header and footer. Informational and success notices clear after eight seconds; error notices remain until dismissed or replaced. **Dismiss message** clears a notice explicitly. Existing sort, filter, queue, rating, double-click and context-menu actions remain available.

Version 0.4.3 adds public Sunfly Store title/SKU search to the provider metadata workspace. Windows 0.4.3 is installed and verified, and Linux AppImage/Debian package checks passed. The update preserves the selected microphone/play identity, existing show/settings and normal local playback. Version 0.4.4 adds macOS DMG/ZIP packages; native Apple silicon launch/restart, branding and CLI help passed on macOS 27.0.1. Intel packages received static checks only. Windows/Linux and this PC remain at 0.4.3. Mac Finder installation, Gatekeeper approval, physical show hardware and real-user Linux installation remain open. See [installation](installation.md).

## Preview and Resizable Panels

The small **Singer Preview** mirrors the actual singer window with no second audio player. Its display button opens the singer window. Choose **Preferences → Appearance → Singer Preview Position** to place it above or below Host Queue, or hide it.

Drag the separators between the sidebar, library and Host Queue, or between the preview and queue. Wide Song Library uses a horizontal queue-height separator. Focus a separator and use arrow keys to resize; hold Shift for a larger step. Double-click restores that separator's default size. Sizes save when the drag or key adjustment commits, and fit the current viewport without overwriting larger saved desktop dimensions. **Reset Panel Sizes** in Appearance restores the defaults when preferences are saved. Transport controls stay visible while the library's combined local/service/YouTube results scroll.

## Song and Artist Blacklists

Open **Preferences → Song and Artist Blacklist** to add or remove artist names and artist/title pairs. Save to apply the draft; Cancel leaves saved rules intact. A song rule covers every version matching that complete artist and title across sources. An artist rule covers that artist's songs. Matches fold case, spacing and typographic equivalents; they do not use substring or wildcard matching. An empty artist means unknown-artist results only.

Right-click a library row for **Blacklist Song**, **Blacklist Artist** or **Manage Blacklist…**. These rules belong to the host settings across shows, separate from a show's clean/explicit and version-specific policy. They filter discovery and are checked again at request/playback boundaries. Existing queue items are retained with unavailable status so the host can remove or change them deliberately.

## YouTube Karaoke Search

With **All Songs** selected, type at least two characters in Song Library. The YouTube section uses `yt-dlp`, adds karaoke to the search and excludes live, private/restricted and out-of-range videos. Candidates must identify karaoke in their video metadata and have a karaoke-channel hint or host approval. Channel hints and suggested artist/title splits are heuristics, not verified musical metadata or a guarantee of track quality.

Choose **Preferences → YouTube Search → Approved channels only** for stricter curation. Add channel IDs/handles manually or import a Google Takeout subscriptions CSV/JSON file. The app does not sign into the private subscriptions feed or extract browser cookies. **Block Channel** on a candidate persists a channel rule; blocked IDs/handles override approvals. A subscribed channel still needs a karaoke-indicated candidate.

**Choose Singer** opens the normal singer dialog, including new names. Submission passes an opaque current-search receipt to the host authority, saves the canonical recording/request and dispatches an approved request's permanent download. It never starts playback automatically. Manual moderation waits for approval. A stale or policy-invalid search result must be searched again rather than saved from renderer-supplied metadata.

## LAN Singer Screens

Open **Remote Sessions → LAN Singer Screens** and start sharing, or save its checkbox and port under **Preferences → Singer Display**. Port 4051 is the default. Copy a displayed address to browsers on the venue network. This is a read-only visual mirror with audio remaining on the host; singer request links are a separate feature. Numeric addresses are the reliable fallback when `.local` resolution is unavailable. See [LAN setup, firewall and limits](singer-screen-sharing.md).

## Optional KaraFun via KHost

**Sources → KaraFun via KHost** uses the independently installed KHost application and optional TPV companion plugin. Sign in and confirm normal KaraFun playback inside KHost first, enable the bridge plugin there, then explicitly select its private connection profile in TPV. **Search KaraFun Through KHost** returns external results; choose the singer in KHost and use **Send to KHost (External Queue)** to hand one over. This affects KHost's queue and may show its prompts. It does not add a playable TPV queue item or start playback here.

Current content restrictions and song/artist blacklists apply before search/handoff. If a send becomes uncertain, use **Check Handoff Status** and inspect KHost's queue before clearing the warning; clearing never resends a song. Account sign-in, downloads and playback stay inside KHost. The owner reports their separate KHost subscription works, but actual authenticated bridge use on their target machine remains unverified. See [bridge installation, recovery and limits](khost-bridge.md).

## Navigation and Menus

The larger sidebar links put **Library**, **Playlists** and **Sources** first. **Requests**, **Singers** and **Remote Sessions** form the Host Workspace group at the bottom. Sources contains Karaoke Nerds discovery, the Custom YouTube Video Importer and Third-Party Services catalog search/configuration. Paid-provider playback is still pending approved access.

Use **File → Import** for **Import Video File**, **Import Custom Directory**, or **Import CD+G / ZIP**. The same three import icons are next to the Song Library heading. CDG conversion progress and cancellation stay visible while a job runs. **Back up show…** is in File; database backups do not include song media or preferences.

**View → Appearance** opens appearance settings or selects System, Night or Day. **View → Choose Accent Color** selects Blue, Pink or Purple. **View → Layout** selects Standard, Wider Singer Rotation or Wide Song Library. The palette icon opens the Appearance preferences section. These choices do not interrupt a performance.

## Preferences and Keyboard Shortcuts

Preferences is wider, with larger collapsible section headings. The default shortcuts are:

| Action | Default bindings |
| --- | --- |
| Search library | Ctrl+F or Cmd+F |
| Open Preferences | Ctrl+, or Cmd+, or Alt+, |
| Open Keyboard Shortcuts | Ctrl+/ or Cmd+/ or F1 |
| Play/Pause | Spacebar |
| Toggle singer fullscreen | F or Shift+F, in the player window |
| Remove selected waiting queue request | Delete, while the queue has focus |

Open **Keyboard Shortcuts** to change, add or remove bindings. A conflict is rejected with an explanation. **Save Shortcuts** applies the draft immediately and independently from other preferences. **Reset to Defaults** restores and saves the defaults. **Edit custom shortcuts** opens `keybindings.json` in the default editor; close the app before editing that file manually and restart afterward. See [keyboard shortcut help](keyboard-shortcuts.md).

Typing in text fields does not pause music or trigger a bare-letter custom shortcut. The modified navigation defaults and F1 remain available. While recording a replacement shortcut, keys belong to the recorder. Repeated Help/Appearance navigation reopens and scrolls to its section without discarding other preference drafts.

Preferences sends only changed fields to the serialized settings authority. A volume change cannot overwrite a newer accent or another unrelated setting. Invalid edits leave the saved file intact.

## Play and Previous

Press **Play/Pause** to stage the first eligible request and start it. If necessary, the singer window opens automatically on its last connected monitor. Otherwise the app chooses the nearest monitor other than the host window's, then the current monitor when there is no alternative. The explicit Singer Display button still offers a monitor chooser. The app waits for the player to acknowledge readiness and verifies the media before starting; a failure retains the request for deliberate retry. App launch/restart never starts music automatically.

**Previous — Restart Current Song** seeks the same performance to the beginning and resumes it if paused. It does not choose a previous queue item, consume a turn, or change singers. The normal timeline also supports scrubbing and ten-second seek actions.

Each local media range uses a verified open file handle. A changed or replaced source is rejected and the current performance pauses with a restore/relink recovery message. This catches observed changes before a range is served; it does not promise immutable source files against every possible concurrent in-place write.

## Catalog and Heart Ratings

Search **Song Library** with **All Songs** selected to see a separate **Service Catalogs — Search Only** section. KaraFun and Party Tyme use official public metadata; they need no login or paid API plan for search. In the 0.4.3 development build, Sunfly defaults to public Store title/SF-SKU search when no developer profile is selected; this covers at most five first-page individual-song products, not the complete streaming catalog. Artist search is not verified. Protected Sunfly and Stingray still require provider-issued developer profiles, selected with the native picker in **Sources → Third-Party Services**; live partner access remains unconfirmed. Each result shows the service name beside the artist. **View on Provider**, when offered, opens an official page; these rows cannot enter the queue or play in the booth.

Sources distinguishes public/developer catalog modes. **Choose Developer Profile…** selects optional protected Sunfly access. **Use Public Store Search** clears its selection only and retains the credential file; a bad explicitly selected profile is an error, never a silent public fallback. Stingray's **Remove Profile Selection** likewise keeps its file and leaves Stingray unconfigured. Store results retain the exact SF SKU separately from `store:productID`; these store identities are not streaming identities or proof of subscription access. Missing artist/duration remains unknown; enrichment never guesses from a URL slug.

**Preferences → Karaoke Services → Search service catalogs in Song Library** is on by default. Save to apply changes. KaraFun/Party Tyme snapshots are held only while the app is running, with a 24-hour refresh interval; failed refreshes may retain a clearly labeled older complete public snapshot. Sunfly Store query results are cached for five minutes and matching product detail for 24 hours in the main process. No central or disk cache exists for these catalogs yet. Strict show age restrictions or a version allowlist block provider discovery at the host boundary; local and Karaoke Nerds behavior continues normally. See [provider catalog setup and limits](provider-catalog-search.md).

Fresh installs can search the shared Karaoke Nerds catalog without a reader configuration file or a bundled secret. Optional private catalog profiles remain supported; an invalid selected private file is reported rather than bypassed. The recovered snapshot's upstream freshness is still unknown and automatic feed refresh remains disabled. Saved searches can be reused offline. See [shared catalog help](shared-catalog.md).

Heart controls in library search, the queue and On Stage use exact recording identities. YouTube/Karaoke Nerds recordings use their case-sensitive YouTube IDs and share average/count and the configured host's vote through the global MySQL-backed service. A source-less file uses its imported SHA256 fingerprint and saves **Your Local Rating** in this host's `show.sqlite`; it works offline without a remote profile. Identical file contents share the local rating, while separately converted CDG backdrops may produce a different fingerprint. Artist/title edits do not merge recordings.

Open the heart control to choose 1–10 hearts, save a replacement or clear the current vote. A global vote needs a provisioned private writer profile; a catalog-reader token does not grant write access. Public lookup remains aggregate-only. The interface checks capability per recording so a shared outage or read-only profile does not disable local ratings. A failed global write is never relabeled as a successful local save. Use **Preferences → Song Ratings** to select/check a private profile; a draft check does not apply it or delete the file. Remote singer voting and cross-device person ownership remain planned. These hearts are separate from Clean/Explicit classifications. See [ratings help](song-ratings.md).

## Launcher Flags

Run the installed executable with `--settings` or `--keybindings`. It opens the requested section in the already-running app for that profile, or starts one stopped at that view. When both flags are supplied, Keyboard Shortcuts wins. No second show database writer is started.

These navigation flags are implemented independently of the API. The initial authenticated local control API and structured command-line tool also passed an actual Windows app/compiled CLI rehearsal for reads and settings navigation; full show mutations remain planned. Capability discovery reports only implemented controls.

## Initial Local API and CLI

Enable **Preferences → Local API and CLI → Enable Local API and CLI**, then save. The API binds only to this computer and publishes a private per-start credential. **Check Local API** reports readiness; **Show CLI Tool** locates the CLI wrapper. Source packaging wiring provides `tpv-karaoke.cmd` for Windows and `tpv-karaoke` for installed/extracted Linux packages. These wrappers reuse the app runtime, so a separate Node installation is unnecessary. Windows and Linux 0.4.1 bundled-wrapper verification passed. Earlier versions may not include these wrappers. AppImage helper/extraction and macOS packaging require their release-specific instructions and verification.

```text
tpv-karaoke.cmd status
tpv-karaoke.cmd capabilities
tpv-karaoke.cmd state
tpv-karaoke.cmd settings
tpv-karaoke.cmd shortcuts
tpv-karaoke.cmd open keybindings
```

These commands use structured JSON and stable exit codes. The direct wrapper flags `--settings` and `--keybindings` launch or focus the desktop view without requiring the API. A direct Node invocation of the control entry treats these as API navigation aliases instead. For a custom running profile, use `--profile-dir` with the control commands; the desktop launcher uses `--user-data-dir`.

The initial API reads current host state, settings and shortcuts, reports capabilities, and queues Preferences/Keyboard Shortcuts navigation. It cannot yet change playback, requests, providers or other show data. Disabling it or quitting closes its listener and removes only its own ephemeral connection file. A restart rotates the token. Do not share the connection file. Future command writes need durable caller IDs and outcome lookup before automatic retry can be safe. See [API and CLI details](local-control-api.md).
