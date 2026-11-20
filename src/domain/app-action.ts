import type { ShortcutAction } from './shortcuts';
import type { AccentColor, Theme } from './settings';
import type { AppearanceFont } from './appearance-font';

/** The menu and focused-window shortcuts dispatch the same named actions. */
export type AppAction = ShortcutAction | `appearance:${Theme}` | `accent:${AccentColor}` | `font:${AppearanceFont}`;
export type SettingsSection = 'general' | 'appearance' | 'keyboard-shortcuts' | 'ratings' | 'blacklist' | 'youtube';
