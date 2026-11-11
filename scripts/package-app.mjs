// Build from source into an isolated stage. Never cleans the running app's dist.
import { mkdtemp, mkdir, writeFile, readFile, readdir, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { build as viteBuild } from 'vite';
import { build as bundle } from 'esbuild';
import electronBuilder from 'electron-builder';
import configuration from '../electron-builder.config.mjs';

const repo = await realpath(resolve(dirname(fileURLToPath(import.meta.url)), '..'));
const requireFromRepo = createRequire(join(repo, 'package.json'));
const git = (...args) => { try { return execFileSync('git', args, { cwd: repo, encoding: 'utf8', windowsHide: true }).trim(); } catch { return null; } };
const platform = process.argv[2];
if (process.argv.length !== 3 || !['win', 'linux', 'mac'].includes(platform)) {
  throw new Error('Usage: node scripts/package-app.mjs win|linux|mac');
}
if (platform === 'mac' && process.platform !== 'darwin') throw new Error('Build macOS packages on a Mac.');
const temporaryRoot = await realpath(tmpdir());
const stage = await mkdtemp(join(temporaryRoot, 'tpv-package-'));
try {
  const metadata = JSON.parse(await readFile(join(repo, 'package.json'), 'utf8'));
  const sourceCommit = git('rev-parse', 'HEAD');
  const sourceStatus = git('status', '--porcelain');
  if (!/^0\.\d+\.\d+$/.test(metadata.version)) throw new Error('Development packaging expects a 0.x.y version until official release approval.');
  const installedElectron = JSON.parse(await readFile(join(repo, 'node_modules/electron/package.json'), 'utf8')).version;
  await mkdir(join(stage, 'dist'), { recursive: true });
  await viteBuild({ root: repo, build: { outDir: join(stage, 'dist/ui'), emptyOutDir: true } });
  await Promise.all(['main', 'preload'].map(entry => bundle({
    entryPoints: [join(repo, `src/${entry}/index.ts`)], outfile: join(stage, `dist/${entry}/index.cjs`),
    bundle: true, platform: 'node', format: 'cjs', target: 'node24', external: ['electron'], sourcemap: false,
  })));
  // All runtime JS is bundled above. Explicit manifest prevents node_modules,
  // development tools, private source directories and external files being shipped.
  await writeFile(join(stage, 'package.json'), JSON.stringify({
    name: metadata.name, version: metadata.version, private: true,
    description: metadata.description, author: metadata.author,
    main: metadata.main, homepage: metadata.homepage,
  }, null, 2) + '\n');
  const lock = JSON.parse(await readFile(join(repo, 'package-lock.json'), 'utf8'));
  const notices = ['Third-party notices for bundled production dependencies.\nElectron/Chromium notices are included separately with the runtime.'];
  for (const [directory, dependency] of Object.entries(lock.packages)) {
    if (!directory || dependency.dev) continue;
    const dependencyRoot = await realpath(join(repo, directory));
    if (!dependencyRoot.startsWith(join(repo, 'node_modules') + sep)) throw new Error('Unexpected dependency license location.');
    const names = (await readdir(dependencyRoot)).filter(name => /^(licen[cs]e|copying|copyright)([._-]|$)/i.test(name)).sort();
    if (!names.length) throw new Error(`Missing production dependency license: ${directory}`);
    notices.push(`\n${'='.repeat(72)}\n${directory.replace(/^.*node_modules\//, '')} ${dependency.version} (${dependency.license ?? 'see notice'})`);
    for (const name of names) notices.push(await readFile(join(dependencyRoot, name), 'utf8'));
  }
  await writeFile(join(stage, 'THIRD-PARTY-LICENSES.txt'), notices.join('\n\n') + '\n');
  const { build, Platform, Arch } = electronBuilder;
  const target = platform === 'win' ? Platform.WINDOWS : platform === 'linux' ? Platform.LINUX : Platform.MAC;
  const architectures = platform === 'mac' ? [Arch.x64, Arch.arm64] : [Arch.x64];
  const config = { ...configuration,
    electronVersion: installedElectron,
    directories: { app: stage, output: join(repo, 'release') },
    // A multi-architecture build must download each matching Electron runtime.
    // Reusing the host runtime would silently mislabel (for example) an arm64 Mac.
    ...(target.nodeName === process.platform && architectures.length === 1 && Arch[architectures[0]] === process.arch
      ? { electronDist: dirname(requireFromRepo('electron')) } : {}),
  };
  const artifacts = await build({ projectDir: repo, targets: target.createTarget(undefined, ...architectures), config, publish: 'never' });
  const checksums = [];
  for (const artifact of [...new Set(artifacts)].sort()) {
    const actual = await realpath(artifact);
    if (dirname(actual) !== join(repo, 'release')) throw new Error('Unexpected package output location.');
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(actual)) hash.update(chunk);
    checksums.push({ file: basename(actual), sha256: hash.digest('hex') });
  }
  const receipt = { version: metadata.version, platform, architectures: architectures.map(value => Arch[value]),
    electron: installedElectron, builder: requireFromRepo('electron-builder/package.json').version,
    sourceCommit, sourceHasUncommittedChanges: sourceStatus === null ? null : sourceStatus.length > 0,
    sourceRevisionChangedDuringBuild: git('rev-parse', 'HEAD') !== sourceCommit || git('status', '--porcelain') !== sourceStatus,
    createdAt: new Date().toISOString(), signed: false, artifacts: checksums };
  const receiptBase = join(repo, 'release', `Proper-Karaoke-Booth-${metadata.version}-${platform}`);
  await writeFile(receiptBase + '-build.json', JSON.stringify(receipt, null, 2) + '\n');
  await writeFile(receiptBase + '-SHA256SUMS.txt', checksums.map(item => `${item.sha256}  ${item.file}`).join('\n') + '\n');
  console.log(`Packaged ${metadata.version} for ${platform}; output: ${join(repo, 'release')}`);
} finally {
  const actual = await realpath(stage);
  if (!actual.startsWith(temporaryRoot + sep) || dirname(actual) !== temporaryRoot || !actual.split(sep).at(-1)?.startsWith('tpv-package-')) throw new Error('Unsafe package staging cleanup path.');
  await rm(actual, { recursive: true, force: true });
}
