// Check committed platform assets and, optionally, real Windows resource editing.
// This never launches the karaoke app, writes its profile or rebuilds release/.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { copyFile, mkdtemp, readFile, realpath, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import config from '../electron-builder.config.mjs';

const repo = await realpath(resolve(dirname(fileURLToPath(import.meta.url)), '..'));
const brand = join(repo, 'assets/branding');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const manifest = JSON.parse(await readFile(join(brand, 'manifest.json'), 'utf8'));
assert.equal(manifest.id, 'mic-play');
assert.equal(manifest.defaultTheme, 'light');
for (const theme of ['dark', 'light']) {
  const master = await readFile(join(brand, `source/icon-${theme}.svg`), 'utf8');
  assert.ok(!/<(?:text|image|script)\b/i.test(master), 'Icon masters must be text-free self-contained vector geometry.');
  assert.equal(master, await readFile(join(brand, `icon-${theme}.svg`), 'utf8'));
}
for (const [alias, target] of [['app.ico','app-light.ico'],['app.icns','app-light.icns'],['app.png','png/light/icon-1024.png'],['web/favicon.svg','icon-light.svg']])
  assert.equal(hash(await readFile(join(brand, alias))), hash(await readFile(join(brand, target))));
for (const [path, expected] of Object.entries(manifest.files)) {
  const actual = await realpath(resolve(repo, path));
  const inside = relative(repo, actual);
  assert.ok(inside && !inside.startsWith('..' + sep) && inside !== '..');
  assert.equal(hash(await readFile(actual)), expected, `Asset changed without regeneration: ${path}`);
}
const png = bytes => {
  assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.equal(bytes.subarray(12, 16).toString(), 'IHDR');
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
};
for (const theme of ['dark', 'light']) {
  const ico = await readFile(join(brand, `app-${theme}.ico`));
  assert.equal(ico.readUInt16LE(0), 0);
  assert.equal(ico.readUInt16LE(2), 1);
  assert.equal(ico.readUInt16LE(4), 9);
  for (let i = 0; i < 9; ++i) {
    const at = 6 + i * 16;
    const width = ico[at] || 256, height = ico[at + 1] || 256;
    const length = ico.readUInt32LE(at + 8), start = ico.readUInt32LE(at + 12);
    assert.ok(start >= 6 + 9 * 16 && start + length <= ico.length);
    const bytes = ico.subarray(start, start + length);
    assert.deepEqual(png(bytes), [width, height]);
    assert.equal(hash(bytes), hash(await readFile(join(brand, `png/${theme}/icon-${width}.png`))));
  }
  const icns = await readFile(join(brand, `app-${theme}.icns`));
  assert.equal(icns.subarray(0, 4).toString(), 'icns');
  assert.equal(icns.readUInt32BE(4), icns.length);
  const expected = new Map([['icp4', 16], ['icp5', 32], ['icp6', 64], ['ic07', 128], ['ic08', 256], ['ic09', 512], ['ic10', 1024]]);
  let at = 8;
  while (at < icns.length) {
    const code = icns.subarray(at, at + 4).toString(), length = icns.readUInt32BE(at + 4);
    assert.ok(expected.has(code) && length > 8 && at + length <= icns.length);
    const size = expected.get(code), bytes = icns.subarray(at + 8, at + length);
    assert.deepEqual(png(bytes), [size, size]);
    assert.equal(hash(bytes), hash(await readFile(join(brand, `png/${theme}/icon-${size}.png`))));
    expected.delete(code); at += length;
  }
  assert.equal(at, icns.length); assert.equal(expected.size, 0);
}
for (const path of [config.win.icon, config.mac.icon, config.linux.icon,
  config.nsis.installerIcon, config.nsis.uninstallerIcon, config.nsis.installerHeader, config.nsis.installerSidebar, config.nsis.uninstallerSidebar, config.nsis.include])
  assert.ok(await stat(join(repo, path)));
assert.ok(config.extraResources.some(item => item.to === 'branding' && item.filter.includes('app.ico') && item.filter.includes('app.png')));
assert.deepEqual(png(await readFile(join(brand, 'app.png'))), [1024, 1024]);
assert.match(await readFile(join(repo, 'mobile/capacitor.config.ts'), 'utf8'), /com\.thepropervolume\.karaoke/);
for (const size of [192, 512]) assert.deepEqual(png(await readFile(join(repo, `mobile/web-public/icon-${size}.png`))), [size, size]);
assert.deepEqual(png(await readFile(join(repo, 'mobile/ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png'))), [1024, 1024]);
const iosAssets = join(repo, 'mobile/ios/App/App/Assets.xcassets');
assert.deepEqual(png(await readFile(join(iosAssets, 'TPVLaunchBackdrop.imageset/tpv-launch-backdrop.png'))), [780, 1690]);
const launchWordmark = await readFile(join(iosAssets, 'TPVLaunchWordmark.imageset/tpv-launch-wordmark.png'));
assert.deepEqual(png(launchWordmark), [1320, 441]);
assert.equal(launchWordmark[25], 6, 'The iOS launch wordmark must have an alpha channel.');
const iosLaunch = await readFile(join(repo, 'mobile/ios/App/App/Base.lproj/LaunchScreen.storyboard'), 'utf8');
assert.match(iosLaunch, /image="TPVLaunchBackdrop"/);
assert.match(iosLaunch, /image="TPVLaunchWordmark"/);
const androidResources = join(repo, 'mobile/android/app/src/main/res');
const androidLaunch = await readFile(join(androidResources, 'values/styles.xml'), 'utf8');
assert.match(androidLaunch, /name="windowSplashScreenAnimatedIcon">@drawable\/tpv_launch_wordmark/);
const androidWordmark = await readFile(join(androidResources, 'drawable/tpv_launch_wordmark.xml'), 'utf8');
assert.match(androidWordmark, /android:width="288dp"/);
assert.match(androidWordmark, /android:height="288dp"/);
for (const [density, size] of [['mdpi',48],['hdpi',72],['xhdpi',96],['xxhdpi',144],['xxxhdpi',192]])
  assert.deepEqual(png(await readFile(join(repo, `mobile/android/app/src/main/res/mipmap-${density}/ic_launcher.png`))), [size, size]);
for (const [name, width, height] of [['installer-header.bmp',150,57],['installer-sidebar.bmp',164,314]]) {
  const bmp = await readFile(join(brand, name));
  assert.equal(bmp.subarray(0,2).toString(), 'BM');
  assert.equal(bmp.readInt32LE(18), width); assert.equal(Math.abs(bmp.readInt32LE(22)), height);
  assert.equal(bmp.readUInt16LE(28), 24, 'NSIS artwork must be 24-bit RGB BMP.');
}
assert.match(await readFile(join(brand, 'installer.nsh'), 'utf8'),
  /!macro customWelcomePage\s+!define MUI_WELCOMEPAGE_TITLE "Welcome to KaraBooth Setup"\s+!insertmacro MUI_PAGE_WELCOME\s+!macroend/);
console.log(`Verified ${Object.keys(manifest.files).length} asset hashes, both ICO/ICNS sets, all package icon paths and mobile references.`);

if (process.argv.includes('--windows-resource-check')) {
  if (process.platform !== 'win32') throw new Error('Windows resource check requires Windows.');
  const require = createRequire(import.meta.url);
  const { editWindowsResources } = require('app-builder-lib/out/util/resEdit');
  const ResEdit = require('resedit');
  const electron = require('electron');
  const temporaryRoot = await realpath(tmpdir());
  const temporary = await mkdtemp(join(temporaryRoot, 'tpv-brand-resource-'));
  const target = join(temporary, 'brand-resource-check.exe');
  try {
    await copyFile(electron, target);
    await editWindowsResources({ file: target, iconPath: join(repo, config.win.icon),
      versionStrings: { FileDescription: 'TPV icon resource verification only', ProductName: 'TPV icon resource verification' },
      fileVersion: '0.0.0', productVersion: '0.0.0', requestedExecutionLevel: 'asInvoker' });
    const exe = ResEdit.NtExecutable.from(await readFile(target));
    const resource = ResEdit.NtExecutableResource.from(exe);
    const group = resource.entries.find(entry => entry.type === 14 && entry.id === 1);
    assert.ok(group, 'Default executable icon group was not written.');
    assert.equal(Buffer.from(group.bin).readUInt16LE(4), 9);
    const images = new Set(resource.entries.filter(entry => entry.type === 3).map(entry => hash(Buffer.from(entry.bin))));
    for (const size of [16, 20, 24, 32, 40, 48, 64, 128, 256])
      assert.ok(images.has(hash(await readFile(join(brand, `png/light/icon-${size}.png`)))), `Missing embedded ${size}px icon.`);
    console.log('Actual Electron executable copy: builder resource editing embedded all nine approved PNG icon sizes; read-back passed.');
  } finally {
    const actual = await realpath(temporary);
    assert.equal(dirname(actual), temporaryRoot);
    assert.ok(actual.split(sep).at(-1)?.startsWith('tpv-brand-resource-'));
    await rm(actual, { recursive: true, force: true });
  }
}

// Read actual app/setup/uninstaller resources without launching or changing them.
for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i] !== '--executable') continue;
  const target = process.argv[++i];
  assert.ok(target, '--executable requires a PE file path.');
  const require = createRequire(import.meta.url), ResEdit = require('resedit');
  const resource = ResEdit.NtExecutableResource.from(ResEdit.NtExecutable.from(await readFile(target)));
  const groups = resource.entries.filter(entry => entry.type === 14);
  assert.ok(groups.some(entry => Buffer.from(entry.bin).readUInt16LE(4) === 9), 'Expected approved nine-frame icon group.');
  const images = new Set(resource.entries.filter(entry => entry.type === 3).map(entry => hash(Buffer.from(entry.bin))));
  for (const size of [16,20,24,32,40,48,64,128,256])
    assert.ok(images.has(hash(await readFile(join(brand, `png/light/icon-${size}.png`)))), `Actual executable is missing approved ${size}px artwork.`);
  console.log(`Approved text-free PE icon verified: ${target}`);
}
