import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, open, realpath, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { PartyTymeAuthorization } from './partytyme-account';
import type { KaraFunPreparation } from '../domain/karafun';
import { fingerprintMedia } from './media-verification';
export type PartyTymePrepared = {
    path: string;
    fingerprint: string;
    bytes: number;
    accountScope: string;
    contentKey: string;
};
/** Account-scoped playback preparation, never an export or permanent song import. */
export class PartyTymeMediaCache {
    constructor(private readonly root: string, private readonly download: typeof fetch = fetch) {
    }
    async prepare(videoId: string, descriptor: PartyTymeAuthorization, signal: AbortSignal, progress: (value: Omit<KaraFunPreparation, 'versionId'>) => void): Promise<PartyTymePrepared> {
        signal = AbortSignal.any([signal, AbortSignal.timeout(15 * 60000)]);
        if (!/^[a-f0-9]{64}$/.test(descriptor.accountScope) || !/^[1-9]\d{0,11}$/.test(videoId))
            throw new Error('Invalid Party Tyme cache identity.');
        await mkdir(this.root, { recursive: true, mode: 0o700 });
        if ((await lstat(this.root)).isSymbolicLink())
            throw new Error('Party Tyme cache needs recovery.');
        const parent = join(await realpath(this.root), descriptor.accountScope);
        await mkdir(parent, { mode: 0o700 }).catch(error => {
            if (error.code !== 'EEXIST')
                throw error;
        });
        if ((await lstat(parent)).isSymbolicLink())
            throw new Error('Party Tyme cache needs recovery.');
        const path = join(parent, videoId + '.mp4'), manifest = path + '.json';
        try {
            const info = await lstat(path), metaInfo = await lstat(manifest);
            if (!info.isFile() || info.isSymbolicLink() || info.size < 12 || info.size > 512 * 1024 * 1024 || !metaInfo.isFile() || metaInfo.isSymbolicLink() || metaInfo.size > 4096)
                throw new Error('Invalid cache entry');
            const metadata = await open(manifest, 'r');
            let saved;
            try {
                const bytes = Buffer.alloc(4097), part = await metadata.read(bytes, 0, bytes.length, 0);
                if (part.bytesRead > 4096 || part.bytesRead !== metaInfo.size)
                    throw new Error('Invalid cache entry');
                saved = JSON.parse(bytes.subarray(0, part.bytesRead).toString('utf8'));
            }
            finally {
                await metadata.close();
            }
            if (saved.contentKey === descriptor.contentKey && saved.bytes === info.size) {
                const checked = await fingerprintMedia(path, signal);
                if (checked.fingerprint === saved.fingerprint) {
                    progress({ phase: 'ready', received: info.size, total: info.size });
                    return {
                        path, bytes: info.size, fingerprint: checked.fingerprint, accountScope: descriptor.accountScope, contentKey: descriptor.contentKey
                    };
                }
            }
        }
        catch {
            signal.throwIfAborted(); /* An incomplete cache is prepared again. */
        }
        const temporary = join(parent, '.' + videoId + '.' + randomUUID() + '.mp4');
        let file: Awaited<ReturnType<typeof open>> | undefined, reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
        try {
            let target = new URL(descriptor.url), response: Response | undefined;
            for (let redirects = 0; redirects < 4; ++redirects) {
                if (!['https://cdnapisec.kaltura.com', 'https://cfvod.kaltura.com'].includes(target.origin) || target.username || target.password || target.hash)
                    throw new Error('Party Tyme returned an unsupported video location.');
                response = await this.download(target.href, { redirect: 'manual', credentials: 'omit', signal, headers: { Accept: 'video/mp4' } });
                if (![301, 302, 303, 307, 308].includes(response.status))
                    break;
                const location = response.headers.get('location');
                await response.body?.cancel();
                if (!location)
                    throw new Error('Party Tyme video redirect is incomplete.');
                target = new URL(location, target);
                response = undefined;
            }
            if (!response?.ok || !response.body || !/^(?:video\/mp4|application\/octet-stream)(?:;|$)/i.test(response.headers.get('content-type') ?? '')) {
                void response?.body?.cancel().catch(() => {
                });
                throw new Error('Party Tyme video could not be loaded. Reconnect and retry.');
            }
            const max = 512 * 1024 * 1024, total = Number(response.headers.get('content-length')) || null;
            if (total !== null && (total < 1 || total > max)) {
                await response.body.cancel();
                throw new Error('Party Tyme video exceeds the supported size.');
            }
            file = await open(temporary, 'wx', 0o600);
            reader = response.body.getReader();
            const hash = createHash('sha256');
            let received = 0, last = 0;
            progress({ phase: 'downloading', received: 0, total });
            for (;;) {
                signal.throwIfAborted();
                const part = await reader.read();
                if (part.done)
                    break;
                received += part.value.byteLength;
                if (received > max)
                    throw new Error('Party Tyme video exceeds the supported size.');
                hash.update(part.value);
                await file.writeFile(part.value);
                if (Date.now() - last > 200) {
                    progress({ phase: 'downloading', received, total });
                    last = Date.now();
                }
            }
            signal.throwIfAborted();
            if (received < 12 || total !== null && received !== total)
                throw new Error('Party Tyme video download was incomplete. Retry.');
            const header = Buffer.alloc(12);
            await file.sync();
            await file.close();
            file = undefined;
            const check = await open(temporary, 'r');
            try {
                await check.read(header, 0, header.length, 0);
            }
            finally {
                await check.close();
            }
            if (header.toString('ascii', 4, 8) !== 'ftyp')
                throw new Error('Party Tyme returned an unsupported video.');
            for (const destination of [path, manifest]) {
                const old = await lstat(destination).catch(error => {
                    if (error.code === 'ENOENT')
                        return null;
                    throw error;
                });
                if (old && (!old.isFile() || old.isSymbolicLink()))
                    throw new Error('Party Tyme cache needs recovery.');
            }
            const fingerprint = hash.digest('hex');
            await rename(temporary, path);
            // Metadata contains no account token, signed URL or password. A partial
            // write is harmless: the next preparation rejects it and retries.
            await writeFile(temporary + '.json', JSON.stringify({ contentKey: descriptor.contentKey, bytes: received, fingerprint }), { mode: 0o600, flag: 'wx' });
            await rename(temporary + '.json', manifest);
            progress({ phase: 'ready', received, total: received });
            return {
                path, bytes: received, fingerprint, accountScope: descriptor.accountScope, contentKey: descriptor.contentKey
            };
        }
        finally {
            await reader?.cancel().catch(() => {
            });
            reader?.releaseLock();
            await file?.close().catch(() => {
            });
            await unlink(temporary).catch(() => {
            });
            await unlink(temporary + '.json').catch(() => {
            });
        }
    }
}
