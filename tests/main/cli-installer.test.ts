import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chmod, lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installControlCli, installPosixCli, installWindowsCliPath } from '../../src/main/cli-installer';

async function fixture(run: (home: string) => Promise<void>) {
  const home = await mkdtemp(join(tmpdir(), 'tpv-cli-install-'));
  try { await run(home); } finally { await rm(home, { recursive: true, force: true }); }
}

test('Bash installer preserves user content, installs an escaped launcher, and is idempotent', () => fixture(async home => {
  const rc = join(home, '.bashrc'), previous = '# Existing user settings\nexport TEST_VALUE="hello"\n';
  await writeFile(rc, previous, { mode: 0o600 });
  const target = "/opt/Ben's karaoke/tpv-karaoke";
  const installed = await installPosixCli(home, '/bin/bash', target, '/usr/bin');
  const launcher = join(home, '.local', 'bin', 'karabooth-cli');
  assert.equal(installed.command, 'karabooth-cli');
  assert.match(installed.message, /new terminal/i);
  assert.ok((await readFile(rc, 'utf8')).startsWith(previous));
  assert.match(await readFile(launcher, 'utf8'), /exec '\/opt\/Ben'\\''s karaoke\/tpv-karaoke' "\$@"/);
  const before = await readFile(rc);
  assert.match(await readFile(join(home, '.profile'), 'utf8'), /The Proper Volume Karaoke CLI/);
  await installPosixCli(home, '/bin/bash', target, '/usr/bin');
  assert.deepEqual(await readFile(rc), before, 'reinstall must not append another block');
  if (process.platform !== 'win32') {
    assert.equal((await lstat(rc)).mode & 0o777, 0o600);
    await chmod(launcher, 0o600);
    await installPosixCli(home, '/bin/bash', target, '/usr/bin');
    assert.ok(((await lstat(launcher)).mode & 0o100) !== 0, 'a managed launcher must be executable');
  }
}));

test('Bash login installs into its first existing login profile; Zsh updates login and interactive profiles', () => fixture(async home => {
  const bashProfile = join(home, '.bash_profile'), unusedProfile = join(home, '.profile');
  await writeFile(bashProfile, '# login\n'); await writeFile(unusedProfile, '# not selected\n');
  await installPosixCli(home, '/bin/bash', '/opt/tpv/launcher', '');
  assert.match(await readFile(bashProfile, 'utf8'), /The Proper Volume Karaoke CLI/);
  assert.equal(await readFile(unusedProfile, 'utf8'), '# not selected\n');
  await installPosixCli(home, '/bin/zsh', '/opt/tpv/launcher', '');
  assert.match(await readFile(join(home, '.zprofile'), 'utf8'), /The Proper Volume Karaoke CLI/);
  assert.match(await readFile(join(home, '.zshrc'), 'utf8'), /The Proper Volume Karaoke CLI/);
}));

test('refuses an existing unrelated launcher and leaves its contents and profile unchanged', () => fixture(async home => {
  const bin = join(home, '.local', 'bin'); await mkdir(bin, { recursive: true });
  const launcher = join(bin, 'karabooth-cli'), rc = join(home, '.zshrc');
  await writeFile(launcher, 'user-owned command\n'); await writeFile(rc, 'user profile\n');
  await assert.rejects(installPosixCli(home, '/bin/zsh', '/opt/tpv/launcher', ''), /different command/);
  assert.equal(await readFile(launcher, 'utf8'), 'user-owned command\n');
  assert.equal(await readFile(rc, 'utf8'), 'user profile\n');
}));

test('updates a previously managed command and preserves an unrelated legacy alias', () => fixture(async home => {
  const bin = join(home, '.local', 'bin'); await mkdir(bin, { recursive: true });
  const legacy = join(bin, 'tpv-karaoke'), previous = join(bin, 'tpv-karaoke-booth');
  for (const command of [legacy, previous])
    await writeFile(command, '#!/bin/sh\n# Managed by The Proper Volume Karaoke Booth CLI installer\nexec /old/booth "$@"\n');
  await installPosixCli(home, '/bin/zsh', '/opt/tpv/launcher', '');
  const canonical = await readFile(join(bin, 'karabooth-cli'), 'utf8');
  assert.equal(await readFile(legacy, 'utf8'), canonical);
  assert.equal(await readFile(previous, 'utf8'), canonical);
  await writeFile(legacy, 'user command\n');
  await installPosixCli(home, '/bin/zsh', '/opt/tpv/launcher', '');
  assert.equal(await readFile(legacy, 'utf8'), 'user command\n');
}));

test('rejects malformed profile blocks and symlinked user locations before changing files', () => fixture(async home => {
  const rc = join(home, '.bashrc'); await writeFile(rc, '# >>> The Proper Volume Karaoke CLI >>>\n');
  await assert.rejects(installPosixCli(home, '/bin/bash', '/opt/tpv/launcher', ''), /malformed/);
  assert.equal(await readFile(rc, 'utf8'), '# >>> The Proper Volume Karaoke CLI >>>\n');
  if (process.platform !== 'win32') {
    const second = await mkdtemp(join(tmpdir(), 'tpv-cli-link-'));
    try { await symlink(second, join(home, '.zshrc')); await assert.rejects(installPosixCli(home, '/bin/zsh', '/opt/tpv/launcher', ''), /unsafe/); }
    finally { await rm(second, { recursive: true, force: true }); }
  }
}));

test('unsupported shells get manual PATH instructions without profile edits', () => fixture(async home => {
  const result = await installPosixCli(home, '/usr/bin/fish', '/opt/tpv/launcher', '');
  assert.match(result.message, /Add .* to your shell PATH/);
  assert.equal(result.files?.length, 1);
}));

test('Windows PATH repair invokes the same native entry point as setup', async () => {
  const appDirectory = join(tmpdir(), 'TPV & My Booth');
  let calls = 0;
  const execute = async (file: string, args: string[]) => {
    calls++;
    assert.equal(file, join(appDirectory, 'karabooth-cli.exe'));
    assert.deepEqual(args, ['--register-windows-path']);
    return { stdout: 'added\r\n' };
  };
  const result = await installWindowsCliPath(appDirectory, { SystemRoot: tmpdir() }, execute);
  assert.equal(calls, 1); assert.match(result.message, /user PATH/); assert.equal(result.command, 'karabooth-cli');
  await assert.rejects(installWindowsCliPath(`${appDirectory};injection`, { SystemRoot: tmpdir() }, execute), /safely/);
  assert.equal(calls, 1);
});

test('unpackaged and temporary AppImage installs are rejected before touching the user profile', () => fixture(async home => {
  const base = { platform: 'linux' as const, executable: join(home, 'app'), resources: join(home, 'resources'), home, shell: '/bin/bash' };
  await assert.rejects(installControlCli({ ...base, packaged: false }), /packaged version/);
  await assert.rejects(installControlCli({ ...base, packaged: true, appImage: '/tmp/test.AppImage' }), /AppImage/);
  await assert.rejects(lstat(join(home, '.local')), (error: NodeJS.ErrnoException) => error.code === 'ENOENT');
}));
