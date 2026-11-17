import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PartyTymeMediaCache } from '../../src/main/partytyme-media';
const descriptor = { url: 'https://cdnapisec.kaltura.com/video', contentKey: 'entry:one', accountScope: 'a'.repeat(64), revision: 1 };
const bytes = Buffer.concat([Buffer.from([0, 0, 0, 20]), Buffer.from('ftypisom'), Buffer.alloc(100)]);
test('preparation follows only provider redirects, hashes bytes and checks cache integrity', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tpv-party-media-'));
    let calls = 0;
    const download: typeof fetch = async (url, init) => {
        calls++;
        assert.ok(!init?.headers || !('Authorization' in init.headers));
        return String(url).includes('cdnapisec') ? new Response(null, { status: 302, headers: { location: 'https://cfvod.kaltura.com/video.mp4' } }) : new Response(bytes, { headers: { 'content-type': 'video/mp4', 'content-length': String(bytes.length) } });
    };
    try {
        const cache = new PartyTymeMediaCache(root, download), signal = new AbortController().signal;
        const first = await cache.prepare('1', descriptor, signal, () => {
        });
        assert.deepEqual(await readFile(first.path), bytes);
        assert.equal(calls, 2);
        const second = await cache.prepare('1', descriptor, signal, () => {
        });
        assert.equal(second.fingerprint, first.fingerprint);
        assert.equal(calls, 2);
        await writeFile(first.path, Buffer.alloc(bytes.length));
        await cache.prepare('1', descriptor, signal, () => {
        });
        assert.equal(calls, 4, 'Tampering forces preparation again.');
        assert.doesNotMatch(await readFile(first.path + '.json', 'utf8'), /auth_token|password|https:/);
    }
    finally {
        await rm(root, { recursive: true, force: true });
    }
});
test('private redirects, non-video bodies, incomplete transfers and cancellation leave no usable media', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tpv-party-denied-'));
    try {
        for (const response of [() => new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/private' } }), () => new Response('bad', { headers: { 'content-type': 'text/html' } }), () => new Response(bytes, { headers: { 'content-type': 'video/mp4', 'content-length': String(bytes.length + 1) } })]) {
            let calls = 0;
            const cache = new PartyTymeMediaCache(root, async () => {
                calls++;
                return response();
            });
            await assert.rejects(cache.prepare('1', descriptor, new AbortController().signal, () => {
            }));
            assert.equal(calls, 1);
        }
        const abort = new AbortController();
        abort.abort();
        await assert.rejects(new PartyTymeMediaCache(root, async () => new Response(bytes)).prepare('1', descriptor, abort.signal, () => {
        }));
    }
    finally {
        await rm(root, { recursive: true, force: true });
    }
});
