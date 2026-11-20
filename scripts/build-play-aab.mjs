/** Build a separate, owner-signed Play upload bundle. Never publishes to any store. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { constants } from 'node:fs';
import { copyFile, lstat, mkdir, mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sensitive = ['TPV_PLAY_KEYSTORE', 'TPV_PLAY_KEY_ALIAS', 'TPV_PLAY_STORE_PASSWORD', 'TPV_PLAY_KEY_PASSWORD'];
const args = process.argv.slice(2);
if (!args.length) {
  console.log('Dry run: no build or signing performed. See docs/store-android.md; pass --execute to build and sign.');
} else {
  if (args.length !== 1 || args[0] !== '--execute') throw new Error('Usage: node scripts/build-play-aab.mjs [--execute]');
  for (const key of sensitive) if (!process.env[key]) throw new Error(`Set ${key} in the environment before running.`);
  if (!/^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/.test(process.env.TPV_PLAY_KEY_ALIAS)) throw new Error('Use a valid upload-key alias.');
  const keystore = process.env.TPV_PLAY_KEYSTORE;
  if (!isAbsolute(keystore)) throw new Error('TPV_PLAY_KEYSTORE must be an absolute path outside the repository.');
  const actualKeystore = await realpath(keystore), info = await lstat(actualKeystore);
  const relativeKey = relative(await realpath(repo), actualKeystore);
  if (!info.isFile() || relativeKey === '' || (!relativeKey.startsWith('..' + sep) && relativeKey !== '..' && !isAbsolute(relativeKey)))
    throw new Error('Choose an existing keystore outside the repository.');
  const buildEnv = { ...process.env };
  for (const key of sensitive) delete buildEnv[key];
  const signEnv = { ...buildEnv };
  for (const key of sensitive) signEnv[key] = process.env[key];
  signEnv.TPV_PLAY_KEYSTORE = actualKeystore;
  // Remove inherited Gradle/Java argument overrides, which might print secrets or change the build.
  delete buildEnv.JAVA_TOOL_OPTIONS; delete buildEnv.JDK_JAVA_OPTIONS; delete buildEnv._JAVA_OPTIONS;
  delete signEnv.JAVA_TOOL_OPTIONS; delete signEnv.JDK_JAVA_OPTIONS; delete signEnv._JAVA_OPTIONS;
  const run = (file, argv, cwd, env = buildEnv, quiet = false) => {
    const result = spawnSync(file, argv, { cwd, env, shell: false, windowsHide: true, stdio: quiet ? ['ignore', 'ignore', 'ignore'] : 'inherit' });
    if (result.error || result.status !== 0) throw new Error(`${basename(file)} failed; no Play bundle was published.`);
  };
  const capture = (file, argv, cwd) => {
    const result = spawnSync(file, argv, { cwd, env: buildEnv, shell: false, windowsHide: true, encoding: 'utf8' });
    if (result.error || result.status !== 0) throw new Error('Git source validation failed.');
    return result.stdout.trim();
  };
  const commit = capture('git', ['rev-parse', 'HEAD'], repo);
  assert.match(commit, /^[a-f0-9]{40}$/);
  if (capture('git', ['status', '--porcelain', '--untracked-files=normal'], repo)) throw new Error('Build the Play bundle from a clean, committed checkout.');
  const root = JSON.parse(await readFile(join(repo, 'package.json'), 'utf8'));
  const mobile = JSON.parse(await readFile(join(repo, 'mobile/package.json'), 'utf8'));
  const rootLock = JSON.parse(await readFile(join(repo, 'package-lock.json'), 'utf8'));
  const mobileLock = JSON.parse(await readFile(join(repo, 'mobile/package-lock.json'), 'utf8'));
  const version = root.version;
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+$/.test(version) || mobile.version !== version || rootLock.version !== version || rootLock.packages?.['']?.version !== version || mobileLock.version !== version || mobileLock.packages?.['']?.version !== version) throw new Error('Root, mobile and lockfile versions must match.');
  const gradleConfig = await readFile(join(repo, 'mobile/android/app/build.gradle'), 'utf8');
  const versions = [...gradleConfig.matchAll(/\bversionName\s+"([^"]+)"/g)].map(match => match[1]);
  if (versions.length !== 1 || versions[0] !== version) throw new Error('Android versionName must match the root version.');
  const codes = [...gradleConfig.matchAll(/\bversionCode\s+(\d+)/g)].map(match => Number(match[1]));
  if (codes.length !== 1 || !Number.isSafeInteger(codes[0]) || codes[0] < 1) throw new Error('Android versionCode must be a positive integer.');
  const sdkConfig = await readFile(join(repo, 'mobile/android/variables.gradle'), 'utf8');
  const targets = [...sdkConfig.matchAll(/\btargetSdkVersion\s*=\s*(\d+)/g)].map(match => Number(match[1]));
  if (targets.length !== 1 || targets[0] < 36) throw new Error('Google Play requires target API 36 or higher.');
  const javaBin = process.env.JAVA_HOME ? join(process.env.JAVA_HOME, 'bin') : '';
  const java = javaBin ? join(javaBin, process.platform === 'win32' ? 'java.exe' : 'java') : 'java';
  const signer = javaBin ? join(javaBin, process.platform === 'win32' ? 'jarsigner.exe' : 'jarsigner') : 'jarsigner';
  const temporary = await mkdtemp(join(tmpdir(), 'tpv-play-sign-'));
  try {
    const signed = join(temporary, 'signed.aab');
    run(process.execPath, [join(repo, 'scripts/build-mobile.mjs')], repo);
    run(process.execPath, [join(repo, 'mobile/node_modules/@capacitor/cli/bin/capacitor'), 'sync', 'android'], join(repo, 'mobile'));
    const android = join(repo, 'mobile/android');
    if (process.platform === 'win32') run(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'gradlew.bat bundleRelease --no-daemon --rerun-tasks'], android);
    else run('bash', ['gradlew', 'bundleRelease', '--no-daemon', '--rerun-tasks'], android);
    if (capture('git', ['rev-parse', 'HEAD'], repo) !== commit || capture('git', ['status', '--porcelain', '--untracked-files=normal', '--', '.', ':(exclude)mobile/android/app/capacitor.build.gradle', ':(exclude)mobile/android/capacitor.settings.gradle'], repo) || capture('git', ['diff', '--cached', '--name-only'], repo))
      throw new Error('Source changed during the build; refusing to sign.');
    const unsigned = join(android, 'app/build/outputs/bundle/release/app-release.aab');
    run(signer, ['-keystore', actualKeystore, '-storepass:env', 'TPV_PLAY_STORE_PASSWORD', '-keypass:env', 'TPV_PLAY_KEY_PASSWORD', '-signedjar', signed, unsigned, process.env.TPV_PLAY_KEY_ALIAS], repo, signEnv, true);
    // Verify every bundle payload entry against the configured upload certificate.
    run(java, [join(repo, 'scripts/VerifyPlayAab.java'), signed], repo, signEnv, true);
    const outputDir = join(repo, 'release/play'); await mkdir(outputDir, { recursive: true });
    const output = join(outputDir, `Proper-Karaoke-Booth-${version}-play-upload.aab`);
    await copyFile(signed, output, constants.COPYFILE_EXCL);
    console.log(`Verified signed Play upload bundle: ${output}\nSource commit: ${commit}`);
  } finally {
    const target = await realpath(temporary), base = await realpath(tmpdir());
    if (dirname(target) !== base || !basename(target).startsWith('tpv-play-sign-')) throw new Error('Unsafe temporary directory; cleanup was not attempted.');
    await rm(target, { recursive: true, force: true });
  }
}
