import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { chmod, lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { sha256, stagePlatform, verifyPlatform } from './release-artifacts.mjs';

const run = (file, args, options = {}) => execFileSync(file, args, { stdio: 'inherit', windowsHide: true, timeout: 180_000, ...options });

async function packageRoots(directory, depth = 0) {
  assert.ok(depth <= 10, 'Unexpected package directory depth.');
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isFile() && entry.name === 'app.asar') result.push(dirname(dirname(path)));
    else if (entry.isDirectory()) result.push(...await packageRoots(path, depth + 1));
  }
  return result;
}

async function zipPayload(zip, entries, require) {
  const yauzl = require('yauzl');
  await new Promise((resolve, reject) => yauzl.open(zip, { lazyEntries: true }, (error, archive) => {
    if (error) return reject(error);
    const remaining = new Map(entries);
    archive.on('error', reject);
    archive.on('end', () => { try { assert.equal(remaining.size, 0, 'ZIP is missing packaged payloads.'); resolve(); } catch (reason) { reject(reason); } });
    archive.on('entry', entry => {
      const expected = remaining.get(entry.fileName);
      if (!expected) return archive.readEntry();
      archive.openReadStream(entry, async (streamError, stream) => {
        if (streamError) { archive.close(); return reject(streamError); }
        try {
          const { createHash } = await import('node:crypto'), hash = createHash('sha256');
          for await (const chunk of stream) hash.update(chunk);
          assert.equal(hash.digest('hex'), expected, `ZIP payload differs: ${entry.fileName}`);
          remaining.delete(entry.fileName); archive.readEntry();
        } catch (reason) { archive.close(); reject(reason); }
      });
    });
    archive.readEntry();
  }));
}

export async function verifyPackagedPlatform(repo, platform, version, commit) {
  assert.ok(['win', 'linux', 'mac'].includes(platform));
  assert.equal(process.platform, { win: 'win32', linux: 'linux', mac: 'darwin' }[platform], 'Use a native platform runner.');
  const release = join(repo, 'release'), prefix = `Proper-Karaoke-Booth-${version}-${platform}`;
  const require = createRequire(join(repo, 'package.json'));
  if (platform === 'mac') run(process.execPath, ['scripts/verify-mac-package.mjs'], { cwd: repo });
  else {
    const { build } = require('esbuild'), asar = require('@electron/asar');
    const unpacked = join(release, `${platform}-unpacked`), archive = join(unpacked, 'resources/app.asar');
    const extract = name => asar.extractFile(archive, name.replaceAll('/', process.platform === 'win32' ? '\\' : '/'));
    assert.equal(JSON.parse(extract('package.json').toString()).version, version);
    for (const entry of ['main', 'preload', 'control']) {
      const source = entry === 'control' ? 'src/control/entry.ts' : `src/${entry}/index.ts`;
      const result = await build({ entryPoints: [join(repo, source)], bundle: true, platform: 'node', format: 'cjs', target: 'node24', external: ['electron'], write: false });
      assert.deepEqual(extract(entry === 'control' ? 'dist/control/cli.cjs' : `dist/${entry}/index.cjs`), Buffer.from(result.outputFiles[0].contents));
    }
    assert.ok(extract('THIRD-PARTY-LICENSES.txt').length > 0, 'Missing runtime notices.');
    const names = ['resources/app.asar', 'resources/control/cli.cjs', 'resources/backdrops/tpv-karaoke-v3.mp4',
      ...(await readdir(join(unpacked, 'resources/branding'))).map(name => `resources/branding/${name}`),
      platform === 'win' ? 'proper-karaoke-booth.exe' : 'proper-karaoke-booth', platform === 'win' ? 'tpv-karaoke.cmd' : 'tpv-karaoke'];
    const hashes = await Promise.all(names.map(async name => [name, await sha256(join(unpacked, name))]));
    let executable = join(unpacked, platform === 'win' ? 'proper-karaoke-booth.exe' : 'proper-karaoke-booth');
    if (platform === 'win') await zipPayload(join(release, `Proper-Karaoke-Booth-${version}-win-x64.zip`), hashes, require);
    else {
      const check = join(release, 'ci-package-check'); await mkdir(check, { recursive: true });
      const deb = join(release, `Proper-Karaoke-Booth-${version}-linux-amd64.deb`);
      // Inspect the final control field because the smoke runner already has ALSA installed.
      const depends = execFileSync('dpkg-deb', ['--field', deb, 'Depends'], { encoding: 'utf8', timeout: 30_000 });
      assert.ok(depends.split(',').some(dependency => /^libasound2t64\s*\|\s*libasound2\s*\(>=\s*1\.0\.16\)$/.test(dependency.trim())),
        'The Debian package must require native ALSA and exclude unversioned substitutes.');
      run('dpkg-deb', ['--extract', deb, join(check, 'deb')]);
      run(join(release, `Proper-Karaoke-Booth-${version}-linux-x86_64.AppImage`), ['--appimage-extract'], { cwd: check, stdio: 'ignore' });
      for (const root of [join(check, 'deb'), join(check, 'squashfs-root')]) {
        const found = await packageRoots(root); assert.equal(found.length, 1, 'Expected one packaged app per Linux format.');
        for (const [name, hash] of hashes) assert.equal(await sha256(join(found[0], name)), hash, `Linux payload differs: ${name}`);
      }
      // CI's headless Linux environment cannot exercise a real desktop sandbox.
      // Only this disposable test launcher gets these flags; packages keep theirs.
      executable = join(check, 'electron-test-launcher');
      const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
      await writeFile(executable, `#!/bin/sh\nexec ${quote(join(check, 'squashfs-root/AppRun'))} --no-sandbox --disable-gpu "$@"\n`);
      await chmod(executable, 0o700);
    }
    const launcher = platform === 'linux' ? 'xvfb-run' : process.execPath;
    for (const script of ['scripts/packaged-app-smoke.mjs', 'scripts/packaged-branding-smoke.mjs']) {
      const args = platform === 'linux' ? ['-a', process.execPath, script, executable] : [script, executable];
      run(launcher, args, { cwd: repo });
    }
    assert.ok((await lstat(executable)).isFile());
  }
  const receipt = { version, platform, sourceCommit: commit, passed: true,
    buildReceiptSha256: await sha256(join(release, `${prefix}-build.json`)),
    checks: platform === 'mac' ? ['native-arm64-launch-restart', 'bundled-cli', 'both-architectures-signatures-and-payloads'] : ['source-bundles', 'payload-formats-match', 'packaged-launch-restart', 'packaged-branding'],
    physicalHardwareVerified: false, installed: false, ...(platform === 'linux' ? { headlessTestOnlySandboxFlags: true } : {}) };
  await writeFile(join(release, `${prefix}-ci-verification.json`), JSON.stringify(receipt, null, 2) + '\n');
  await verifyPlatform(release, version, platform, commit);
  await stagePlatform(repo, platform, version);
}
