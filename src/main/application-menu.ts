import type { MenuItemConstructorOptions } from 'electron';
import type { AppAction } from '../domain/app-action';
import type { Settings } from '../domain/settings';

export function applicationMenu(settings: Pick<Settings, 'appearance' | 'accentColor' | 'layout'>,
  dispatch: (action: AppAction) => void, platform = process.platform,
  context = { fileBlocked: false, viewBlocked: false }): MenuItemConstructorOptions[] {
  const preferences: MenuItemConstructorOptions = { label: 'Preferences…', click: () => dispatch('preferences') };
  const result: MenuItemConstructorOptions[] = [];
  if (platform === 'darwin') result.push({ label: 'The Proper Volume Karaoke', submenu: [
    { role: 'about' }, { type: 'separator' }, preferences, { type: 'separator' }, { role: 'quit' },
  ] });
  result.push({ label: 'File', submenu: [
    { label: 'Import', enabled: !context.fileBlocked, submenu: [
      { label: 'Import Video File…', click: () => dispatch('importVideo') },
      { label: 'Import Custom Directory…', click: () => dispatch('importDirectory') },
      { label: 'Import CD+G / ZIP…', click: () => dispatch('importCdg') },
    ] },
    { label: 'Back up show…', enabled: !context.fileBlocked, click: () => dispatch('backupShow') },
    { type: 'separator' }, preferences,
    { label: 'Keyboard Shortcuts…', click: () => dispatch('keybindings') },
    { type: 'separator' }, { role: 'quit' },
  ] });
  result.push({ label: 'Edit', submenu: [
    { role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' },
  ] });
  result.push({ label: 'View', submenu: [
    { label: 'Appearance', enabled: !context.viewBlocked, submenu: [
      { label: 'Appearance Settings…', click: () => dispatch('appearance') },
      { type: 'separator' },
      ...(['system', 'night', 'day'] as const).map(value => ({ label: value === 'system' ? 'Follow System' : value === 'night' ? 'Night' : 'Day',
        type: 'radio' as const, checked: settings.appearance === value, click: () => dispatch(`appearance:${value}`) })),
    ] },
    { label: 'Choose Accent Color', enabled: !context.viewBlocked, submenu: (['blue', 'pink', 'purple'] as const).map(value => ({
      label: value[0].toUpperCase() + value.slice(1), type: 'radio' as const, checked: settings.accentColor === value,
      click: () => dispatch(`accent:${value}`),
    })) },
    { label: 'Layout', enabled: !context.viewBlocked, submenu: [
      { label: 'Standard', type: 'radio', checked: settings.layout === 'standard', click: () => dispatch('layoutStandard') },
      { label: 'Wider Singer Rotation', type: 'radio', checked: settings.layout === 'rotation', click: () => dispatch('layoutRotation') },
      { label: 'Wide Song Library', type: 'radio', checked: settings.layout === 'library', click: () => dispatch('layoutLibrary') },
    ] },
    { type: 'separator' }, { label: 'Singer Display', enabled: !context.fileBlocked, click: () => dispatch('singerDisplay') },
    { label: 'Singer Display Fullscreen', enabled: !context.fileBlocked, click: () => dispatch('toggleFullscreen') },
  ] });
  result.push({ label: 'Help', submenu: [{ label: 'Keyboard Shortcuts', click: () => dispatch('keybindings') }] });
  return result;
}
