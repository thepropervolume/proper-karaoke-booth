import assert from 'node:assert/strict';
import test from 'node:test';
import { PartyTymeAccount, PartyTymeError, PARTY_TYME_API, PARTY_TYME_SITE, partyTymeCredentials, partyTymeProgressive, partyTymeSongs } from '../../src/main/partytyme-account';
const token = 'PRIVATE_SESSION_TOKEN', clientToken = 'PUBLIC_SITE_CONFIGURATION';
const html = `<script data-drupal-selector="drupal-settings-json">${JSON.stringify({ codesbasePublic: { options: { api: PARTY_TYME_API, version: '12.0', cs_auth_token: clientToken } } })}</script>`;
const video = {
    type: 'video', id: '34962', name: 'Wonderwall', short_description: 'Made Popular By Oasis', duration: '258', drm: 'false', meta: { actors: [{ name: 'Noel Gallagher' }] }
};
const url = 'https://cdnapisec.kaltura.com/p/513551/sp/51355100/playManifest/entryId/1_track/format/url/protocol/https/flavorIds/1_video/a.mp4';
const script = `playerSources.progressive = [{ url: '${url}', mimetype: 'video/mp4' }];`;
const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
function fixture(options: {
    premium?: boolean;
    expired?: () => boolean;
    searchGate?: () => Promise<void>;
    searchResponse?: (query: string) => unknown;
} = {}) {
    const calls: {
        url: string;
        params: URLSearchParams;
    }[] = [];
    const fetcher: typeof fetch = async (input, init) => {
        const location = String(input), params = new URLSearchParams(typeof init?.body === 'string' ? init.body : new URL(location).search);
        assert.equal(init?.redirect, 'error');
        assert.equal(init?.credentials, 'omit');
        calls.push({ url: location, params });
        if (location === PARTY_TYME_SITE + '/')
            return new Response(html);
        if (location === PARTY_TYME_API + '/authenticate')
            return json({ auth_token: token });
        assert.equal(params.get('auth_token'), token);
        if (location === PARTY_TYME_API + '/getconfiguration')
            return options.expired?.() ? json({ objects: [] }) : json({ objects: [{ type: 'user', user_permission: options.premium === false ? 'UR' : 'UR,PR' }] });
        if (location === PARTY_TYME_API + '/search') {
            await options.searchGate?.();
            return json(options.searchResponse?.(params.get('key') ?? '') ?? { objects: [video] });
        }
        if (location.startsWith(PARTY_TYME_API + '/embeddedVideoPlayer?'))
            return new Response(script);
        throw Error('Unexpected test request');
    };
    return { account: new PartyTymeAccount({ fetch: fetcher }), fetcher, calls };
}
test('an empty artist-and-title search retries once using the longest word and filters unrelated recordings', async () => {
    const f = fixture({ searchResponse: key => ({ objects: key === 'wonderwall' ? [video, { ...video, id: '39854', short_description: 'Made Popular By The Mike Flowers Pops' }, video] : [] }) });
    await f.account.connect({ username: 'user', password: 'secret' });
    const found = await f.account.search('Oasis - Wonderwall');
    assert.deepEqual(found.map(song => song.videoId), ['34962']);
    assert.deepEqual(f.calls.filter(call => call.url.endsWith('/search')).map(call => call.params.get('key')), ['Oasis - Wonderwall', 'wonderwall']);
});
test('fallback normalizes punctuation and accents but does not guess missing query words', async () => {
    const matched = { ...video, id: '36061', name: "Mr. Brightside", short_description: 'Made Popular By The Killers' };
    const f = fixture({ searchResponse: key => ({ objects: key === 'brightside' ? [matched] : [] }) });
    await f.account.connect({ username: 'user', password: 'secret' });
    assert.deepEqual((await f.account.search('The Killers - Mr Brightside')).map(song => song.videoId), ['36061']);
    assert.deepEqual(await f.account.search('The Killers - Mr Brightside live'), []);
});
test('an exact hit avoids fallback and a provider error is never retried', async () => {
    const f = fixture();
    await f.account.connect({ username: 'user', password: 'secret' });
    assert.equal((await f.account.search('Oasis Wonderwall')).length, 1);
    assert.equal(f.calls.filter(call => call.url.endsWith('/search')).length, 1);
    const bad = fixture({ searchResponse: () => ({ error: true }) });
    await bad.account.connect({ username: 'user', password: 'secret' });
    await assert.rejects(bad.account.search('Oasis Wonderwall'));
    assert.equal(bad.calls.filter(call => call.url.endsWith('/search')).length, 1);
});
test('cancelling an empty exact search prevents the fallback request', async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const f = fixture({ searchGate: () => gate, searchResponse: () => ({ objects: [] }) });
    await f.account.connect({ username: 'user', password: 'secret' });
    const abort = new AbortController();
    const pending = f.account.search('Oasis Wonderwall', abort.signal);
    abort.abort(); release();
    await assert.rejects(pending);
    assert.equal(f.calls.filter(call => call.url.endsWith('/search')).length, 1);
});
test('consumer login encodes the real form and returns only account status; artists do not become songwriters', async () => {
    const { account, calls } = fixture();
    const status = await account.connect({ username: 'person@example.test', password: 'p+@ &word' });
    assert.equal(status.state, 'connected');
    assert.equal(status.premium, true);
    const login = calls.find(c => c.url.endsWith('/authenticate'))!;
    assert.equal(login.params.get('username'), 'person%40example.test');
    assert.equal(login.params.get('password'), 'p%2B%40+%26word');
    assert.doesNotMatch(JSON.stringify(status), /PRIVATE|person|example|word/);
    assert.deepEqual(await account.search('Oasis'), [{ videoId: '34962', title: 'Wonderwall', artist: 'Oasis', durationSeconds: 258, explicit: null }]);
    const authorized = await account.requestMedia('34962');
    assert.equal(authorized.url, url);
    assert.match(authorized.accountScope, /^[a-f0-9]{64}$/);
    assert.equal(calls.filter(c => c.url.endsWith('/getconfiguration')).length, 2, 'Each authorization rechecks subscription.');
    account.close();
});
test('inactive or expired accounts cannot use returned video locations or cached access', async () => {
    const inactive = fixture({ premium: false });
    await inactive.account.connect({ username: 'user', password: 'secret' });
    await assert.rejects(inactive.account.requestMedia('34962'), (e: unknown) => e instanceof PartyTymeError && e.code === 'not-entitled');
    assert.ok(!inactive.calls.some(c => c.url.includes('embeddedVideoPlayer')));
    let expired = false;
    const f = fixture({ expired: () => expired });
    await f.account.connect({ username: 'user', password: 'secret' });
    expired = true;
    await assert.rejects(f.account.requestMedia('34962'), (e: unknown) => e instanceof PartyTymeError && e.code === 'expired');
    assert.equal(f.account.status().state, 'expired');
    assert.equal(f.account.accountScope(), null);
});
test('sign-out fences late search and clears remembered material', async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => {
        release = resolve;
    });
    const f = fixture({ searchGate: () => gate });
    await f.account.connect({ username: 'user', password: 'secret' });
    const pending = f.account.search('Oasis');
    await f.account.disconnect();
    release();
    await assert.rejects(pending, /Sign in/);
    assert.equal(f.account.status().state, 'disconnected');
});
test('bad credentials and provider bodies never leak in user errors', async () => {
    const account = new PartyTymeAccount({
        fetch: async (input) => String(input) === PARTY_TYME_SITE + '/' ? new Response(html) : json({ error: { message: 'secret-password@example.test' } })
    });
    const result = await account.connect({ username: 'user', password: 'secret' });
    assert.equal(result.state, 'disconnected');
    assert.doesNotMatch(JSON.stringify(result), /secret|example/);
    assert.match(result.message!, /did not accept/);
});
test('saved tokens restore only after a fresh account check and never include passwords', async () => {
    const f = fixture();
    let saved: any = null;
    const vault = { async load() {
            return saved;
        }, async save(value: any) {
            saved = value;
            return true;
        }, async clear() {
            saved = null;
        } };
    const first = new PartyTymeAccount({ fetch: f.fetcher, vault });
    await first.connect({ username: 'user', password: 'secret' });
    const scope = first.accountScope();
    const decoded = JSON.parse(Buffer.from(saved.sessionKey, 'base64url').toString());
    assert.equal(decoded.authToken, token);
    assert.ok(!('password' in decoded));
    first.close();
    const restored = new PartyTymeAccount({ fetch: f.fetcher, vault });
    await restored.restore();
    assert.equal(restored.accountScope(), scope);
    assert.equal(restored.status().persistence, 'os-protected');
    await restored.disconnect();
    assert.equal(saved, null);
});
test('only a supported provider literal can produce a progressive source without executing script', () => {
    assert.equal(partyTymeProgressive(script).url, url);
    for (const input of [script.replace('https://cdnapisec.kaltura.com', 'http://127.0.0.1'), script.replace('/p/513551/', '/p/999/'), script.replace('video/mp4', 'video/unknown'), 'globalThis.secret = 1'])
        assert.throws(() => partyTymeProgressive(input));
    assert.deepEqual(partyTymeCredentials('user:p:a:ss'), { username: 'user', password: 'p:a:ss' });
    assert.deepEqual(partyTymeCredentials('{"email":"a@example.test","password":"p"}'), { username: 'a@example.test', password: 'p' });
    assert.throws(() => partyTymeCredentials('user only'));
    assert.equal(partyTymeSongs({ objects: [{ ...video, short_description: 'Unknown' }] })[0].artist, '');
});
