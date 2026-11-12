# Host Workspace

Version 0.4.0 brings the library, transport, preferences and source controls into one workspace. It remains a development rehearsal build; physical audio/display and installation checks still apply.

## Navigation and Menus

The larger sidebar links put **Library**, **Playlists** and **Sources** first. **Requests**, **Singers** and **Remote Sessions** form the Host Workspace group at the bottom. Sources contains Karaoke Nerds discovery, the Custom YouTube Video Importer and the status of Third-Party Services. Paid-provider playback is still pending approved access.

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

Fresh installs can search the shared Karaoke Nerds catalog without a reader configuration file or a bundled secret. Optional private catalog profiles remain supported; an invalid selected private file is reported rather than bypassed. The recovered snapshot's upstream freshness is still unknown and automatic feed refresh remains disabled. Saved searches can be reused offline. See [shared catalog help](shared-catalog.md).

Heart controls in search results, the queue and On Stage show the shared average and count. Open one to choose 1–10 hearts. A provisioned private rating profile permits **Your host rating**, one current vote per exact recording; saving a different value replaces that vote. Clearing removes it. The UI updates only after confirmation from the global MySQL service. Public readers see aggregates, not voter identities. These quality/preferences ratings are separate from Clean/Explicit content classifications.

Use **Preferences → Song Ratings** to select/check a private profile. A draft check does not change active access; save preferences to apply it. Hosts without a profile can read aggregates. Full singer accounts, cross-device ownership and remote singer voting remain planned. Local files use their content SHA256; different CDG backdrop conversions currently have separate exact-asset ratings. See [ratings help](song-ratings.md).

## Launcher Flags

Run the installed executable with `--settings` or `--keybindings`. It opens the requested section in the already-running app for that profile, or starts one stopped at that view. When both flags are supplied, Keyboard Shortcuts wins. No second show database writer is started.

These navigation flags are implemented independently of the API. The initial authenticated local control API and structured command-line tool also passed an actual Windows app/compiled CLI rehearsal for reads and settings navigation; full show mutations remain planned. Capability discovery reports only implemented controls.

## Initial Local API and CLI

Enable **Preferences → Local API and CLI → Enable Local API and CLI**, then save. The API binds only to this computer and publishes a private per-start credential. **Check Local API** reports readiness; **Show CLI Tool** locates the CLI wrapper. Source packaging wiring provides `tpv-karaoke.cmd` for Windows and `tpv-karaoke` for installed/extracted Linux packages. These wrappers reuse the app runtime, so a separate Node installation is unnecessary. Actual distributed wrapper/package verification is pending; earlier package versions may not include them. AppImage helper/extraction and macOS packaging require their release-specific instructions and verification.

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
