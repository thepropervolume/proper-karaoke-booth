/** Anonymous metadata search. Only a later explicit queue action can download a video. */
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { isAbsolute, join } from 'node:path';
import type { Policy } from '../domain';
import type { Settings } from '../domain/settings';
import { emptyYouTubeSearchCounts, filterYouTubeSearchEntries, MAX_YOUTUBE_SEARCH_OUTPUT_BYTES,
  MAX_YOUTUBE_SEARCH_RESULTS, validYouTubeSearchQuery, YOUTUBE_KARAOKE_QUALITY_NOTE, youtubeKaraokeQuery,
  type YouTubeKaraokeSong, type YouTubeSearchResult, type YouTubeSearchStatus } from '../domain/youtube-search';
import { managedYtDlpOptions, resolveYtDlpExecutable, ytDlpEnvironment, type YtDlpLaunch } from './youtube-tools';

export type YouTubeSearchScope = Pick<Settings, 'youtubeSearchEnabled' | 'youtubeSearchMode' | 'youtubeApprovedChannels' |
  'youtubeBlockedChannels' | 'songBlacklist' | 'artistBlacklist' | 'ytDlpExecutable' | 'ytDlpChannel'> & { policy: Policy };
export type YouTubeSearchRunner = (executable: string, args: string[], options: { signal: AbortSignal; timeoutMs: number; managedRuntime?: boolean }) => Promise<string>;
type FailureStatus = Exclude<YouTubeSearchStatus, 'ok'>;
class SearchFailure extends Error { constructor(readonly status: FailureStatus) { super('YouTube metadata search failed.'); } }
const messages: Record<FailureStatus, string> = {
  disabled: 'YouTube search is disabled in Preferences.',
  'invalid-input': 'Enter 2–200 characters to search YouTube karaoke.',
  'configuration-error': 'Check YouTube search mode and approved/blocked channel settings.',
  'dependency-missing': 'YouTube search needs yt-dlp. Check the selected build or prepare it in Preferences → Video Downloads & Cache.',
  unavailable: 'YouTube search is unavailable. Try again later; other sources remain available.',
  'invalid-response': 'YouTube returned incomplete or invalid metadata. Update yt-dlp and try again.',
  'timed-out': 'YouTube search timed out. Try a more specific query or check the connection.',
  cancelled: 'The search or host configuration changed. Search again.',
};
const failure = (status: FailureStatus, message = messages[status]): YouTubeSearchResult => ({ provider: 'youtube',
  status, searchId: null, songs: [], counts: emptyYouTubeSearchCounts(), message, qualityNote: YOUTUBE_KARAOKE_QUALITY_NOTE });

/** Kill the search process group/tree on cancellation, deadline or excessive
 * output. Tool stderr is discarded; credentials and config files are never read. */
export const runYouTubeSearch: YouTubeSearchRunner = (executable, args, options) => new Promise((resolve, reject) => {
  if (!isAbsolute(executable) || /[\x00-\x1f\x7f]/.test(executable) || !Number.isInteger(options.timeoutMs) ||
      options.timeoutMs < 1 || options.timeoutMs > 45_000 || args.length > 64 || args.some(arg => typeof arg !== 'string' || arg.length > 4096 || arg.includes('\0'))) {
    reject(new SearchFailure('invalid-input')); return;
  }
  if (options.signal.aborted) { reject(new SearchFailure('cancelled')); return; }
  const windows = process.platform === 'win32';
  const child = spawn(executable, args, { windowsHide: true, detached: !windows, shell: false, stdio: ['ignore', 'pipe', 'ignore'],
    env: ytDlpEnvironment(!!options.managedRuntime) });
  const chunks: Buffer[] = []; let bytes = 0, finished = false, stopping = false;
  let reason: FailureStatus | null = null, grace: ReturnType<typeof setTimeout> | undefined;
  const finish = (error?: FailureStatus) => {
    if (finished) return; finished = true; clearTimeout(deadline); if (grace) clearTimeout(grace);
    options.signal.removeEventListener('abort', abort);
    if (error) reject(new SearchFailure(error)); else resolve(Buffer.concat(chunks).toString('utf8'));
  };
  const stop = (status: FailureStatus) => {
    reason ??= status;
    if (stopping || finished) return; stopping = true;
    if (child.pid) {
      if (windows) {
        const systemRoot = process.env.SystemRoot && isAbsolute(process.env.SystemRoot) ? process.env.SystemRoot : 'C:\\Windows';
        const killer = spawn(join(systemRoot, 'System32', 'taskkill.exe'), ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, shell: false, stdio: 'ignore' });
        const limit = setTimeout(() => { killer.kill(); child.kill(); }, 1500); limit.unref();
        killer.once('error', () => { clearTimeout(limit); child.kill(); });
        killer.once('close', () => { clearTimeout(limit); child.kill(); });
      } else { try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); } }
    }
    grace = setTimeout(() => { child.kill('SIGKILL'); finish(reason ?? 'unavailable'); }, 2000);
    grace.unref();
  };
  const abort = () => stop('cancelled');
  const deadline = setTimeout(() => stop('timed-out'), options.timeoutMs);
  options.signal.addEventListener('abort', abort, { once: true });
  if (options.signal.aborted) abort();
  child.stdout.on('data', (chunk: Buffer) => {
    if (reason || finished) return;
    bytes += chunk.length;
    if (bytes > MAX_YOUTUBE_SEARCH_OUTPUT_BYTES) { stop('invalid-response'); return; }
    chunks.push(Buffer.from(chunk));
  });
  child.once('error', () => finish(reason ?? 'unavailable'));
  child.once('close', code => finish(reason ?? (code === 0 ? undefined : 'unavailable')));
});

const scopeKey = (scope: YouTubeSearchScope) => JSON.stringify([scope.youtubeSearchEnabled, scope.youtubeSearchMode,
  scope.youtubeApprovedChannels, scope.youtubeBlockedChannels, scope.songBlacklist, scope.artistBlacklist, scope.ytDlpExecutable, scope.ytDlpChannel, scope.policy]);
const policyBlocksSearch = (scope: YouTubeSearchScope) => scope.policy.ageRestricted || scope.policy.includeVersionIds !== null;
function abortable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => { signal.removeEventListener('abort', abort); reject(new SearchFailure(signal.reason === 'timed-out' ? 'timed-out' : 'cancelled')); };
    if (signal.aborted) { void operation.catch(() => {}); abort(); return; }
    signal.addEventListener('abort', abort, { once: true });
    operation.then(value => { signal.removeEventListener('abort', abort); resolve(value); }, error => { signal.removeEventListener('abort', abort); reject(error); });
  });
}

/** The renderer can queue only a result from the latest search with unchanged
 * host preferences/policy. It cannot supply a replacement URL or metadata. */
export class YouTubeSearchService {
  private sequence = 0;
  private controller: AbortController | null = null;
  private receipt: { id: string; scope: string; songs: Map<string, YouTubeKaraokeSong> } | null = null;
  private readonly timeoutMs: number;
  constructor(private readonly current: () => YouTubeSearchScope, private readonly options: {
    run?: YouTubeSearchRunner; resolveExecutable?: (selected: string, channel: Settings['ytDlpChannel']) => Promise<string | YtDlpLaunch>; timeoutMs?: number;
  } = {}) {
    this.timeoutMs = options.timeoutMs ?? 25_000;
    if (!Number.isInteger(this.timeoutMs) || this.timeoutMs < 1 || this.timeoutMs > 45_000) throw new Error('Invalid YouTube search timeout.');
  }
  cancel(): void { ++this.sequence; this.receipt = null; this.controller?.abort(); this.controller = null; }
  lookup(searchId: unknown, videoId: unknown): YouTubeKaraokeSong | null {
    const scope = this.current(), receipt = this.receipt;
    if (!scope.youtubeSearchEnabled || policyBlocksSearch(scope) || !receipt || typeof searchId !== 'string' ||
        typeof videoId !== 'string' || receipt.id !== searchId || receipt.scope !== scopeKey(scope)) return null;
    const song = receipt.songs.get(videoId); return song ? { ...song } : null;
  }
  async search(query: unknown, options: { signal?: AbortSignal } = {}): Promise<YouTubeSearchResult> {
    this.cancel(); const sequence = this.sequence, scope = this.current(), key = scopeKey(scope);
    if (!scope.youtubeSearchEnabled) return failure('disabled');
    if (!validYouTubeSearchQuery(query)) return failure('invalid-input');
    if (policyBlocksSearch(scope)) return failure('unavailable', 'YouTube results are hidden by the show policy because these videos have not been approved for this show.');
    if (scope.youtubeSearchMode === 'approved-channels' && !scope.youtubeApprovedChannels.length)
      return failure('configuration-error', 'Add approved UC channel IDs or @handles, or import a subscriptions export before searching approved channels only.');
    if (options.signal?.aborted) return failure('cancelled');
    const controller = new AbortController(); this.controller = controller;
    const abort = () => controller.abort(); options.signal?.addEventListener('abort', abort, { once: true });
    if (options.signal?.aborted) controller.abort();
    const timer = setTimeout(() => controller.abort('timed-out'), this.timeoutMs);
    try {
      let launch: string | YtDlpLaunch;
      try {
        launch = await abortable(this.options.resolveExecutable?.(scope.ytDlpExecutable, scope.ytDlpChannel)
          ?? resolveYtDlpExecutable(scope.ytDlpExecutable), controller.signal);
      }
      catch (error) { if (controller.signal.aborted) throw error; throw new SearchFailure('dependency-missing'); }
      const { executable, nodeExecutable } = typeof launch === 'string' ? { executable: launch, nodeExecutable: undefined } : launch;
      if (!isAbsolute(executable) || executable.length > 4096 || /[\x00-\x1f\x7f]/.test(executable)) throw new SearchFailure('dependency-missing');
      const args = ['--ignore-config', '--no-plugin-dirs', '--no-cache-dir', '--no-progress', '--no-warnings', '--skip-download',
        '--flat-playlist', '--dump-single-json', '--no-mark-watched',
        ...(nodeExecutable ? managedYtDlpOptions(nodeExecutable) : ['--no-remote-components', '--no-js-runtimes']),
        '--playlist-end', String(MAX_YOUTUBE_SEARCH_RESULTS), '--socket-timeout', '10', '--retries', '0', '--extractor-retries', '0',
        '--', `ytsearch${MAX_YOUTUBE_SEARCH_RESULTS}:${youtubeKaraokeQuery(query)}`];
      const output = await abortable((this.options.run ?? runYouTubeSearch)(executable, args, {
        signal: controller.signal, timeoutMs: this.timeoutMs, managedRuntime: !!nodeExecutable,
      }), controller.signal);
      if (controller.signal.aborted) throw new SearchFailure(controller.signal.reason === 'timed-out' ? 'timed-out' : 'cancelled');
      if (Buffer.byteLength(output) > MAX_YOUTUBE_SEARCH_OUTPUT_BYTES) throw new SearchFailure('invalid-response');
      let value: unknown; try { value = JSON.parse(output); } catch { throw new SearchFailure('invalid-response'); }
      let filtered: ReturnType<typeof filterYouTubeSearchEntries>;
      try { filtered = filterYouTubeSearchEntries(value, scope); } catch { throw new SearchFailure('invalid-response'); }
      if (sequence !== this.sequence || key !== scopeKey(this.current())) return failure('cancelled');
      const id = randomUUID(); this.receipt = { id, scope: key, songs: new Map(filtered.songs.map(song => [song.videoId, { ...song }])) };
      return { provider: 'youtube', status: 'ok', searchId: id, ...filtered,
        message: `${filtered.counts.returned} karaoke candidates from ${filtered.counts.examined} YouTube search results. Check the original title and channel before queueing.`,
        qualityNote: YOUTUBE_KARAOKE_QUALITY_NOTE };
    } catch (error) {
      if (sequence !== this.sequence || options.signal?.aborted) return failure('cancelled');
      return failure(controller.signal.aborted ? controller.signal.reason === 'timed-out' ? 'timed-out' : 'cancelled' : error instanceof SearchFailure ? error.status : 'unavailable');
    } finally {
      clearTimeout(timer); options.signal?.removeEventListener('abort', abort);
      if (this.controller === controller) this.controller = null;
    }
  }
}
