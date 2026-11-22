import { readFile, readdir, realpath, lstat } from 'node:fs/promises';
import { join, sep } from 'node:path';
import { createHash } from 'node:crypto';

const rollupPlatforms = [
  'darwin-arm64', 'darwin-x64', 'linux-arm64-gnu', 'linux-arm64-musl',
  'linux-x64-gnu', 'linux-x64-musl', 'win32-arm64-msvc', 'win32-x64-msvc',
];
// Pin each fallback to the package identity and upstream content reviewed for it.
const fallbacks = new Map([
  {
    name: 'saxes', version: '6.0.0', license: 'ISC',
    file: 'saxes-6.0.0-LICENSE',
    sha256: '0fac2374380621b22e6b50451057721a9c52935b02d16d106a9f04897f061d0e',
    source: 'https://github.com/lddubeau/saxes/blob/211fa0ebec9b628affc09219199639887174bfc3/LICENSE',
  },
  {
    name: '@ionic/react', version: '9.0.13', license: 'MIT',
    file: 'ionic-react-9.0.13-LICENSE',
    sha256: '4862ae1846439cae0cc097120a14e93a142d36016a9fc609b5d23959e3ff041f',
    source: 'https://github.com/ionic-team/ionic-framework/blob/8deb9240d48bc1206fa36f4682fcfcf4b4d5abc8/LICENSE',
  },
  {
    name: 'react-property', version: '2.0.2', license: 'MIT',
    file: 'react-property-2.0.2-LICENSE',
    sha256: '52412d7bc7ce4157ea628bbaacb8829e0a9cb3c58f57f99176126bc8cf2bfc85',
    source: 'https://github.com/facebook/react/blob/1314299c7f70914d61d8e1cef56767f112110674/LICENSE',
  },
  ...rollupPlatforms.map(platform => ({
    name: `@rollup/rollup-${platform}`, version: '4.44.0', license: 'MIT',
    file: 'rollup-4.44.0-LICENSE.md',
    sha256: 'b7da2ce13ab5566726b174cd99322fb8c2576f4d47b1393f8eea214928dd89eb',
    source: 'https://github.com/rollup/rollup/blob/fa4b2842c823f6a61f6b994a28b7fcb54419b6c6/LICENSE.md',
  })),
].map(fallback => [`node_modules/${fallback.name}`, fallback]));
const licenseName = /^(licen[cs]e|copying|copyright)([._-]|$)/i;
const within = (path, parent) => path.startsWith(parent + sep);

function excludesHost(only, host) {
  return Array.isArray(only) && only.length > 0 &&
    only.every(value => typeof value === 'string' && /^[a-z0-9_]+$/i.test(value) && value !== 'any') &&
    !only.includes(host);
}

function isOptionalForOtherHost(dependency) {
  if (dependency.optional !== true) return false;
  if (excludesHost(dependency.os, process.platform) || excludesHost(dependency.cpu, process.arch)) return true;
  if (process.platform !== 'linux' || !dependency.libc) return false;
  const { glibcVersionRuntime } = process.report.getReport().header;
  return excludesHost(dependency.libc, glibcVersionRuntime ? 'glibc' : 'musl');
}

async function fallbackNotice(repo, directory, dependency, dependencyRoot) {
  const fallback = fallbacks.get(directory);
  if (!fallback || dependency.version !== fallback.version || dependency.license !== fallback.license)
    throw new Error(`Missing production dependency license: ${directory}`);
  const installed = JSON.parse(await readFile(join(dependencyRoot, 'package.json'), 'utf8'));
  if (installed.name !== fallback.name || installed.version !== fallback.version || installed.license !== fallback.license)
    throw new Error(`The ${fallback.name} license fallback does not match the installed package.`);
  const path = join(repo, 'assets/licenses', fallback.file), info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || !within(await realpath(path), repo))
    throw new Error(`Unexpected ${fallback.name} fallback license location.`);
  // Git may check text out as CRLF on Windows. Hash the complete LF-normalized file.
  const text = (await readFile(path, 'utf8')).replace(/\r\n/g, '\n');
  if (createHash('sha256').update(text).digest('hex') !== fallback.sha256)
    throw new Error(`The verified ${fallback.name} fallback license was changed.`);
  return `Verified upstream license fallback: ${fallback.source}\n\n${text}`;
}

/** Collect every bundled production notice; an absent notice always fails closed. */
export async function productionDependencyNotices(repo, lock) {
  if (!lock || typeof lock !== 'object' || !lock.packages || typeof lock.packages !== 'object' || Array.isArray(lock.packages))
    throw new TypeError('A package lock with production package entries is required.');
  const root = await realpath(repo), modules = join(root, 'node_modules');
  const notices = ['Third-party notices for bundled production dependencies.\nElectron/Chromium notices are included separately with the runtime.'];
  for (const [directory, dependency] of Object.entries(lock.packages)) {
    if (!directory) continue;
    if (!dependency || typeof dependency !== 'object' || Array.isArray(dependency)) throw new TypeError('Invalid production dependency entry.');
    if (dependency.dev) continue;
    if (!directory.startsWith('node_modules/') || /[\\\x00-\x1f\x7f]/.test(directory) || directory.split('/').some(part => !part || part === '.' || part === '..'))
      throw new Error('Unexpected dependency license location.');
    const dependencyPath = join(root, directory);
    // npm locks every native variant and installs the ones supported by the build host.
    // An installed dependency still needs a notice regardless of its platform metadata.
    if (isOptionalForOtherHost(dependency)) {
      try { await lstat(dependencyPath); }
      catch (error) { if (error?.code === 'ENOENT') continue; throw error; }
    }
    const dependencyRoot = await realpath(dependencyPath);
    if (!within(dependencyRoot, modules)) throw new Error('Unexpected dependency license location.');
    const names = (await readdir(dependencyRoot)).filter(name => licenseName.test(name)).sort();
    const contents = [];
    if (names.length) {
      for (const name of names) {
        const path = await realpath(join(dependencyRoot, name));
        if (!within(path, dependencyRoot)) throw new Error('Unexpected dependency license file location.');
        contents.push(await readFile(path, 'utf8'));
      }
    } else contents.push(await fallbackNotice(root, directory, dependency, dependencyRoot));
    notices.push(`\n${'='.repeat(72)}\n${directory.replace(/^.*node_modules\//, '')} ${dependency.version} (${dependency.license ?? 'see notice'})`, ...contents);
  }
  return notices.join('\n\n') + '\n';
}
