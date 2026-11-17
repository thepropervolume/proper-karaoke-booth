import assert from 'node:assert/strict';
import test from 'node:test';
import { createInitialState } from '../../src/domain';
import { DEFAULT_SETTINGS } from '../../src/domain/settings';
import { PartyTymeHost } from '../../src/main/partytyme-host';
import type { PartyTymeMediaCache } from '../../src/main/partytyme-media';
const song = { videoId: '34962', title: 'Wonderwall', artist: 'Oasis', durationSeconds: 258, explicit: null };
function fixture() {
    let state = createInitialState('show', 'epoch'), settings = { ...DEFAULT_SETTINGS }, revision = 1, connected = true, authorizations = 0;
    const media = new Map<string, any>(), scope = 'a'.repeat(64), ready = { path: 'private.mp4', bytes: 100, fingerprint: 'b'.repeat(64), accountScope: scope, contentKey: 'entry:1' };
    const account = {
        status: () => ({
            state: connected ? 'connected' as const : 'disconnected' as const, premium: true, revision, persistence: 'memory-only' as const
        }), revision: () => revision, accountScope: () => connected ? scope : null,
        search: async () => [song], requestMedia: async () => {
            authorizations++;
            if (!connected)
                throw Error('Signed out');
            return { url: 'https://cdnapisec.kaltura.com/video', contentKey: ready.contentKey, accountScope: scope, revision };
        }
    };
    const cache = { prepare: async () => ready } as unknown as PartyTymeMediaCache;
    const host = new PartyTymeHost(account, cache, {
        state: () => state, settings: () => settings, media: id => media.get(id), commit: (next, rows = []) => {
            state = next;
            for (const row of rows)
                media.set(row.id, row);
        }, changed: () => {
        }
    });
    return {
        host, get state() {
            return state;
        }, get authorizations() {
            return authorizations;
        }, settings, signOut() {
            connected = false;
            revision++;
            host.accountChanged();
        }
    };
}
test('only a current receipt can queue, and both preparation and each resume require account authorization', async () => {
    const f = fixture();
    try {
        const result = await f.host.search('Oasis');
        assert.ok(result.searchId);
        assert.equal(f.host.request({ searchId: 'forged', videoId: song.videoId, singerId: null, requestId: 'r' }).ok, false);
        assert.equal(f.state.versions.length, 0);
        const queued = f.host.request({ searchId: result.searchId, videoId: song.videoId, singerId: null, requestId: 'r' });
        assert.equal(queued.ok, true);
        const id = queued.versionId!;
        for (let tries = 0; tries < 100 && !f.host.status().some(p => p.phase === 'ready'); tries++)
            await new Promise(resolve => setTimeout(resolve, 1));
        await f.host.authorizeStart(id);
        const before = f.authorizations;
        await f.host.authorizeStart(id);
        assert.equal(f.authorizations, before + 1);
        f.signOut();
        assert.equal((await f.host.search('Oasis')).status, 'disconnected');
        await assert.rejects(f.host.authorizeStart(id), /Sign in/);
    }
    finally {
        await f.host.shutdown();
    }
});
test('a changed blacklist invalidates an earlier selection without creating a recording', async () => {
    const f = fixture();
    try {
        const result = await f.host.search('Oasis');
        f.settings.artistBlacklist = ['Oasis'];
        assert.equal(f.host.request({ searchId: result.searchId, videoId: song.videoId, singerId: null, requestId: 'r' }).ok, false);
        assert.equal(f.state.versions.length, 0);
    }
    finally {
        await f.host.shutdown();
    }
});
