import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInitialState } from '../../src/domain';
import { parseSettings } from '../../src/domain/settings';
import { MAX_YOUTUBE_SEARCH_OUTPUT_BYTES } from '../../src/domain/youtube-search';
import { runYouTubeSearch, YouTubeSearchService, type YouTubeSearchScope } from '../../src/main/youtube-search';

const channelId = 'UC' + 'A'.repeat(22), videoId = 'abcdEFG123_';
const output = JSON.stringify({ entries: [{ id: videoId, title: 'Nada Surf - Amateur (Karaoke Version)',
  channel_id: channelId, channel: 'Karaoke Studio', uploader_id: '@KaraokeStudio', duration: 210 }] });
const scope = (): YouTubeSearchScope => ({ ...parseSettings({}), policy: createInitialState('show', 'epoch').policy });
const executable = async () => process.execPath;

test('search uses fixed metadata-only shell-free arguments and queue receipts retain authoritative identities', async () => {
  const current = scope(); let calls = 0;
  const service = new YouTubeSearchService(() => current, { resolveExecutable: executable, run: async (file, args) => {
    ++calls; assert.equal(file, process.execPath);
    for (const required of ['--ignore-config', '--no-plugin-dirs', '--no-cache-dir', '--skip-download', '--flat-playlist', '--dump-single-json', '--no-mark-watched']) assert.ok(args.includes(required));
    assert.equal(args.at(-2), '--'); assert.equal(args.at(-1), 'ytsearch20:Nada Surf karaoke');
    assert.ok(!args.some(arg => /cookies|username|password|exec|download-archive/.test(arg)));
    return output;
  } });
  const result = await service.search('Nada Surf'); assert.equal(result.status, 'ok'); assert.equal(calls, 1);
  assert.equal(result.songs[0].videoId, videoId); assert.ok(result.searchId);
  result.songs[0].title = 'Renderer-supplied replacement';
  const queued = service.lookup(result.searchId, videoId); assert.equal(queued?.title, 'Amateur');
  queued!.title = 'Another replacement'; assert.equal(service.lookup(result.searchId, videoId)?.title, 'Amateur');
  assert.equal(service.lookup('unrecognized search receipt', videoId), null);
  assert.equal(service.lookup(result.searchId, 'different11'), null);
  current.youtubeBlockedChannels.push(channelId); assert.equal(service.lookup(result.searchId, videoId), null);
});

test('invalid, disabled, restricted-show and unconfigured approved-only requests do not run a tool', async () => {
  const current = scope(); let calls = 0;
  const service = new YouTubeSearchService(() => current, { resolveExecutable: executable, run: async () => { ++calls; return output; } });
  assert.equal((await service.search('\n--exec secret')).status, 'invalid-input');
  current.youtubeSearchEnabled = false; assert.equal((await service.search('Artist')).status, 'disabled');
  current.youtubeSearchEnabled = true; current.policy.ageRestricted = true;
  assert.equal((await service.search('Artist')).status, 'unavailable');
  current.policy.ageRestricted = false; current.policy.includeVersionIds = ['approved-local-version'];
  assert.equal((await service.search('Artist')).status, 'unavailable');
  current.policy.includeVersionIds = null; current.youtubeSearchMode = 'approved-channels';
  assert.equal((await service.search('Artist')).status, 'configuration-error'); assert.equal(calls, 0);
});

test('cancellation and deadlines bound even an uncooperative injected tool and superseded searches cannot install results', async () => {
  const current = scope(); let calls = 0, firstSignal: AbortSignal | null = null;
  const service = new YouTubeSearchService(() => current, { timeoutMs: 1000, resolveExecutable: executable, run: async (_file, _args, options) => {
    if (++calls === 1) { firstSignal = options.signal; return new Promise<string>(() => {}); }
    return output;
  } });
  const first = service.search('First Artist'); await new Promise(resolve => setTimeout(resolve, 5));
  const second = await service.search('Second Artist'); assert.equal(second.status, 'ok');
  assert.equal((await first).status, 'cancelled'); assert.equal((firstSignal as AbortSignal | null)?.aborted, true);
  const timeout = new YouTubeSearchService(() => current, { timeoutMs: 10, resolveExecutable: executable, run: async () => new Promise<string>(() => {}) });
  assert.equal((await timeout.search('Artist')).status, 'timed-out');
  const abort = new AbortController(); const pending = service.search('Artist', { signal: abort.signal }); abort.abort();
  assert.equal((await pending).status, 'cancelled');
});

test('changed policy or channel configuration discards an in-flight result and old receipts', async () => {
  const current = scope(); let finish!: (value: string) => void;
  const service = new YouTubeSearchService(() => current, { resolveExecutable: executable, run: async () => new Promise<string>(resolve => { finish = resolve; }) });
  const pending = service.search('Artist'); await new Promise(resolve => setTimeout(resolve, 5));
  current.artistBlacklist.push('Nada Surf'); finish(output);
  assert.equal((await pending).status, 'cancelled'); assert.equal(service.lookup('anything', videoId), null);
});

test('missing tools, malformed or excessive output and private tool errors return sanitized statuses', async () => {
  const current = scope();
  const missing = new YouTubeSearchService(() => current, { resolveExecutable: async () => { throw new Error('C:/private/account/file secret'); } });
  const missingResult = await missing.search('Artist'); assert.equal(missingResult.status, 'dependency-missing'); assert.doesNotMatch(JSON.stringify(missingResult), /private|secret/);
  for (const text of ['not json', JSON.stringify({ entries: 'invalid' }), 'x'.repeat(MAX_YOUTUBE_SEARCH_OUTPUT_BYTES + 1)]) {
    const service = new YouTubeSearchService(() => current, { resolveExecutable: executable, run: async () => text });
    assert.equal((await service.search('Artist')).status, 'invalid-response');
  }
  const failed = new YouTubeSearchService(() => current, { resolveExecutable: executable, run: async () => { throw new Error('secret signed URL https://private.test'); } });
  const result = await failed.search('Artist'); assert.equal(result.status, 'unavailable'); assert.doesNotMatch(JSON.stringify(result), /secret|private|signed/);
});

test('a pre-aborted search never resolves or starts a tool', async () => {
  let calls = 0; const current = scope(), abort = new AbortController(); abort.abort();
  const service = new YouTubeSearchService(() => current, { resolveExecutable: async () => { ++calls; return process.execPath; }, run: async () => { ++calls; return output; } });
  assert.equal((await service.search('Artist', { signal: abort.signal })).status, 'cancelled'); assert.equal(calls, 0);
});

test('native shell-free runner bounds output, discards stderr and terminates an aborted process', async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'tpv-youtube-search-runner-')));
  try {
    const script = join(directory, 'child.cjs'), pidFile = join(directory, 'child.pid');
    await writeFile(script, 'process.stderr.write("private secret");process.stdout.write("metadata");');
    assert.equal(await runYouTubeSearch(process.execPath, [script], { signal: new AbortController().signal, timeoutMs: 5000 }), 'metadata');
    await writeFile(script, `require('node:fs').writeFileSync(${JSON.stringify(pidFile)},String(process.pid));setInterval(()=>{},1000);`);
    const abort = new AbortController(); const pending = runYouTubeSearch(process.execPath, [script], { signal: abort.signal, timeoutMs: 5000 });
    let pid = 0;
    for (let i = 0; i < 100 && !pid; ++i) { try { pid = Number(await readFile(pidFile, 'utf8')); } catch { await new Promise(resolve => setTimeout(resolve, 10)); } }
    assert.ok(pid > 0); abort.abort();
    await assert.rejects(pending, /YouTube metadata search failed/);
    assert.throws(() => process.kill(pid, 0), 'The cancelled child must no longer be running.');
    await writeFile(script, `process.stdout.write(Buffer.alloc(${MAX_YOUTUBE_SEARCH_OUTPUT_BYTES + 1}));setInterval(()=>{},1000);`);
    await assert.rejects(runYouTubeSearch(process.execPath, [script], { signal: new AbortController().signal, timeoutMs: 5000 }),
      error => error instanceof Error && 'status' in error && error.status === 'invalid-response');
  } finally { await rm(directory, { recursive: true, force: true }); }
});
