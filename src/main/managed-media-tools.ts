import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { chmod, lstat, mkdir, mkdtemp, realpath, rename, rmdir, unlink } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { YtDlpChannel } from '../domain/media-tools';

type Asset = { name: string; bytes: number; sha256: string };
type Release = { repository: string; version: string; assets: Record<'win32' | 'darwin' | 'linux', Asset> };

/** Official release tags and SHA2-256SUMS. Advance pins in code review. */
const releases: Record<YtDlpChannel, Release> = {
  stable: {
    repository: 'yt-dlp', version: '2026.11.23', assets: {
      win32: { name: 'yt-dlp.exe', bytes: 23627865, sha256: '622ed48023cac1daa52a3bf3a6ac38f03514de214b5f0fa069389fd0f6d17e5c' },
      darwin: { name: 'yt-dlp_macos', bytes: 37478576, sha256: '57654854886d0398a798895aadf5173e2749fbb5e249b9f3728022ab376e11fb' },
      linux: { name: 'yt-dlp_linux', bytes: 41184064, sha256: '249ddb058234276bc449b9cd9492aad9f133bda5923c61a9e39983ae114ef17d' },
    },
  },
  nightly: {
    repository: 'yt-dlp-nightly-builds', version: '2026.11.24.232653', assets: {
      win32: { name: 'yt-dlp.exe', bytes: 23628044, sha256: '8c794d80c1be71cc70108cd3e02de6288b92c8c64e961edde96ba3fed4b6f8b0' },
      darwin: { name: 'yt-dlp_macos', bytes: 37479936, sha256: '8cefde1eda9c98113207544b5bf76632aead31b27369885e44513796925d3ddd' },
      linux: { name: 'yt-dlp_linux', bytes: 41184416, sha256: '4796c133d800d279ccc2bc6e8408bc202fc7b4f04dfa49ce2f7a9152ad17b42a' },
    },
  },
};

export type PinnedMediaTool = Asset & { version: string; url: string };
export function pinnedYtDlp(channel: YtDlpChannel, platform = process.platform, arch = process.arch): PinnedMediaTool | null {
  if (platform !== 'win32' && platform !== 'darwin' && platform !== 'linux') return null;
  if (arch !== 'x64' && !(platform === 'darwin' && arch === 'arm64')) return null;
  const release = releases[channel], asset = release.assets[platform];
  return { ...asset, version: release.version, url: `https://github.com/yt-dlp/${release.repository}/releases/download/${release.version}/${asset.name}` };
}

const identicalPath = (a: string, b: string) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
const approvedAssets = new Set(['https://release-assets.githubusercontent.com', 'https://objects.githubusercontent.com']);

/** Managed executables come directly from the upstream publisher. Never run a
 * downloaded file until its byte length and the repository pin agree. */
export class ManagedMediaTools {
  private readonly pending = new Map<YtDlpChannel, Promise<string>>();

  constructor(private readonly root: string, private readonly fetchAsset: typeof fetch = fetch,
    private readonly pin: (channel: YtDlpChannel) => PinnedMediaTool | null = pinnedYtDlp) {}

  private destination(root: string, channel: YtDlpChannel, asset: PinnedMediaTool): string {
    return join(root, `${channel}-${asset.version}-${asset.name}`);
  }

  private async verify(path: string, asset: PinnedMediaTool): Promise<boolean> {
    try {
      const info = await lstat(path);
      if (!info.isFile() || info.size !== asset.bytes || (process.platform !== 'win32' && (info.mode & 0o100) === 0)) return false;
      const hash = createHash('sha256');
      for await (const chunk of createReadStream(path)) hash.update(chunk);
      const after = await lstat(path);
      return after.isFile() && info.ino === after.ino && info.dev === after.dev && info.size === after.size &&
        info.mtimeMs === after.mtimeMs && hash.digest('hex') === asset.sha256;
    } catch { return false; }
  }

  async status(channel: YtDlpChannel): Promise<{ version: string | null; ready: boolean }> {
    const asset = this.pin(channel);
    if (!asset) return { version: null, ready: false };
    const root = await realpath(this.root).catch(() => null);
    return { version: asset.version, ready: !!root && identicalPath(root, this.root) && await this.verify(this.destination(root, channel, asset), asset) };
  }

  async prepare(channel: YtDlpChannel): Promise<string> {
    let task = this.pending.get(channel);
    if (!task) {
      task = this.install(channel);
      this.pending.set(channel, task);
    }
    try { return await task; } finally { if (this.pending.get(channel) === task) this.pending.delete(channel); }
  }

  private async install(channel: YtDlpChannel): Promise<string> {
    const asset = this.pin(channel);
    if (!asset) throw new Error('Managed yt-dlp is unavailable for this operating system and architecture.');
    if (!isAbsolute(this.root)) throw new Error('Invalid managed tools folder.');
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const root = await realpath(this.root);
    if (!identicalPath(root, this.root) || !(await lstat(root)).isDirectory()) throw new Error('Invalid managed tools folder.');
    const destination = this.destination(root, channel, asset);
    if (await this.verify(destination, asset)) return destination;
    const temporary = await mkdtemp(join(root, '.download-'));
    const stage = join(temporary, 'binary');
    try {
      const request = { redirect: 'manual', credentials: 'omit', signal: AbortSignal.timeout(90_000) } as const;
      let response = await this.fetchAsset(asset.url, request);
      if (response.status === 302 || response.status === 307) {
        const location = response.headers.get('location');
        const redirect = location && new URL(location);
        await response.body?.cancel();
        if (!redirect || !approvedAssets.has(redirect.origin) || redirect.username || redirect.password)
          throw new Error('Unexpected download location.');
        response = await this.fetchAsset(redirect.href, request);
      }
      if (!response.ok || !response.body) { await response.body?.cancel(); throw new Error('Download unavailable.'); }
      const hash = createHash('sha256');
      let bytes = 0;
      const verify = new Transform({ transform(chunk: Buffer, _encoding, done) {
        bytes += chunk.length;
        if (bytes > asset.bytes) { done(new Error('Download exceeds pinned size.')); return; }
        hash.update(chunk); done(null, chunk);
      } });
      await pipeline(Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]), verify,
        createWriteStream(stage, { flags: 'wx', mode: 0o600 }), { signal: request.signal });
      if (bytes !== asset.bytes || hash.digest('hex') !== asset.sha256) throw new Error('Download failed its integrity check.');
      if (process.platform !== 'win32') await chmod(stage, 0o700);
      if (!identicalPath(await realpath(root), root) || !identicalPath(await realpath(temporary), temporary)) throw new Error('Invalid download folder.');
      await rename(stage, destination);
      return destination;
    } catch { throw new Error('Could not prepare the verified yt-dlp build. Check your connection and try again in Preferences.'); }
    finally {
      await unlink(stage).catch(() => {});
      await rmdir(temporary).catch(() => {});
    }
  }
}
