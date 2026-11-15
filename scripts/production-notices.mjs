import { readFile, readdir, realpath, lstat } from 'node:fs/promises';
import { join, sep } from 'node:path';
import { createHash } from 'node:crypto';

const saxesFallback = Object.freeze({
  directory: 'node_modules/saxes', name: 'saxes', version: '6.0.0', license: 'ISC',
  file: 'assets/licenses/saxes-6.0.0-LICENSE',
  sha256: '0fac2374380621b22e6b50451057721a9c52935b02d16d106a9f04897f061d0e',
  source: 'https://github.com/lddubeau/saxes/blob/211fa0ebec9b628affc09219199639887174bfc3/LICENSE',
});
const licenseName = /^(licen[cs]e|copying|copyright)([._-]|$)/i;
const within = (path, parent) => path.startsWith(parent + sep);

async function fallbackNotice(repo, directory, dependency, dependencyRoot) {
  if (directory !== saxesFallback.directory || dependency.version !== saxesFallback.version || dependency.license !== saxesFallback.license)
    throw new Error(`Missing production dependency license: ${directory}`);
  const installed = JSON.parse(await readFile(join(dependencyRoot, 'package.json'), 'utf8'));
  if (installed.name !== saxesFallback.name || installed.version !== saxesFallback.version || installed.license !== saxesFallback.license)
    throw new Error('The saxes license fallback does not match the installed package.');
  const path = join(repo, saxesFallback.file), info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || !within(await realpath(path), repo))
    throw new Error('Unexpected saxes fallback license location.');
  // Git may check text out as CRLF on Windows. Do not trim, rewrite or omit either
  // saxes' notice or the inherited sax notice; hash the complete LF-normalized file.
  const text = (await readFile(path, 'utf8')).replace(/\r\n/g, '\n');
  if (createHash('sha256').update(text).digest('hex') !== saxesFallback.sha256)
    throw new Error('The verified saxes fallback license was changed.');
  return `Verified upstream license fallback: ${saxesFallback.source}\n\n${text}`;
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
    const dependencyRoot = await realpath(join(root, directory));
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
