# Host Workspace

## Workspace in 0.7.1

The search-results area is the main workspace, with larger readable song rows and brief status text. A global search field above Workspace in the sidebar remains available from Library, Playlists, Sources and host-only areas. Ctrl/Cmd+F or the assigned search shortcut returns to Library and focuses it. The search box has one visible outer focus ring; the input does not draw a second inner glow. Details belong in immediate (?) tooltips rather than long repeated instructions. Informational notices clear after eight seconds; errors remain until dismissed.

This guide describes 0.7.1 source behavior. Earlier Windows/Linux/macOS packages were verified separately; see [installation](installation.md) for actual artifacts and platform limits. A new source feature is not evidence of a rebuilt or installed package. Physical show hardware, real-user Linux installation and remaining Mac installation/runtime checks stay open.

## Optional Singer Assignment

In **Add to Queue**, leave **Singer (optional)** empty to add a song without assigning anyone. This works for local, Karaoke Nerds, YouTube and connected native KaraFun recordings. The queue shows **Unassigned**; no singer profile is created. Right-click a waiting or prepared request to assign, change or clear its singer later. A prepared request retains its ID and queue slot; an active performance cannot be edited.

Unassigned requests retain FIFO order and each gets its own place in the current eligible fair round (the next round if the final turn has already begun). They do not share a fake singer, singer absence state or per-singer request limit. Remote singer requests still belong to the signed-in session's singer. Back up before the schema-5 upgrade; older apps cannot open the upgraded database.

## Preview and Resizable Panels

The **Singer Preview** shows the singer screen even before its window is opened. One hidden singer renderer provides the real picture and audio; preview is a silent capture, not another player. The display button reveals that same window. Closing it hides it while preview/audio continue. Choose **Preferences → Appearance → Singer Preview Position** for above, below or hidden.

Drag the separators between the sidebar, library and Host Queue, or between the preview and queue. Wide Song Library uses a horizontal queue-height separator. Focus a separator and use arrow keys to resize; hold Shift for a larger step. Double-click restores that separator's default size. Sizes save when the drag or key adjustment commits, and fit the current viewport without overwriting larger saved desktop dimensions. **Reset Panel Sizes** in Appearance restores the defaults when preferences are saved. Transport controls stay visible while the library's combined local/service/YouTube results scroll.

## Song and Artist Blacklists

Open **Preferences → Song and Artist Blacklist** to add or remove artist names and artist/title pairs. Save to apply the draft; Cancel leaves saved rules intact. A song rule covers every version matching that complete artist and title across sources. An artist rule covers that artist's songs. Matches fold case, spacing and typographic equivalents; they do not use substring or wildcard matching. An empty artist means unknown-artist results only.

Right-click a library row for **Blacklist Song**, **Blacklist Artist** or **Manage Blacklist…**. These rules belong to the host settings across shows, separate from a show's clean/explicit and version-specific policy. They filter discovery and are checked again at request/playback boundaries. Existing queue items are retained with unavailable status so the host can remove or change them deliberately.

## YouTube Karaoke Search

With **All Songs** selected, type at least two characters in global search to include online sources. Local, Karaoke Nerds, curated YouTube, connected KaraFun and public service matches share one selectable list. YouTube discovery uses bounded yt-dlp search, adds karaoke and excludes live/private/restricted/out-of-range candidates. Video/channel hints and artist/title suggestions are heuristics rather than a quality guarantee.

Choose **Preferences → YouTube Search → Approved channels only** for stricter curation. Add channel IDs/handles manually or import a Google Takeout subscriptions CSV/JSON file. The app does not sign into the private subscriptions feed or extract browser cookies. **Block Channel** on a candidate persists a channel rule; blocked IDs/handles override approvals. A subscribed channel still needs a karaoke-indicated candidate.

**Add to Queue** opens the optional singer dialog. Leave **Singer (optional)** empty to queue an unassigned song, or choose/create a singer. Submission validates a current-search receipt and policy before committing the recording/request. Approved requests dispatch permanent acquisition and automatically prepare/stage; manual moderation waits for Accept. Queuing or finishing a download alone never starts a new show. An already running automatic show may advance to that eligible turn after the gap.

## LAN Singer Screens

Open **Remote Sessions → LAN Singer Screens** or the sharing controls under **Preferences → Singer Display**. Port 4051 is the default. Copy a displayed private-interface address to venue browsers; numeric addresses work without mDNS. This is a silent visual mirror, separate from singer requests. Windows sharing requires verified Private network classification as well as a private address. Unknown/Public profiles stay loopback-only; a 30-second recheck and bounded 5-second classification timeout remove lost trust. No firewall rule or organisation-managed setting is changed. See [LAN setup and limits](singer-screen-sharing.md).

## Native KaraFun in 0.7.0

Open **Sources → KaraFun → Sign In to KaraFun** and complete the official sign-in window. Search the unified library, choose a connected KaraFun recording and leave the singer empty or enter/select one. Accepted requests prepare and stage automatically; pending moderation waits. Check **Song Preparation** in Sources and Retry failures there. Press Play to start the show; automatic advancement handles later eligible turns after the gap/media readiness. KHost is unnecessary for this native path.

A muted real-account Windows rehearsal on 15 November 2026 passed official sign-in, search, queue/preparation, native playback, pause, seek, Previous, sign-out and paused restart. Version 0.7.0 adds OS-encrypted remembered sign-in where safeStorage is available; the next launch validates it and reuses the same opaque account cache identity. Linux plaintext fallback is refused. Explicit sign-out forgets the saved session and silences native playback. Expiry offers normal sign-in; retained media never bypasses per-performance authorization. Primary completed lyrics use KaraFun pink. Native community playback, user stem mixing, pitch/tempo and fixed-mix fallback remain planned. Physical audio, full-song listening, device recovery, Linux/macOS native provider playback and distribution terms remain open. See [native limits](karafun-native-integration.md).

## Optional KaraFun via KHost

**Sources → KaraFun via KHost** uses the independently installed KHost application and optional TPV companion plugin. Sign in and confirm normal KaraFun playback inside KHost first, enable the bridge plugin there, then explicitly select its private connection profile in TPV. **Search KaraFun Through KHost** returns external results; choose the singer in KHost and use **Send to KHost (External Queue)** to hand one over. This affects KHost's queue and may show its prompts. It does not add a playable TPV queue item or start playback here.

Current content restrictions and song/artist blacklists apply before search/handoff. If a send becomes uncertain, use **Check Handoff Status** and inspect KHost's queue before clearing the warning; clearing never resends a song. Account sign-in, downloads and playback stay inside KHost. The owner reports their separate KHost subscription works, but actual authenticated bridge use on their target machine remains unverified. See [bridge installation, recovery and limits](khost-bridge.md).

## Navigation and Menus

The larger sidebar links put **Library**, **Playlists** and **Sources** first. **Requests**, **Singers** and **Remote Sessions** form the Host Workspace group at the bottom. Sources contains native KaraFun sign-in/preparation, Karaoke Nerds discovery, the Custom YouTube Video Importer and Third-Party Services catalog search/configuration. Other paid-provider playback still needs access and implementation.

Use **File → Import** for **Import Video File**, **Import Custom Directory**, or **Import CD+G / ZIP**. The same three import icons are next to the Song Library heading. CDG conversion progress and cancellation stay visible while a job runs. **Back up show…** is in File; database backups do not include song media or preferences.

**View → Appearance** opens appearance settings or selects System, Night or Day. **View → Choose Accent Color** selects Blue, Pink or Purple. **View → Layout** selects Standard, Wider Singer Rotation or Wide Song Library. The palette icon opens the Appearance preferences section. These choices do not interrupt a performance.

## Booth Branding and Bumper Music

Under **Singer Display**, set a booth name, choose a PNG/JPEG logo and adjust its size from 10–85% of viewport width. The chosen image immediately appears beside the picker. The interlude shows the booth name. A scrolling banner can run at the top or bottom indefinitely or until an expiry; it resets next launch unless **Show After Restart** is selected. Saved text is retained for reuse.

**Audio Controls** separately enables launch bumper and between-song bumper, both on by default. Fade-in defaults to 1000 ms, adjustable from 500–1700 ms. Select one of three generated themes or up to five custom files. The default audio output works; no visible singer window is required. Music after completion/Skip waits for karaoke-silence acknowledgement, and the next karaoke waits for bumper-stop acknowledgement. Output changes stop automation and need deliberate recovery. See [bumper behavior](bumper-playback-design.md).

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

Approved eligible requests stage automatically. Press **Play/Pause** to start the first turn or resume a paused one. The singer window reveals on its saved connected monitor, then the nearest non-host monitor, then the current screen. Automatic advancement defaults on: completion/confirmed Skip waits for the 0–300-second gap and ready media, then starts the next turn. Zero gap avoids filler flash. Stop/Pause, output/display loss and errors cancel delayed starts; Stop also stops interlude music. Failed preparation retains its request for Retry/Relink. Launch/restart never resumes karaoke; bumper launch music is a separate preference.

**Previous — Restart Current Song** seeks the same performance to the beginning and resumes it if paused. It does not choose a previous queue item, consume a turn, or change singers. The normal timeline also supports scrubbing and ten-second seek actions.

Each local media range uses a verified open file handle. A changed or replaced source is rejected and the current performance pauses with a restore/relink recovery message. This catches observed changes before a range is served; it does not promise immutable source files against every possible concurrent in-place write.

## Catalog and Heart Ratings

The unified result list identifies each provider with a label and 3px left border: local/imported purple `#601CE9`, Karaoke Nerds blue `#007bff`, YouTube red `#ff0033`, KaraFun pink `#d5167a`. Right-click any source for the common menu; unsupported actions are disabled. Connected native KaraFun can queue. Public KaraFun/Party Tyme and available Sunfly/Stingray metadata remains explicitly Search Only until playable. Public KaraFun/Party Tyme requires no account; Sunfly Store is bounded title/SF-SKU discovery, while protected Sunfly/Stingray still requires issued profiles. See [provider limits](provider-catalog-search.md).

Sources distinguishes public/developer catalog modes. **Choose Developer Profile…** selects optional protected Sunfly access. **Use Public Store Search** clears its selection only and retains the credential file; a bad explicitly selected profile is an error, never a silent public fallback. Stingray's **Remove Profile Selection** likewise keeps its file and leaves Stingray unconfigured. Store results retain the exact SF SKU separately from `store:productID`; these store identities are not streaming identities or proof of subscription access. Missing artist/duration remains unknown; enrichment never guesses from a URL slug.

**Preferences → Karaoke Services → Search service catalogs in Song Library** is on by default. Save to apply changes. KaraFun/Party Tyme snapshots are held only while the app is running, with a 24-hour refresh interval; failed refreshes may retain a clearly labeled older complete public snapshot. Sunfly Store query results are cached for five minutes and matching product detail for 24 hours in the main process. No central or disk cache exists for these catalogs yet. Strict show age restrictions or a version allowlist block provider discovery at the host boundary; local and Karaoke Nerds behavior continues normally. See [provider catalog setup and limits](provider-catalog-search.md).

Fresh installs can search the shared Karaoke Nerds catalog without a reader configuration file or a bundled secret. Optional private catalog profiles remain supported; an invalid selected private file is reported rather than bypassed. The recovered snapshot's upstream freshness is still unknown and automatic feed refresh remains disabled. Saved searches can be reused offline. See [shared catalog help](shared-catalog.md).

Heart controls in the library, queue and On Stage use exact recording identities. YouTube/Karaoke Nerds uses its YouTube ID. Version 0.7.0 adds `karafun:catalog:NUMERIC_ID` and `karafun:community:NUMERIC_ID` without requiring an imported fingerprint; the matching service validator must be deployed before production accepts these keys. No SQL migration is needed. Source-less files use imported SHA256 and save **Your Local Rating** in this host show, offline. Artist/title edits never merge different recordings.

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
