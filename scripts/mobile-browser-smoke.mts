/** Browser rehearsal for the singer app over the real relay with synthetic catalogs. */
import { createServer, request as requestHttp } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import { RelayStore } from '../src/relay/store';
import { RelayBroker } from '../src/relay/broker';
import { startQueueRelayService } from '../src/relay/http';
import { MobileShow } from '../src/mobile/show';
import { MobileRoomAuthority } from '../src/mobile/room-authority';
import type { InternetGuestCall } from '../src/main/internet-queue-client';
import { createSingerStaticHandler } from '../src/main/remote-static';

const origin = 'https://queue.thepropervolume.com';
const { version } = JSON.parse(await readFile('package.json', 'utf8'));
const evidence = resolve('release/mobile-singer-browser-' + version);
await mkdir(evidence, { recursive: true });
const db = new DatabaseSync(':memory:');
const broker = new RelayBroker(new RelayStore(db, { publicOrigin: origin }), { pollTimeoutMs: 300, rpcTimeoutMs: 3000 });
const token = 'x'.repeat(43), slug = 'singer-rehearsal';
const relay = await startQueueRelayService({ publicOrigin: origin, owners: [{ id: crypto.randomUUID(), tokenSha256: createHash('sha256').update(token).digest('hex') }],
  broker, staticHandler: createSingerStaticHandler(resolve('dist/ui')), port: 0, closeDependencies: () => db.close(), mobileEnabled: true,
  mobileCatalog: async (_query, _signal, _fetch, filter) => {
    if (filter?.source === 'karafun') return { items: [{ id: '9217', title: 'KaraFun Recording', artist: 'Oasis' }] };
    if (filter?.source === 'partytyme') return { items: [{ id: 'PH1215', title: 'Party Tyme Pro Recording', artist: 'Oasis' }] };
    return filter?.cursor ? { items: [{ id: 'youtube_Catalog1234', title: 'Second Catalog Page', artist: 'Oasis' }], nextCursor: null } :
      { items: [{ id: 'youtube_Video123456', title: 'Wonderwall', artist: 'Oasis' }], nextCursor: 'page_two' };
  },
});
const staticRoot = resolve('dist/mobile');
const config = await readFile('deploy/queue-relay/mobile.conf', 'utf8');
const csp = /Header always set Content-Security-Policy "([^"]+)"/.exec(config)?.[1];
assert.ok(csp, 'Mobile deployment CSP is missing.');
const server = createServer((request, response) => {
  if (!request.url?.startsWith('/app/')) {
    const proxy = requestHttp({ host: '127.0.0.1', port: relay.port, path: request.url, method: request.method,
      headers: { ...request.headers, host: new URL(origin).host } }, remote => {
      response.writeHead(remote.statusCode ?? 500, remote.headers); remote.pipe(response);
    });
    proxy.on('error', () => response.destroy()); request.pipe(proxy); return;
  }
  const asset = new URL(request.url ?? '/', origin).pathname;
  const path = resolve(staticRoot, asset === '/app/' ? 'index.html' : asset.replace(/^\/app\//, ''));
  if (!path.startsWith(staticRoot + sep)) { response.writeHead(404); response.end(); return; }
  const mime: Record<string, string> = { html: 'text/html', js: 'text/javascript', css: 'text/css', png: 'image/png', webp: 'image/webp', woff2: 'font/woff2' };
  void readFile(path).then(bytes => {
    response.writeHead(200, { 'Content-Security-Policy': csp, 'Content-Type': mime[path.split('.').at(-1)!] ?? 'application/octet-stream' });
    response.end(bytes);
  }).catch(() => { response.writeHead(404); response.end(); });
});
await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
assert.ok(address && typeof address !== 'string');
const testOrigin = 'http://127.0.0.1:' + address.port;
const hostPost = async (operation: string, payload: unknown, signal?: AbortSignal) => {
  const response = await fetch(testOrigin + '/v1/relay/host/' + operation, { method: 'POST', signal,
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token, 'X-TPV-Room-Discovery': 'yes' }, body: JSON.stringify(payload) });
  assert.equal(response.status, 200, 'Host ' + operation);
  return response.json();
};
const show = new MobileShow();
show.add([
  { id: 'youtube_Video123456', provider: 'karaokenerds', videoId: 'Video123456', title: 'Wonderwall', artist: 'Oasis' },
  ...Array.from({ length: 55 }, (_, index) => {
    const videoId = 'RoomTest' + String(index).padStart(3, '0');
    return { id: 'youtube_' + videoId, provider: 'karaokenerds' as const, videoId, title: 'Room Match ' + index, artist: 'Oasis' };
  }),
]);
const authority = new MobileRoomAuthority(show);
const opened = await hostPost('open', { slug, openId: crypto.randomUUID() });
const room = { roomId: opened.roomId, generation: opened.generation };
const stopPolling = new AbortController();
let announceStage = true;
const browser = await chromium.launch({ executablePath: process.env.TPV_CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const errors: string[] = [], checks: string[] = [];
const polling = (async () => {
  try {
    while (!stopPolling.signal.aborted) {
      const batch = await hostPost('poll', room, stopPolling.signal);
      const responses = (batch.requests as InternetGuestCall[]).map(call => {
        const reply = authority.dispatch(call);
        if (reply.status === 200 && reply.body && (call.operation === 'catalog' || call.operation === 'snapshot')) {
          if (call.operation === 'snapshot') {
            reply.body.sources = ['karaokenerds', 'karafun'];
            if (announceStage) {
              const snapshot = reply.body;
              const current = show.state();
              reply.body.stage = {
                nowPlaying: { title: 'Rehearsal Song', artist: 'Oasis', singer: 'House Singer', versionId: 'youtube_RoomTest001',
                  status: 'playing', source: 'karaokenerds', timing: { position: 75, duration: 240 } },
                queue: current.queue.filter(entry => entry.status === 'accepted').slice(0, 30).map((entry, index) => {
                  const song = current.songs.find(item => item.id === entry.songId)!;
                  return { title: song.title, artist: song.artist, singer: entry.singer, position: index + 1, status: 'queued',
                    ...(entry.singerId === snapshot.singerId ? { ownRequestId: entry.id } : {}) };
                }),
                queueTruncated: false,
              };
            }
          }
          const field = call.operation === 'snapshot' ? 'catalog' : 'items';
          if (Array.isArray(reply.body[field])) reply.body[field] = reply.body[field].map(song => ({
            ...song, source: 'karaokenerds', recordingId: 'youtube:' + song.id.slice('youtube_'.length),
          }));
        }
        return reply;
      });
      if (responses.length) await hostPost('reply', { ...room, responses }, stopPolling.signal);
    }
  } catch (error) { if (!stopPolling.signal.aborted) errors.push(String(error)); }
})();

try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  await context.route(origin + '/**', async route => {
    const request = route.request(), url = new URL(request.url());
    const reply = await fetch(testOrigin + url.pathname + url.search, { method: request.method(), headers: request.headers(),
      ...(request.method() !== 'GET' && { body: request.postDataBuffer() }) });
    await route.fulfill({ status: reply.status, headers: Object.fromEntries(reply.headers), body: Buffer.from(await reply.arrayBuffer()) });
  });
  const singer = await context.newPage();
  singer.on('pageerror', error => errors.push(error.message));
  await singer.goto(origin + '/app/');
  const exactButton = (name: string) => singer.getByRole('button', { name, exact: true });
  await exactButton('Continue as Guest').click();
  await singer.getByRole('heading', { name: 'Rooms', exact: true }).waitFor();
  const nav = singer.getByRole('navigation', { name: 'Singer workspace' });
  const tab = (name: string) => nav.getByRole('button', { name, exact: true }).click();
  assert.equal(await nav.getByRole('button').count(), 5);
  assert.equal(await singer.getByRole('button', { name: /Full Host/ }).count(), 0);
  await tab('Search');
  for (const [width, height] of [[320, 640], [390, 844], [1024, 768]]) {
    await singer.setViewportSize({ width, height });
    const search = await singer.getByRole('searchbox').boundingBox(), footer = await nav.boundingBox();
    assert.ok(search && footer && search.y >= 0 && search.y + search.height < footer.y);
    assert.ok(await singer.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  }
  await singer.setViewportSize({ width: 390, height: 844 });
  checks.push('Five workspace destinations, fits small phones and tablet, no mobile host controls.');
  const songOptions = (title: string) => exactButton('Options for ' + title);
  await singer.getByRole('searchbox').fill('Oasis');
  await singer.getByText('Wonderwall', { exact: true }).waitFor();
  await exactButton('More Karaoke Nerds Results').click();
  await singer.getByText('Second Catalog Page', { exact: true }).waitFor();
  await songOptions('Wonderwall').click();
  await exactButton('Join a Room to Queue').waitFor();
  assert.equal(await exactButton('Add to Queue').count(), 0);
  await exactButton('Save to Playlist for Wonderwall').click();
  await singer.getByLabel('New playlist name').fill('At the Show');
  await exactButton('Save Song').click();
  await singer.getByText('Song saved.', { exact: true }).waitFor();
  await exactButton('Close').click();
  checks.push('Disconnected Karaoke Nerds search pages, and results save without playback or a queue action.');
  await tab('Account');
  assert.equal(await singer.locator('.mobile-version').innerText(), version);
  await singer.getByRole('button', { name: /Display Name/ }).click();
  await singer.getByRole('textbox', { name: 'Display name', exact: true }).fill('Alex');
  await exactButton('Save').click();
  await singer.getByText('Alex', { exact: true }).waitFor();
  await singer.getByText('Browse Sources', { exact: true }).click();
  await singer.getByLabel('KaraFun', { exact: true }).check();
  await singer.getByLabel('Party Tyme Pro', { exact: true }).check();
  await tab('Search');
  await singer.getByText('KaraFun Recording').waitFor();
  await singer.getByText('Party Tyme Pro Recording').waitFor();
  await exactButton('Party Tyme Pro').click();
  assert.equal(await singer.getByText('Wonderwall', { exact: true }).count(), 0);
  await exactButton('All').click();
  await singer.screenshot({ path: resolve(evidence, 'browse.png') });
  checks.push('Public paid-provider metadata is searchable with no sign-in, and the device stores a profile.');

  await tab('Rooms');
  await exactButton('Join Room').click();
  assert.equal(await singer.getByRole('textbox', { name: 'Display name', exact: true }).inputValue(), 'Alex');
  await singer.getByRole('dialog').getByRole('button', { name: 'Join Room', exact: true }).click();
  await songOptions('Wonderwall').waitFor();
  assert.equal(await singer.getByText('Party Tyme Pro Recording').count(), 0);
  const roomLaterResult = songOptions('Room Match 54');
  assert.equal(await roomLaterResult.count(), 0);
  await exactButton('Load More Songs').click();
  await roomLaterResult.waitFor();
  await songOptions('Wonderwall').click();
  await exactButton('Star Wonderwall').click();
  await singer.getByRole('button', { name: 'Remove Wonderwall from starred songs', pressed: true }).waitFor();
  assert.equal(show.state().queue.length, 0);
  await exactButton('Add to Queue').click();
  await singer.getByText('Request received.', { exact: true }).waitFor();
  assert.equal(show.state().queue.length, 1);
  await singer.getByText('Your turn · #1', { exact: true }).waitFor();
  await singer.screenshot({ path: resolve(evidence, 'queue.png') });
  const stagePhoto = singer.waitForResponse(response => /playing-photo-.*\.webp$/.test(response.url()) && response.ok());
  await exactButton('Now Playing: Rehearsal Song').click();
  await stagePhoto;
  const background = await singer.locator('.singer-stage-art').evaluate(async element => {
    const match = /url\("([^"]+)"\)/.exec(getComputedStyle(element).backgroundImage);
    if (!match) return false;
    const artwork = new Image();
    artwork.src = match[1];
    await artwork.decode();
    return artwork.naturalWidth > 0;
  });
  assert.ok(background, 'Now Playing photo should be rendered from the bundled asset.');
  await singer.getByRole('heading', { name: 'Rehearsal Song' }).waitFor();
  assert.equal(await singer.getByRole('progressbar', { name: 'Song progress' }).getAttribute('value'), '75');
  assert.equal(await singer.getByText('Oasis · Sung by House Singer').count(), 1);
  await singer.screenshot({ path: resolve(evidence, 'playing.png') });
  await exactButton('Close Now Playing').click();
  await exactButton('Withdraw').click();
  await singer.getByText('Request withdrawn.', { exact: true }).waitFor();
  assert.equal(await singer.getByText('Your turn · #1', { exact: true }).count(), 0);
  announceStage = false;
  await tab('Rooms');
  await exactButton('Refresh').click();
  await tab('Queue');
  await singer.getByText(/Live room rotation requires a compatible/).waitFor();
  await tab('Search');
  assert.equal(await exactButton('KaraFun').count(), 1);
  checks.push('Updated room relays project the live queue and host timeline; older hosts retain request management and connected sources.');

  const roomPage = await context.newPage();
  roomPage.on('pageerror', error => errors.push(error.message));
  await roomPage.goto(origin + '/' + slug);
  await roomPage.getByLabel('Your name').fill('Browser Guest');
  await roomPage.getByRole('button', { name: 'Join the show', exact: true }).click();
  await roomPage.getByText('Hello, Browser Guest!', { exact: true }).waitFor();
  const requestsBeforeStar = show.state().queue;
  await roomPage.getByRole('button', { name: 'Star Wonderwall', exact: true }).click();
  await roomPage.getByText("Browser Guest's Starred Songs (1)", { exact: true }).waitFor();
  assert.deepEqual(show.state().queue, requestsBeforeStar);
  await roomPage.close();

  await tab('Rooms');
  await exactButton('Leave Room').click();
  await tab('Search');
  await singer.getByText('KaraFun Recording').waitFor();
  assert.equal(await singer.getByText('Party Tyme Pro Recording').count(), 0);
  checks.push('Nearby suggestion requires explicit join, match 56 is available after loading more, real relay requests reach the host, and leaving inherits room sources.');
  await singer.reload();
  await tab('Playlists');
  await singer.getByRole('button', { name: 'Starred Songs 1 song', exact: true }).waitFor();
  await singer.getByRole('button', { name: 'At the Show 1 song' }).click();
  await singer.getByText('Wonderwall', { exact: true }).waitFor();
  await tab('Rooms');
  await singer.getByLabel('Room code or invitation link').fill(origin + '/' + slug);
  await exactButton('Go').click();
  assert.equal(await singer.getByRole('textbox', { name: 'Display name', exact: true }).inputValue(), 'Alex');
  await singer.getByRole('dialog').getByRole('button', { name: 'Join Room', exact: true }).click();
  await songOptions('Wonderwall').waitFor();
  await tab('Rooms');
  stopPolling.abort();
  await polling;
  await hostPost('close', room);
  await exactButton('Refresh').click();
  await singer.getByText(/This room ended/).waitFor();
  checks.push('Mobile and browser guests star songs without queueing. Starred playlists are scoped to the singer and persist across reload.');
  checks.push('Profile and playlists survive reload, a manual HTTPS room link works, and closed rooms return to browse mode.');
  assert.deepEqual(errors, []);
} finally {
  stopPolling.abort();
  await polling;
  await writeFile(resolve(evidence, 'result.json'), JSON.stringify({ checks, errors }, null, 2));
  await browser.close();
  await new Promise<void>(resolve => server.close(() => resolve()));
  await relay.stop();
}
console.log(JSON.stringify({ checks, errors, evidence }, null, 2));
