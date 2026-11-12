import type { ShortcutAction } from './shortcuts';
import type { AccentColor, Theme } from './settings';

/** The menu and focused-window shortcuts dispatch the same named actions. */
export type AppAction = ShortcutAction | `appearance:${Theme}` | `accent:${AccentColor}`;
export type SettingsSection = 'general' | 'appearance' | 'keyboard-shortcuts' | 'ratings';
