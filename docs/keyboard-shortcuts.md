# Keyboard shortcuts

The app creates `keybindings.json` in its user-data folder on first start. Its full path appears in Preferences. Edit it with a text editor and restart the app to apply changes. The complete set of currently supported actions and their defaults is:

```json
{
  "search": ["Control+KeyF", "Meta+KeyF"],
  "playPause": ["Space"]
}
```

Each action requires at least one binding; adding multiple strings provides alternatives. Use physical key codes `KeyA`–`KeyZ`, `Digit0`–`Digit9`, `F1`–`F12`, `Space`, `Enter`, `Escape`, or `ArrowUp`, `ArrowDown`, `ArrowLeft`, `ArrowRight`. Prefix optional `Control`, `Alt`, `Shift`, or `Meta` modifiers, separated by `+`, for example `Control+Shift+KeyP`. Bindings must be unique across actions. Unknown actions, invalid keys, and conflicts are rejected. If the file is invalid, the app reports the error and uses defaults until it is corrected and the app is restarted; it does not overwrite the file.

Search opens the library even from the singer display or Preferences. Play/pause applies to an active performance in either application window and does not capture keys while typing or operating a focused control in the host. Shortcuts are limited to these two actions for now; they are application-focused, not system-wide. Other actions are not yet configurable.
