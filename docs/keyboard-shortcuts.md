# Keyboard Shortcuts

Open **Preferences → Keyboard Shortcuts** to review or edit keyboard commands. The editor groups actions by Application, Playback, Queue, Singer Display, Library, Appearance and Layouts, with an action label beside its assigned keys.

## Defaults

| Action | Default shortcuts | Scope |
| --- | --- | --- |
| Search Song Library | Ctrl+F; Cmd+F | Host or player window |
| Play/Pause | Spacebar | Host or player window, outside text entry |
| Open Preferences | Ctrl+,; Cmd+,; Alt+, | Host or player window |
| Open Keyboard Shortcuts | Ctrl+/; Cmd+/; F1 | Host or player window |
| Toggle Fullscreen | F; Shift+F | Active player window only |
| Toggle Host Full Screen | F11 | Host window only |
| Remove Selected Queue Request | Delete | Focused queue only; eligible selected request |

When a host queue row has focus, use **Up** and **Down** to select the previous or next request. **Home** and **End** select the first or last request. **Shift+F10** opens the selected request’s actions.

The **Window** menu has separate fullscreen controls for the host and singer display. An existing custom F11 assignment takes precedence over the new host fullscreen default.

Other listed actions start unassigned. They include restart current song, stop, skip, seek backward/forward, open the singer display, all three import actions, backup, appearance/accent preferences and cycling, and the three workspace layouts. Assign keys to any of these in the editor. An action can have up to 16 alternate shortcuts. Each shortcut is one physical key plus optional Ctrl, Alt, Shift and Cmd/Meta modifiers; multi-step sequences are not supported.

## Change and save bindings

Click an existing key to replace it, or **+ Add** beside an action to assign another. Press the combination while its recording input is focused. Modifier-only presses are ignored. **Escape** cancels recording and **Tab** moves to Cancel Recording; those two keys can still be assigned through JSON. Recording consumes the event so it cannot also trigger playback or open another application section. Conflicts name both affected actions and leave the previous bindings intact.

Use the **×** beside a binding to remove it. Removing all bindings disables keyboard activation for that action; the menu or button remains available. Press **Save Shortcuts** to persist the draft and apply it to running windows. Shortcut changes save separately from other preferences. Unsaved edits are labelled and discarded when the editor is closed. **Reset to Defaults** immediately saves and restores the defaults above.

## Edit the JSON file

**Edit custom shortcuts** opens `keybindings.json` in the default editor. This is the same file used by the settings interface, in the app's user-data directory. Saving in the interface writes every action, including empty arrays for unassigned commands. Close the app before directly changing the file, then restart to load the changes. A malformed file is retained for repair; startup reports the error and uses safe defaults rather than replacing the broken file.

Bindings use DOM physical-key codes, not display labels. For example:

```json
{
  "search": ["Control+KeyF", "Meta+KeyF"],
  "playPause": ["Space"],
  "preferences": ["Control+Comma", "Meta+Comma", "Alt+Comma"],
  "keybindings": ["Control+Slash", "Meta+Slash", "F1"],
  "toggleFullscreen": ["KeyF", "Shift+KeyF"],
  "previous": ["Control+KeyR", "Meta+KeyR"],
  "stop": []
}
```

This is a partial example: omitted actions receive their defaults. Modifier order is normalized, and duplicate keys are rejected. Existing two-action files from older versions are supported. If an old explicit Search or Play/Pause binding uses a newly introduced default such as F or F1, the old binding wins and that conflicting new default is omitted; the editor shows the resulting configuration. Existing conflicts between explicit actions remain errors.

## Developer contract

`src/domain/shortcuts.ts` owns the action registry, defaults, bounded validation, normalization, display labels and exact key matching. `SHORTCUT_ACTIONS` supplies `id`, `label`, `group` and `scope`; dispatch must honor the player-only fullscreen scope and preserve normal text editing. `bindingFromKeyInput` ignores unsupported/modifier-only codes. `parseShortcuts` clones arrays, validates missing/default and explicit/disabled actions, and rejects unknown actions or conflicting normalized combinations.

`writeShortcuts` validates before writing a private temporary sibling and atomically replacing the file. Invalid edits retain the last working file; failed publication removes only the staged sibling. The main process owns saving, opening the file and broadcasting effective bindings. The renderer editor receives named callbacks and does not access the filesystem or arbitrary IPC.

Inside text fields, normal selection, clipboard, undo/redo and caret movement take precedence over custom action bindings. The same custom chord still works from the workspace; the shortcut recorder can capture it explicitly.
