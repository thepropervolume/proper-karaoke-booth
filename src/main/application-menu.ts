import type { MenuItemConstructorOptions } from 'electron';
import type { AppAction } from '../domain/app-action';
import { APPEARANCE_FONTS } from '../domain/appearance-font';
import { ACCENT_COLORS, type Settings } from '../domain/settings';
import { KARAOKE_PAIR_IMPORT_LABEL } from '../domain/shortcuts';

export type ApplicationMenuAction = AppAction | 'documentation' | 'showHostWindow';

export type WorkspaceMenuContext = {
  busy: boolean;
  modal: boolean;
  videoImportBlocked: boolean;
  canPlay: boolean;
  canStop: boolean;
  performanceActive: boolean;
  canSeek: boolean;
};

export const INITIAL_WORKSPACE_MENU_CONTEXT: WorkspaceMenuContext = {
  busy: false, modal: false, videoImportBlocked: false, canPlay: false, canStop: false, performanceActive: false, canSeek: false,
};

export function applicationMenu(settings: Pick<Settings, 'appearance' | 'accentColor' | 'fontFamily' | 'layout'>,
  dispatch: (action: ApplicationMenuAction) => void, platform = process.platform,
  context = INITIAL_WORKSPACE_MENU_CONTEXT, singerDisplayVisible = false): MenuItemConstructorOptions[] {
  const fileEnabled = !context.busy && !context.modal;
  const preferences: MenuItemConstructorOptions = { label: 'Preferences…', click: () => dispatch('preferences') };
  const result: MenuItemConstructorOptions[] = [];
  if (platform === 'darwin') result.push({ label: 'The Proper Volume Karaoke', submenu: [
    { role: 'about' }, { type: 'separator' }, preferences, { type: 'separator' }, { role: 'services' },
    { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' },
  ] });
  result.push({ label: 'File', submenu: [
    { label: 'Import Video…', enabled: fileEnabled && !context.videoImportBlocked, click: () => dispatch('importVideo') },
    { label: 'Import Folder…', enabled: fileEnabled && !context.videoImportBlocked, click: () => dispatch('importDirectory') },
    { label: `${KARAOKE_PAIR_IMPORT_LABEL}…`, enabled: fileEnabled, click: () => dispatch('importCdg') },
    { type: 'separator' },
    { label: 'Back up show…', enabled: fileEnabled, click: () => dispatch('backupShow') },
    { label: 'Restore Show Backup…', enabled: fileEnabled, click: () => dispatch('restoreShow') },
    ...(platform !== 'darwin' ? [{ type: 'separator' as const }, { role: 'quit' as const }] : []),
  ] });
  result.push({ label: 'Edit', submenu: [
    { role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' },
    { type: 'separator' }, { label: 'Find Song', enabled: fileEnabled, click: () => dispatch('search') }, preferences,
  ] });
  result.push({ label: 'View', submenu: [
    { label: 'Appearance', enabled: !context.busy, submenu: [
      { label: 'Appearance Settings…', click: () => dispatch('appearance') },
      { type: 'separator' },
      ...(['system', 'night', 'day'] as const).map(value => ({ label: value === 'system' ? 'Follow System' : value === 'night' ? 'Night' : 'Day',
        type: 'radio' as const, checked: settings.appearance === value, click: () => dispatch(`appearance:${value}`) })),
    ] },
    { label: 'Choose Accent Color', enabled: !context.busy, submenu: ACCENT_COLORS.map(value => ({
      label: value[0].toUpperCase() + value.slice(1), type: 'radio' as const, checked: settings.accentColor === value,
      click: () => dispatch(`accent:${value}`),
    })) },
    { label: 'Font', enabled: !context.busy, submenu: APPEARANCE_FONTS.map(({ id, label }) => ({
      label, type: 'radio', checked: settings.fontFamily === id, click: () => dispatch(`font:${id}`),
    })) },
    { label: 'Layout', enabled: !context.busy, submenu: [
      { label: 'Standard', type: 'radio', checked: settings.layout === 'standard', click: () => dispatch('layoutStandard') },
      { label: 'Wider Singer Rotation', type: 'radio', checked: settings.layout === 'rotation', click: () => dispatch('layoutRotation') },
      { label: 'Wide Song Library', type: 'radio', checked: settings.layout === 'library', click: () => dispatch('layoutLibrary') },
    ] },
  ] });
  result.push({ label: 'Playback', submenu: [
    { label: 'Play / Pause', enabled: fileEnabled && context.canPlay, click: () => dispatch('playPause') },
    { label: 'Stop', enabled: context.canStop, click: () => dispatch('stop') },
    { label: 'Restart Current Song', enabled: fileEnabled && context.performanceActive, click: () => dispatch('previous') },
    { label: 'Skip Song…', enabled: fileEnabled && context.performanceActive, click: () => dispatch('skip') },
    { type: 'separator' },
    { label: 'Rewind 10 Seconds', enabled: fileEnabled && context.canSeek, click: () => dispatch('seekBackward') },
    { label: 'Forward 10 Seconds', enabled: fileEnabled && context.canSeek, click: () => dispatch('seekForward') },
  ] });
  result.push({ label: 'Window', submenu: [
    { role: 'minimize' }, { role: 'close' }, { type: 'separator' },
    { label: 'Show Host Window', click: () => dispatch('showHostWindow') },
    { label: 'Toggle Host Full Screen', click: () => dispatch('toggleHostFullscreen') },
    { type: 'separator' },
    { label: 'Open Singer Display', enabled: fileEnabled, click: () => dispatch('singerDisplay') },
    { label: 'Toggle Singer Display Full Screen', enabled: fileEnabled && singerDisplayVisible, click: () => dispatch('toggleFullscreen') },
  ] });
  result.push({ label: 'Help', submenu: [
    { label: 'Documentation', click: () => dispatch('documentation') },
    { label: 'Keyboard Shortcuts', click: () => dispatch('keybindings') },
    { type: 'separator' },
    { label: 'Check for Updates', enabled: !context.modal, click: () => dispatch('checkDesktopUpdate') },
  ] });
  return result;
}
