import assert from 'node:assert/strict';
import { test } from 'node:test';
import { copyFile, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

type Dependency = { version: string; license?: string; dev?: boolean; optional?: boolean; os?: string[]; cpu?: string[] };
type Lock = { packages: Record<string, Dependency> };
type Notices = (repo: string, lock: Lock) => Promise<string>;
const helper: Promise<{ productionDependencyNotices: Notices }> = import(pathToFileURL(resolve('scripts/production-notices.mjs')).href);
const notices: Notices = async (...args) => (await helper).productionDependencyNotices(...args);
const fallback = resolve('assets/licenses/saxes-6.0.0-LICENSE');
const metadata = { name: 'saxes', version: '6.0.0', license: 'ISC' };
const lock = (dependency: Dependency = metadata): Lock => ({ packages: { '': { version: '0.6.0' }, 'node_modules/saxes': dependency } });
async function fixture(t: { after(callback: () => Promise<void>): void }) {
  const root = await realpath(tmpdir()), directory = await mkdtemp(join(root, 'tpv-production-notices-')), repo = join(directory, 'repo');
  await mkdir(join(repo, 'node_modules/saxes'), { recursive: true }); await mkdir(join(repo, 'assets/licenses'), { recursive: true });
  await writeFile(join(repo, 'node_modules/saxes/package.json'), JSON.stringify(metadata));
  await copyFile(fallback, join(repo, 'assets/licenses/saxes-6.0.0-LICENSE'));
  t.after(async () => {
    const actual = await realpath(directory); assert.equal(dirname(actual), root); assert.ok(basename(actual).startsWith('tpv-production-notices-'));
    await rm(actual, { recursive: true, force: true });
  });
  return { repo, directory, vendor: join(repo, 'assets/licenses/saxes-6.0.0-LICENSE'), installed: join(repo, 'node_modules/saxes/package.json') };
}

test('missing saxes6 notice uses the entire hash-verified upstream license and records provenance', async t => {
  const f = await fixture(t), text = await notices(f.repo, lock()), original = (await readFile(fallback, 'utf8')).replace(/\r\n/g, '\n');
  assert.ok(text.includes(original)); assert.match(text, /saxes 6\.0\.0 \(ISC\)/); assert.match(text, /211fa0ebec9b628affc09219199639887174bfc3\/LICENSE/);
  assert.match(text, /Copyright \(c\) Contributors/); assert.match(text, /Isaac Z\. Schlueter/); assert.match(text, /Electron\/Chromium/);
});
test('vendored fallback accepts Git CRLF checkouts without relaxing the complete-content hash', async t => {
  const f = await fixture(t); const original = (await readFile(f.vendor, 'utf8')).replace(/\r\n/g, '\n');
  await writeFile(f.vendor, original.replace(/\n/g, '\r\n'));
  assert.ok((await notices(f.repo, lock())).includes(original));
  await writeFile(f.vendor, original + '\n'); await assert.rejects(notices(f.repo, lock()), /license was changed/);
});
test('real dependency notices are preferred and every matching notice is included in stable order', async t => {
  const f = await fixture(t); await writeFile(join(f.repo, 'node_modules/saxes/LICENSE'), 'Actual package notice');
  await writeFile(join(f.repo, 'node_modules/saxes/COPYING.txt'), 'Additional package notice'); await writeFile(f.vendor, 'Tampered fallback that must not be used');
  const text = await notices(f.repo, lock()); assert.ok(text.includes('Actual package notice')); assert.ok(text.includes('Additional package notice'));
  assert.ok(text.indexOf('Additional package notice') < text.indexOf('Actual package notice')); assert.doesNotMatch(text, /Verified upstream license fallback|Tampered fallback/);
});
test('the fallback refuses changed package versions, license identifiers, installed identity and modified text', async t => {
  const f = await fixture(t);
  for (const dependency of [{ version: '6.0.1', license: 'ISC' }, { version: '6.0.0', license: 'MIT' }, { version: '6.0.0' }]) await assert.rejects(notices(f.repo, lock(dependency)), /Missing production dependency license/);
  for (const installed of [{ ...metadata, name: 'another-package' }, { ...metadata, version: '6.1.0' }, { ...metadata, license: 'MIT' }]) {
    await writeFile(f.installed, JSON.stringify(installed)); await assert.rejects(notices(f.repo, lock()), /does not match the installed package/);
  }
  await writeFile(f.installed, JSON.stringify(metadata)); await writeFile(f.vendor, 'The ISC License\nIncomplete notice');
  await assert.rejects(notices(f.repo, lock()), /license was changed/);
});
test('unknown production packages without notices fail; development dependencies are skipped', async t => {
  const f = await fixture(t); await mkdir(join(f.repo, 'node_modules/other'));
  await assert.rejects(notices(f.repo, { packages: { 'node_modules/other': { version: '6.0.0', license: 'ISC' } } }), /Missing production dependency license: node_modules\/other/);
  assert.doesNotMatch(await notices(f.repo, { packages: { 'node_modules/absent-dev': { version: '1', dev: true } } }), /absent-dev/);
});
test('the Ionic, React property and native Rollup notices use reviewed upstream texts', async t => {
  const { repo } = await fixture(t);
  const examples = [
    { name: '@ionic/react', version: '9.0.13', file: 'ionic-react-9.0.13-LICENSE', signature: /Copyright \(c\) 2015-present Drifty Co\./ },
    { name: 'react-property', version: '2.0.2', file: 'react-property-2.0.2-LICENSE', signature: /Copyright \(c\) Facebook, Inc\. and its affiliates\./ },
    { name: '@rollup/rollup-win32-x64-msvc', version: '4.44.0', file: 'rollup-4.44.0-LICENSE.md', signature: /github\.com\/rollup\/rollup\/graphs\/contributors/ },
  ];
  for (const { name, version, file, signature } of examples) {
    const directory = `node_modules/${name}`;
    const dependency = { name, version, license: 'MIT' };
    await mkdir(join(repo, directory), { recursive: true });
    await writeFile(join(repo, directory, 'package.json'), JSON.stringify(dependency));
    await copyFile(resolve('assets/licenses', file), join(repo, 'assets/licenses', file));
    const text = await notices(repo, { packages: { [directory]: dependency } });
    assert.ok(text.includes(`${name} ${version} (MIT)`));
    assert.match(text, signature);
    await assert.rejects(notices(repo, { packages: { [directory]: { ...dependency, version: '0.0.0' } } }), /Missing production dependency license/);
  }
});
test('only absent optional dependencies excluded by the build platform may be skipped', async t => {
  const { repo } = await fixture(t);
  const directory = 'node_modules/native-variant';
  const variant = { version: '1.0.0', license: 'MIT', optional: true };
  const incompatible = { ...variant, os: [process.platform === 'darwin' ? 'win32' : 'darwin'] };
  const result = (dependency: Dependency) => notices(repo, { packages: { [directory]: dependency } });
  assert.doesNotMatch(await result(incompatible), /native-variant/);
  await assert.rejects(result({ ...variant, os: [process.platform] }), /ENOENT/);
  await assert.rejects(result({ ...variant, cpu: ['any', 'another-cpu'] }), /ENOENT/);
  await assert.rejects(result({ ...incompatible, optional: false }), /ENOENT/);
  await mkdir(join(repo, directory));
  await assert.rejects(result(incompatible), /Missing production dependency license/);
});
test('dependency paths and license links cannot escape the checked repository package roots', async t => {
  const f = await fixture(t); const outside = join(f.directory, 'outside'); await mkdir(outside); await writeFile(join(outside, 'LICENSE'), 'Outside notice');
  for (const name of ['../outside', 'node_modules/../../outside', 'node_modules/saxes/..', 'node_modules\\saxes']) await assert.rejects(notices(f.repo, { packages: { [name]: metadata } }), /Unexpected dependency license location/);
  await symlink(outside, join(f.repo, 'node_modules/escaped'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(notices(f.repo, { packages: { 'node_modules/escaped': metadata } }), /Unexpected dependency license location/);
  // Directory junctions work without Windows developer-mode file-symlink privileges.
  await symlink(outside, join(f.repo, 'node_modules/saxes/LICENSE'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(notices(f.repo, lock()), /Unexpected dependency license file location/);
});
