// Read-only public catalog checks and a dedicated QA voter's synthetic recording.
// Usage: npx tsx scripts/shared-services-live-smoke.mjs /private/qa-rating.json
// Never pass a token value. This script must not use the owner's voting profile.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { copyFile, lstat, mkdtemp, realpath, rm, chmod } from 'node:fs/promises';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { execFileSync } from 'node:child_process';
import { SharedCatalogConnection, PUBLIC_CATALOG_ORIGIN } from '../src/main/shared-catalog-connection.ts';
import { SharedCatalogClient } from '../src/main/shared-catalog-client.ts';
import { SongRatingsConnection, readSongRatingsConfig } from '../src/main/song-ratings-connection.ts';
import { SongRatingsClient } from '../src/main/song-ratings-client.ts';

if (process.argv.length !== 3) throw new Error('Usage: npx tsx scripts/shared-services-live-smoke.mjs /private/qa-rating.json');
const supplied = await realpath(resolve(process.argv[2]));
if (basename(supplied) !== 'qa-rating.json') throw new Error('Use the separately provisioned qa-rating.json profile, never the owner profile.');
const qa = await readSongRatingsConfig(supplied);
assert.ok(qa, 'The dedicated QA voter configuration must exist.');
assert.equal(qa.baseUrl, PUBLIC_CATALOG_ORIGIN, 'This smoke targets the approved shared service origin only.');
const siblingOwner = await readSongRatingsConfig(join(dirname(supplied), 'host-rating.json'));
assert.ok(!siblingOwner || siblingOwner.token !== qa.token, 'The QA profile must be distinct from the owner profile.');
const parent = await realpath(dirname(supplied));
const temporary = await mkdtemp(join(parent, 'qa-ratings-rehearsal-'));
const identity = await lstat(temporary);
if (process.platform === 'win32') {
  const sid = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value'], {encoding:'utf8',windowsHide:true}).trim();
  if (!/^S-\d+(?:-\d+)+$/.test(sid)) throw new Error('Could not establish the current Windows owner for private QA staging.');
  execFileSync('icacls.exe', [temporary, '/inheritance:r', '/grant:r', `*${sid}:(OI)(CI)F`, '*S-1-5-18:(OI)(CI)F'], {windowsHide:true,stdio:'pipe'});
} else await chmod(temporary, 0o700);
const configCopy = join(temporary, 'qa-rating.json');
let ratings, voteAttempted = false, voteCleared = false;
const recordingKey = 'sha256:' + createHash('sha256').update('tpv-live-qa:' + randomUUID()).digest('hex');
try {
  await copyFile(supplied, configCopy);
  if (process.platform !== 'win32') await chmod(configCopy, 0o600);
  const staged = await readSongRatingsConfig(configCopy);
  assert.ok(staged && staged.baseUrl === qa.baseUrl && staged.token === qa.token, 'The QA credential changed during private staging; no vote will be sent.');
  const catalog = new SharedCatalogConnection(join(temporary, 'catalog-cache.json'));
  const status = await catalog.publicStatus();
  assert.equal(status.status, 'ready', 'The public catalog status endpoint must work without a private profile.');
  assert.equal(status.connectionMode, 'public');
  assert.ok(status.searchableCount > 0);
  const searched = await catalog.publicSearch('Nada Surf Amateur');
  assert.equal(searched.status, 'ready', 'A fresh installation must be able to search public catalog results.');
  assert.ok(searched.tracks.length > 0);
  const restartedOffline = new SharedCatalogConnection(join(temporary, 'catalog-cache.json'), undefined, undefined,
    cacheFile => new SharedCatalogClient({baseUrl:PUBLIC_CATALOG_ORIGIN,public:true,cacheFile,fetch:async()=>{throw new Error('Deliberate isolated-client outage.');}}));
  const cached = await restartedOffline.publicSearch('Nada Surf Amateur');
  assert.equal(cached.status, 'ready'); assert.equal(cached.source, 'offline-cache');
  assert.deepEqual(cached.tracks, searched.tracks);

  ratings = new SongRatingsConnection(configCopy);
  const profile = await ratings.lookup([]);
  assert.equal(profile.status, 'ready'); assert.equal(profile.canVote, true);
  const initial = await ratings.lookup([recordingKey]);
  assert.equal(initial.status, 'ready'); assert.deepEqual(initial.items, [{recordingKey,average:null,count:0,ownVote:null}]);
  voteAttempted = true;
  const first = await ratings.vote(recordingKey, 3);
  assert.equal(first.status, 'ready'); assert.deepEqual(first.item, {recordingKey,average:3,count:1,ownVote:3});
  const replaced = await ratings.vote(recordingKey, 9);
  assert.equal(replaced.status, 'ready'); assert.deepEqual(replaced.item, {recordingKey,average:9,count:1,ownVote:9});
  const own = await ratings.lookup([recordingKey]);
  assert.equal(own.status, 'ready'); assert.deepEqual(own.items, [{recordingKey,average:9,count:1,ownVote:9}]);
  const publicRatings = new SongRatingsClient({baseUrl:PUBLIC_CATALOG_ORIGIN});
  const aggregate = await publicRatings.lookup([recordingKey]);
  assert.equal(aggregate.status, 'ready'); assert.equal(aggregate.canVote, false);
  assert.deepEqual(aggregate.items, [{recordingKey,average:9,count:1,ownVote:null}]);
  const invalid = new SongRatingsClient({baseUrl:PUBLIC_CATALOG_ORIGIN,token:'invalid-qa-only-' + randomUUID()});
  const rejected = await invalid.lookup([]);
  assert.ok(rejected.status === 'unauthorized' || rejected.status === 'forbidden', 'A supplied invalid credential must not silently become public access.');
  const cleared = await ratings.vote(recordingKey, null);
  assert.equal(cleared.status, 'ready'); assert.deepEqual(cleared.item, {recordingKey,average:null,count:0,ownVote:null});
  const afterClear = await publicRatings.lookup([recordingKey]);
  assert.equal(afterClear.status, 'ready'); assert.deepEqual(afterClear.items, [{recordingKey,average:null,count:0,ownVote:null}]);
  voteCleared = true;
  console.log('Live shared services passed: token-free catalog status/search and restart/offline cache; dedicated QA vote 3→9 replaced one vote; authenticated own vote and public aggregate projections; invalid credential rejection; synthetic vote cleared and public zero-count confirmed.');
} finally {
  let cleanupFailure;
  if (voteAttempted && !voteCleared && ratings) {
    const result = await ratings.vote(recordingKey, null);
    if (result.status !== 'ready' || result.item.count !== 0 || result.item.ownVote !== null) cleanupFailure = new Error(`QA vote cleanup could not be confirmed for synthetic key ${recordingKey}.`);
  }
  const actual = await realpath(temporary), current = await lstat(temporary);
  if (dirname(actual) !== parent || !actual.startsWith(parent + sep) || !basename(actual).startsWith('qa-ratings-rehearsal-') || current.isSymbolicLink() || current.dev !== identity.dev || current.ino !== identity.ino)
    throw new Error('Unsafe private QA staging cleanup path; files retained for review.');
  await rm(actual, {recursive:true,force:true});
  if (cleanupFailure) throw cleanupFailure;
}
