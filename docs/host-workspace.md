# Host Workspace

Use **File** to import videos, folders, and paired lyric files or to back up and restore your show. Open **Edit → Preferences** for settings. **View** changes the appearance, accent color, font, and layout. **Playback** exposes transport controls, including restart and 10-second seek actions. Use **Window** to control full screen separately for the host and singer display. **Help → Documentation** opens the [offline guides](help.md).

## App Updates

In **Edit → Preferences → Updates**, set **Available Updates Mechanism** and click **Save**. **Notify me on startup** is the default and offers the release page when a newer version is available. **Download Only** saves the verified package for later. Use **Show Download** to find it. **Download and Install** prepares the package and applies it after a normal quit, when the show and rooms are saved and closed. **Do Nothing** turns off automatic checks. **Check Now** is available for a manual check in any mode.

The Windows setup, macOS PKG, and Linux Debian package open with the system installer and can require approval. A writable AppImage updates in place after quit. The portable Windows ZIP can be downloaded from Preferences for manual extraction.

## Applause and Singer Points

Preferences → Audio Controls has **Enable applause**, and Queue Management has **Enable singer points**. Both start enabled. Use the applause button beside the transport controls whenever you want to play a clap sound over the current audio. The app cycles the six supplied clap recordings, playing each for its full duration, with at most three at once; the host has unlimited applause. Recordings range from approximately 4 to 11.2 seconds, so the longest takes more than eight seconds to finish. Check the chosen output and levels on your actual sound system before a show.

Singers start with three applause credits, gain one for a completed song and can hold at most five. The Singers workspace shows their points and credits. Assigned singers earn points from song requests, duet participation and applause; room singers can also earn points for missing-song suggestions and sending a photo to the singer screen. The full rules and eligibility are in the product specification. Mark duets in the song's metadata so the correct duet bonus can be awarded.

Room singers can send one JPEG or PNG photo at a time. A mobile Full Host reviews the image before it appears on the singer screen. Photos stay in memory. See the [mobile guide](mobile-app.md) for approval and discard controls.

## Choose Search Sources

Open **Sources → Show in Search** to toggle Imported / Local, Karaoke Nerds, YouTube, KaraFun, Party Tyme, Sunfly or Stingray individually. All are enabled by default; existing account and catalog settings still apply. Disabling a source hides it from host and singer browsing and blocks new singer requests for that source, but leaves queued or playing songs, saved files and connected accounts in place. Singer pages refresh every 15 seconds and may briefly show an old row; a new request for a disabled source is rejected immediately. Turning off YouTube discovery does not stop Karaoke Nerds video downloads.

New unbranded Karaoke Nerds entries retain their catalog origin. Older saved YouTube recordings without a brand or stored origin cannot be reliably distinguished from Karaoke Nerds recordings and may be classified as YouTube; an existing YouTube identity is not silently reclassified if reused.

## Install the Command-Line Tool

The Windows setup, Debian package, and macOS PKG provide `tpv-karaoke-booth` on PATH. Open a new terminal and run `tpv-karaoke-booth --help`. With a portable Windows ZIP or a Mac app installed from the DMG, use **Preferences → Local API and CLI → Install CLI to PATH** to set up the command for your account. See the [installation guide](installation.md).

Enable the Local API separately when you want to use authenticated control commands. `--help` works without a running host. See [Local API and CLI](local-control-api.md) for available commands.

## Downloading Songs and Song Gaps

Queued YouTube, KaraFun and Party Tyme songs that are still being prepared are shaded and show a status. When a song's turn arrives before its media is ready, the next ready song plays and the waiting request is reconsidered after it finishes. This repeats until the waiting song is ready. If every eligible song is still preparing, an automatically advancing show waits for one to become ready. Right-click a failed request and choose **Retry song preparation**.

Set **Preferences → Queue Management → Automatically play next song** and **Preferences → Audio Controls → Pause Interval** to control the transition and gap. The interval ranges from 0 to 300 seconds. Starting a show still requires the host to press Play.

## Search the Library

The search-results area is the main workspace, with larger readable song rows and brief status text. A global search field above Workspace in the sidebar remains available from Library, Playlists, Sources and host-only areas. Ctrl/Cmd+F or the assigned search shortcut returns to Library and focuses it. The search box has one visible outer focus ring; the input does not draw a second inner glow. Details belong in immediate (?) tooltips rather than long repeated instructions. Informational notices clear after eight seconds; errors remain until dismissed.

See [installation](installation.md) for available packages and [release acceptance](release-acceptance.md) for platform and hardware checks.

## Optional Singer Assignment

In **Add to Queue**, leave **Singer (optional)** empty to add a song without assigning anyone. This works for local, Karaoke Nerds, YouTube and connected native KaraFun recordings. The queue shows **Unassigned**; no singer profile is created. Queued requests remain editable, removable and reorderable until playback starts, including a song that has already been prepared. Right-click to change the track or singer; use drag, arrow controls or promotion to adjust the order. The app can prepare a different next song without starting it. If the host changes a request while its Start checks are still running, the obsolete start is cancelled and the host is asked to review the queue and press Play again. An active performance remains protected.

Unassigned requests retain FIFO order and each gets its own place in the current eligible fair round (the next round if the final turn has already begun). They do not share a fake singer, singer absence state or per-singer request limit. Remote singer requests still belong to the signed-in session's singer. Back up before the schema-5 upgrade; older apps cannot open the upgraded database.

## Preview and Resizable Panels

The **Singer Preview** shows the singer screen even before its window is opened. One hidden singer renderer provides the real picture and audio; preview is a silent capture, not another player. The display button reveals that same window. Closing it hides it while preview/audio continue. Choose **Preferences → Appearance → Singer Preview Position** for above, below or hidden.

Drag the separators between the sidebar, library and Host Queue, or between the preview and queue. Wide Song Library uses a horizontal queue-height separator. Focus a separator and use arrow keys to resize; hold Shift for a larger step. Double-click restores that separator's default size. Sizes save when the drag or key adjustment commits, and fit the current viewport without overwriting larger saved desktop dimensions. **Reset Panel Sizes** in Appearance restores the defaults when preferences are saved. Transport controls stay visible while the library's combined local/service/YouTube results scroll.

## Song and Artist Blacklists

Open **Preferences → Song and Artist Blacklist** to add or remove artist names and artist/title pairs. Save to apply the draft; Cancel leaves saved rules intact. A song rule covers every version matching that complete artist and title across sources. An artist rule covers that artist's songs. Matches fold case, spacing and typographic equivalents; they do not use substring or wildcard matching. An empty artist means unknown-artist results only.

Right-click a library row for **Blacklist Song**, **Blacklist Artist** or **Manage Blacklist…**. These rules belong to the host settings across shows, separate from a show's clean/explicit and version-specific policy. They filter discovery and are checked again at request/playback boundaries. Existing queue items are retained with unavailable status so the host can remove or change them deliberately.

## YouTube Karaoke Search

With **All Songs** selected, type at least two characters in global search to include online sources. Local, Karaoke Nerds, curated YouTube, connected KaraFun and public service matches share one selectable list. YouTube discovery uses bounded yt-dlp search, adds karaoke and excludes live/private/restricted/out-of-range candidates. Video/channel hints and artist/title suggestions are heuristics rather than a quality guarantee.

KaraFun results, including previously saved recordings, are hidden until Sources reports a connected account. Signing out hides pending search replies immediately. Other libraries stay available. Generic YouTube results, including cached recordings, are the last fallback even when sorting: they are hidden when another visible source has the same artist and title. Fresh YouTube discoveries also defer to an existing saved YouTube recording. Missing artists and different live/remix titles stay distinct. This changes discovery visibility, not your saved recordings, metadata, ratings or queue.

Choose **Preferences → YouTube Search → Approved channels only** for stricter curation. Add channel IDs/handles manually or import a Google Takeout subscriptions CSV/JSON file. The app does not sign into the private subscriptions feed or extract browser cookies. **Block Channel** on a candidate persists a channel rule; blocked IDs/handles override approvals. A subscribed channel still needs a karaoke-indicated candidate.

**Add to Queue** opens the optional singer dialog. Leave **Singer (optional)** empty to queue an unassigned song, or choose/create a singer. Submission validates a current-search receipt and policy before committing the recording/request. Approved requests dispatch permanent acquisition and automatically prepare/stage; manual moderation waits for Accept. Queuing or finishing a download alone never starts a new show. An already running automatic show may advance to that eligible turn after the gap.

## LAN Singer Screens

For the mobile app, **Preferences → Remote Queueing → Suggest my active internet room to nearby mobile singers** defaults on. It advertises only a live room's public join address on trusted private interfaces and allows same-internet-connection suggestions. A singer still chooses to join; discovery grants no host controls. Disable it to use manual room links only. See [mobile modes](mobile-app.md).

Open **Remote Sessions → LAN Singer Screens** and select **Start Singer-Screen Sharing**. On Windows, start sharing again after each launch. **Preferences → Singer Display** retains your preference and port, which defaults to 4051. Copy a displayed Private-network address to each venue browser. This is a silent visual mirror, separate from singer requests. Windows verifies each adapter's Private classification before opening its address, and rechecks trust every 30 seconds. See [LAN setup and limits](singer-screen-sharing.md).

## Native KaraFun in 0.7.0

Open **Sources → KaraFun → Sign In to KaraFun** and complete the official sign-in window. Search the unified library, choose a connected KaraFun recording and leave the singer empty or enter/select one. Accepted requests prepare and stage automatically; pending moderation waits. Check **Song Preparation** in Sources and Retry failures there. Press Play to start the show; automatic advancement handles later eligible turns after the gap/media readiness. KHost is unnecessary for this native path.

If the app could not check your remembered session at launch, use **Retry Saved Sign-In** in Sources. The app keeps the encrypted session through temporary service or secure-storage errors and a cancelled new login. Sign in again if KaraFun confirms it has expired or the saved record is unreadable.

A muted real-account Windows rehearsal on 15 November 2026 passed official sign-in, search, queue/preparation, native playback, pause, seek, Previous, sign-out and paused restart. Version 0.7.0 adds OS-encrypted remembered sign-in where safeStorage is available; the next launch validates it and reuses the same opaque account cache identity. Linux plaintext fallback is refused. Explicit sign-out forgets the saved session and silences native playback. Expiry offers normal sign-in; retained media never bypasses per-performance authorization. Primary completed lyrics use KaraFun pink. Native community playback, pitch/tempo and fixed-mix fallback remain planned. Version 0.8.0 adds the per-channel Vocal Mix controls described below. Physical audio, full-song listening, device recovery, Linux/macOS native provider playback and distribution terms remain open. See [native limits](karafun-native-integration.md).

## Vocal Mix in 0.8.0

During a prepared native KaraFun performance, choose **Vocal Mix** beside the playback controls. Each supplied instrumental, lead or backing channel has its own 0–100% slider. Duets and multiple backing parts appear separately when provided; the app cannot separate voices already mixed into one stem. Lead vocals start at 0%; instrumental/backing/other channels start at 100%. Master Volume still controls the complete output.

Changes apply immediately without restarting the track, including with the singer window hidden. Pause, seek and Previous retain the current mix. **Reset This Song** restores its starting levels. Stop, sign-out or a new performance clears the mix; it is not a saved per-song or per-singer preference. Unavailable/non-native recordings keep the button disabled. These controls were verified with synthetic Ogg audio; listen through the intended mixer before using them in a show.

## Optional KaraFun via KHost

**Sources → KaraFun via KHost** uses the independently installed KHost application and optional TPV companion plugin. Sign in and confirm normal KaraFun playback inside KHost first, enable the bridge plugin there, then explicitly select its private connection profile in TPV. **Search KaraFun Through KHost** returns external results; choose the singer in KHost and use **Send to KHost (External Queue)** to hand one over. This affects KHost's queue and may show its prompts. It does not add a playable TPV queue item or start playback here.

Current content restrictions and song/artist blacklists apply before search/handoff. If a send becomes uncertain, use **Check Handoff Status** and inspect KHost's queue before clearing the warning; clearing never resends a song. Account sign-in, downloads and playback stay inside KHost. The owner reports their separate KHost subscription works, but actual authenticated bridge use on their target machine remains unverified. See [bridge installation, recovery and limits](khost-bridge.md).

## Navigation and Menus

The larger sidebar links put **Library**, **Playlists** and **Sources** first. **Requests**, **Singers** and **Remote Sessions** form the Host Workspace group at the bottom. Sources contains native KaraFun sign-in/preparation, Karaoke Nerds discovery, the Custom YouTube Video Importer and Third-Party Services catalog search/configuration. Other paid-provider playback still needs access and implementation.

The **File** menu includes **Import Video**, **Import Folder**, and **Import CD+G / LRC / ZIP**. The same actions are available next to the Song Library heading. CDG and LRC conversion progress and cancellation stay visible while a job runs. **Back up show…** saves the show database. Back up song media and preferences separately.

To restore a show, stop playback, finish any active import or relink, and choose **File → Restore Show Backup…**. Review the backup counts before confirming. Booth saves the current show under `show-restore-backups` in app data, ends remote sessions, and restarts silently. A restored performance stays paused until you press Play.

After moving media or restoring a show, open **Song Library → Review Missing Files**. Search the affected songs, then use **Relink File** to choose the original or an identical copy. Choose **Check Again** after reconnecting a drive. The review shows filenames without folder paths and checks saved locations for local songs that the current show permits.

Under **Singers**, open a singer’s **Actions** menu and choose **Hold until returned** to let the queue continue while they are away. Their existing requests and any current performance stay in place. Only the host can choose **Return now** after an indefinite hold.

To move a playlist, choose **Export Playlist** in **Singer Playlists** or **KJ Picks**. On the receiving booth, choose **Import Playlist** and review the exact matches. Confirm a new playlist for an active singer, or add the available matches to KJ Picks. Import the media separately. Export asks for a new file and keeps an existing file at the chosen location.

**View → Appearance** opens appearance settings or selects System, Night or Day. **View → Choose Accent Color** selects Blue, Pink or Purple. **View → Layout** selects Standard, Wider Singer Rotation or Wide Song Library. The palette icon opens the Appearance preferences section. These choices do not interrupt a performance.

## Booth Branding and Bumper Music

Under **Singer Display**, set a booth name, choose a PNG/JPEG logo and adjust its size from 10–85% of viewport width. The chosen image immediately appears beside the picker. The interlude shows the booth name. A scrolling banner can run at the top or bottom indefinitely or until an expiry; it resets next launch unless **Show After Restart** is selected. Saved text is retained for reuse.

**Audio Controls** separately enables launch bumper and between-song bumper, both on by default. Fade-in defaults to 1000 ms, adjustable from 500–1700 ms. Select one of three generated themes or up to five custom files. The default audio output works; no visible singer window is required. Music after completion/Skip waits for karaoke-silence acknowledgement, and the next karaoke waits for bumper-stop acknowledgement. Output changes stop automation and need deliberate recovery. See [bumper behavior](bumper-playback-design.md).

## Preferences and Keyboard Shortcuts

Choose **Preferences → Appearance → Font** to change the typeface used in the host workspace, singer-screen overlays, and native KaraFun lyrics. Options include Booth Default, System Sans, Serif, and Monospace. The singer preview and shared screens mirror the singer display. Imported videos and converted CD+G or LRC lyrics retain their rendered style.

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

The unified result list identifies each provider with a label and 3px left border: local/imported purple `#601CE9`, Karaoke Nerds blue `#007bff`, YouTube red `#ff0033`, KaraFun pink `#d5167a`. Right-click any source for the common menu; unsupported actions are disabled. Connected KaraFun and Party Tyme consumer Premium can queue. KaraFun rows stay hidden while signed out. The separate public Party Tyme Pro export and available Sunfly/Stingray metadata remain explicitly Search Only. Sunfly Store is bounded title/SF-SKU discovery, while protected Sunfly/Stingray still requires issued profiles. See [provider limits](provider-catalog-search.md).

Sources distinguishes public/developer catalog modes. **Choose Developer Profile…** selects optional protected Sunfly access. **Use Public Store Search** clears its selection only and retains the credential file; a bad explicitly selected profile is an error, never a silent public fallback. Stingray's **Remove Profile Selection** likewise keeps its file and leaves Stingray unconfigured. Store results retain the exact SF SKU separately from `store:productID`; these store identities are not streaming identities or proof of subscription access. Missing artist/duration remains unknown; enrichment never guesses from a URL slug.

**Preferences → Karaoke Services → Search service catalogs in Song Library** is on by default. Save to apply changes. Public Party Tyme Pro snapshots are held only while the app is running, with a 24-hour refresh interval; failed refreshes may retain a clearly labeled older complete public snapshot. Sunfly Store query results are cached for five minutes and matching product detail for 24 hours in the main process. No central or disk cache exists for these catalogs yet. Strict show age restrictions or a version allowlist block provider discovery at the host boundary; local and Karaoke Nerds behavior continues normally. See [provider catalog setup and limits](provider-catalog-search.md).

Fresh installs can search the shared Karaoke Nerds catalog without a reader configuration file or a bundled secret. Optional private catalog profiles remain supported; an invalid selected private file is reported rather than bypassed. The recovered snapshot's upstream freshness is still unknown and automatic feed refresh remains disabled. Saved searches can be reused offline. See [shared catalog help](shared-catalog.md).

Star controls in the library, queue and On Stage use exact recording identities. YouTube/Karaoke Nerds uses its YouTube ID. Version 0.7.0 adds `karafun:catalog:NUMERIC_ID` and `karafun:community:NUMERIC_ID` without requiring an imported fingerprint; the matching service validator is deployed and has passed disposable-voter checks. No SQL migration is needed. Source-less files use imported SHA256 and save **Your Local Rating** in this host show, offline. Artist/title edits never merge different recordings.

Open the rating control and choose 1–10 stars. Selecting a star saves immediately; the control closes after the save is confirmed, or remains open with an error if saving fails. **Clear My Rating** removes the vote after confirmation. A global vote needs a provisioned private writer profile; a catalog-reader token does not grant write access. Public lookup remains aggregate-only. The interface checks capability per recording so a shared outage or read-only profile does not disable local ratings. A failed global write is never relabeled as a successful local save. Use **Preferences → Song Ratings** to select/check a private profile; a draft check does not apply it or delete the file. Remote singer voting and cross-device person ownership remain planned. These stars are separate from Clean/Explicit classifications. See [ratings help](song-ratings.md).

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

## Party Tyme Consumer Premium

Version 0.9.1 connects **Sources → Party Tyme → Connect Party Tyme…** through a selected private credentials file. Use one username:password line or JSON with username/email and password. The accepted session is remembered securely when available; the password is not copied into the saved session. Pro credentials use a separate service.

Search and right-click Party Tyme results to add them to the ordinary queue with an optional singer. For a successful empty multiword search, the app retries one word and checks all words against artist and title; a true empty result is shown as no matches, not an error. Preparation starts in the background; its progress and retry are in Sources. Play/Pause, seek, Previous, volume and the singer display use the normal transport. Each start/resume requires a fresh account and recording check, even with cached media. Sign-out stops playback. This consumer path has no separate vocal stems or verified commercial-hosting rights; see [setup and verification](partytyme-consumer-integration.md).


### Singers and playlists

In **Singers**, right-click a singer or choose their actions button for availability and **Remove from show**. Removal requires confirmation and is blocked until their pending, waiting, staged or playing songs, including duets, are removed or reassigned. It archives their show identity: existing history, playlist ownership and points remain, but the singer no longer appears in new song selections and their remote session and resume access end. A returning person can join again as a new singer.

In **Playlists → Singer Playlists**, search the visible list by playlist or singer name and select a result. Expand **Create a playlist** to add one for an active singer. Existing playlists belonging to removed singers retain their names and contents.


Choose **Share Internet Screen** under an active internet session. Share the complete link only with intended viewers. It contains a fresh private viewing code after `#`. The published 0.10.3 desktop app copies a `queue.thepropervolume.com` link. To use the shorter address in that build, replace only the hostname with `booth.thepropervolume.com`, keeping the path and the code. The screen shows about one frame per second for up to 32 concurrent browsers. Audio plays at the venue. Stopping sharing or ending the room revokes future frame access. A viewer may retain an image their browser already received.


In **Preferences → Library Settings**, choose **Preview filename metadata changes** to compare existing artist/title metadata with the current saved filename templates. Review the before/after list, choose individual entries or **Select all**, then **Apply selected**. Nothing is selected initially. The app skips songs changed since the preview, reports success and failure, and does not write file tags. Older manual changes cannot always be recognized; inspect the suggestions before applying.

For an imported local MP4, right-click the song and open **Edit Song Details → Read Embedded Tags**. Booth checks that the file still matches the imported recording and shows the title and artist that FFprobe reports. Choose either field, then **Save Details** to update the library. The original file is read-only throughout this edit. Install FFprobe on `PATH` to use this feature.


### Upgrade backups and approximate queue waits

In 0.10.4 source, opening an older show database creates and verifies a standalone copy in `show-upgrade-backups` in the app-data directory before the upgrade. If the backup cannot be created or validated, the upgrade stops; check free space and folder access before reopening. The copy contains the database, not media or settings. On Windows it inherits the parent directory's permissions. An in-app restore is not yet available.

During active playback with automatic advance enabled, eligible queue rows show an approximate wait. The calculation uses the current song's remaining time, the configured gap, and four minutes plus a gap per earlier ready song, rounded up to a minute. It assumes uninterrupted playback and playable files. Paused/stopped playback, disabled automatic advance, missing or changing timeline information, or an unready singer/song can make an estimate and following estimates unavailable. Actual waits vary.
