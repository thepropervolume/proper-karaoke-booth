import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { MenuItemConstructorOptions } from 'electron';
import { applicationMenu } from '../../src/main/application-menu';
import { DEFAULT_SETTINGS } from '../../src/domain/settings';
import type { AppAction } from '../../src/domain/app-action';

const children = (item: MenuItemConstructorOptions) => item.submenu as MenuItemConstructorOptions[];
test('File imports, backup, restore and settings share named actions; View represents effective settings', () => {
  const actions: AppAction[] = [];
  const menu = applicationMenu({ ...DEFAULT_SETTINGS, appearance: 'day', accentColor: 'purple', layout: 'library' }, action => actions.push(action), 'linux');
  const file = children(menu.find(item => item.label === 'File')!);
  const imports = children(file.find(item => item.label === 'Import')!);
  for (const item of [...imports, file.find(item => item.label === 'Back up show…')!, file.find(item => item.label === 'Restore Show Backup…')!, file.find(item => item.label === 'Keyboard Shortcuts…')!]) item.click?.(null as never, null as never, null as never);
  assert.deepEqual(actions, ['importVideo', 'importDirectory', 'importCdg', 'backupShow', 'restoreShow', 'keybindings']);
  const view = children(menu.find(item => item.label === 'View')!);
  assert.equal(children(view.find(item => item.label === 'Appearance')!).find(item => item.checked)?.label, 'Day');
  assert.equal(children(view.find(item => item.label === 'Choose Accent Color')!).find(item => item.checked)?.label, 'Purple');
  assert.equal(children(view.find(item => item.label === 'Layout')!).find(item => item.checked)?.label, 'Wide Song Library');
  assert.equal(menu.some(item => item.role === 'toggleDevTools'), false);
});
