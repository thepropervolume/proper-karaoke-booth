import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { MenuItemConstructorOptions } from 'electron';
import { applicationMenu, INITIAL_WORKSPACE_MENU_CONTEXT, type ApplicationMenuAction } from '../../src/main/application-menu';
import { DEFAULT_SETTINGS } from '../../src/domain/settings';

const children = (item: MenuItemConstructorOptions) => item.submenu as MenuItemConstructorOptions[];
const named = (menu: MenuItemConstructorOptions[], label: string) => {
  const item = menu.find(item => item.label === label);
  assert.ok(item, `Missing ${label} menu item`);
  return item;
};

test('native menus route desktop actions and mark saved View selections', () => {
  const actions: ApplicationMenuAction[] = [];
  const menu = applicationMenu({ ...DEFAULT_SETTINGS, appearance: 'day', accentColor: 'purple', fontFamily: 'serif', layout: 'library' },
    action => actions.push(action), 'linux', { ...INITIAL_WORKSPACE_MENU_CONTEXT, canPlay: true, canStop: true, performanceActive: true, canSeek: true }, true);
  assert.deepEqual(menu.map(item => item.label), ['File', 'Edit', 'View', 'Playback', 'Window', 'Help']);
  for (const [top, labels] of [
    ['File', ['Import Video…', 'Import Folder…', 'Import CD+G / LRC / ZIP…', 'Back up show…', 'Restore Show Backup…']],
    ['Edit', ['Find Song', 'Preferences…']],
    ['Playback', ['Play / Pause', 'Stop', 'Restart Current Song', 'Skip Song…', 'Rewind 10 Seconds', 'Forward 10 Seconds']],
    ['Window', ['Show Host Window', 'Toggle Host Full Screen', 'Open Singer Display', 'Toggle Singer Display Full Screen']],
    ['Help', ['Documentation', 'Keyboard Shortcuts']],
  ] as const) {
    for (const label of labels) {
      const item = named(children(named(menu, top)), label);
      assert.ok(item.enabled !== false);
      assert.ok(item.click);
      item.click(null as never, null as never, null as never);
    }
  }
  assert.deepEqual(actions, ['importVideo', 'importDirectory', 'importCdg', 'backupShow', 'restoreShow', 'search', 'preferences',
    'playPause', 'stop', 'previous', 'skip', 'seekBackward', 'seekForward', 'showHostWindow', 'toggleHostFullscreen',
    'singerDisplay', 'toggleFullscreen', 'documentation', 'keybindings']);

  const view = children(named(menu, 'View'));
  for (const [submenu, selection, action] of [
    ['Appearance', 'Day', 'appearance:day'], ['Choose Accent Color', 'Purple', 'accent:purple'], ['Font', 'Serif', 'font:serif'],
    ['Layout', 'Wide Song Library', 'layoutLibrary'],
  ] as const) {
    const items = children(named(view, submenu));
    const checked = items.filter(item => item.checked);
    assert.deepEqual(checked.map(item => item.label), [selection]);
    checked[0].click?.(null as never, null as never, null as never);
    assert.equal(actions.at(-1), action);
  }
});

test('native menus respect the picker, modal, transport and singer window availability', () => {
  const context = { ...INITIAL_WORKSPACE_MENU_CONTEXT, modal: true, canPlay: true, canStop: true, canSeek: true };
  const menu = applicationMenu(DEFAULT_SETTINGS, () => {}, 'win32', context);
  const item = (top: string, label: string) => named(children(named(menu, top)), label);
  assert.equal(item('File', 'Import Video…').enabled, false);
  assert.equal(item('File', 'Back up show…').enabled, false);
  assert.equal(item('View', 'Font').enabled, true);
  assert.equal(item('Playback', 'Play / Pause').enabled, false);
  assert.equal(item('Playback', 'Stop').enabled, true);
  assert.equal(item('Playback', 'Rewind 10 Seconds').enabled, false);
  assert.equal(item('Window', 'Toggle Singer Display Full Screen').enabled, false);
  assert.notEqual(item('Window', 'Toggle Host Full Screen').enabled, false);

  const indexing = applicationMenu(DEFAULT_SETTINGS, () => {}, 'linux', { ...INITIAL_WORKSPACE_MENU_CONTEXT, videoImportBlocked: true });
  const file = children(named(indexing, 'File'));
  assert.equal(named(file, 'Import Video…').enabled, false);
  assert.equal(named(file, 'Import Folder…').enabled, false);
  assert.equal(named(file, 'Import CD+G / LRC / ZIP…').enabled, true);
  assert.equal(named(children(named(indexing, 'Playback')), 'Restart Current Song').enabled, false);
});

test('macOS keeps app-menu Preferences and puts native Quit there once', () => {
  const menu = applicationMenu(DEFAULT_SETTINGS, () => {}, 'darwin');
  assert.equal(named(children(menu[0]), 'Preferences…').label, 'Preferences…');
  assert.equal(named(children(named(menu, 'Edit')), 'Preferences…').label, 'Preferences…');
  assert.equal(menu.flatMap(children).filter(item => item.role === 'quit').length, 1);
});
