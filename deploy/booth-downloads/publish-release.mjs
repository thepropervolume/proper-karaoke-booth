import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { collectRelease, platformNames, PLANNING_NAMES, releaseVersion } from './scripts/release-artifacts.mjs';

// This helper runs only the installed verifier and page renderer. Build uploads are data.
const [operation, version, ...args] = process.argv.slice(2);
releaseVersion(version);
if (operation === 'names' && args.length === 1) {
  const [scope] = args;
  console.log(JSON.stringify(scope === 'planning' ? PLANNING_NAMES : platformNames(version, scope)));
} else if (operation === 'verify' && args.length === 3) {
  const [directory, commit, sourceSha256] = args;
  assert.match(sourceSha256, /^[0-9a-f]{64}$/);
  await collectRelease(directory, version, commit, sourceSha256);
} else if (operation === 'identity' && args.length === 1) {
  const manifest = JSON.parse(await readFile(join(args[0], 'release-manifest.json'), 'utf8'));
  assert.equal(manifest.version, version);
  assert.match(manifest.sourceCommit, /^[0-9a-f]{40}$/);
  console.log(manifest.sourceCommit);
} else {
  throw new Error('Invalid release helper operation.');
}
