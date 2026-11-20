/**
 * Explicit production smoke with synthetic, in-memory show data only.
 * Dry run: node --import tsx scripts/internet-catalog-live-smoke.mts
 * Live run: node --import tsx scripts/internet-catalog-live-smoke.mts --execute-live <absolute-owner-config>
 * No provider/media files, existing show databases, profiles, or account data are read.
 */
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { isAbsolute } from 'node:path';
import { createInitialState, type ShowState } from '../src/domain';
import { DEFAULT_SETTINGS } from '../src/domain/settings';
import { Store } from '../src/main/store';
import { RemoteAuthorityCoordinator } from '../src/main/remote-authority-coordinator';
import { InternetQueueClient } from '../src/main/internet-queue-client';
import { internetGuestTransport, lookupInternetSingerRoom } from '../src/remote/internet-transport';
import { INTERNET_QUEUE_ORIGIN } from '../src/remote/internet-session-control';

const args = process.argv.slice(2);
if (!args.length) {
  console.log('Dry run only. To open a disposable public room, run with --execute-live and an absolute private owner config path.');
} else {
  if (![2, 3].includes(args.length) || args[0] !== '--execute-live' || !isAbsolute(args[1]) || (args[2] !== undefined && !['--browser-window', '--screen-test'].includes(args[2]))) throw new Error('Usage: node --import tsx scripts/internet-catalog-live-smoke.mts --execute-live <absolute-owner-config>');
  const slug = `qa-catalog-${randomBytes(12).toString('hex')}`;
  const store = new Store<ShowState>(':memory:');
  let state = createInitialState('qa-show-0001', 'qa-epoch-001');
  for (let i = 0; i < 65; i++) state.versions.push({ id: `qa-song-${String(i).padStart(4, '0')}`, title: `Synthetic Shared ${i}`,
    artist: i === 62 ? 'Needle Artist' : 'Synthetic Artist', rating: 'clean' });
  state.versions.push({ id: 'qa-hidden-youtube', title: 'Synthetic Hidden Song', artist: 'Synthetic Artist', rating: 'clean',
    source: { provider: 'youtube', videoId: 'abcdefghijk' } });
  store.save(state);
  const settings = structuredClone(DEFAULT_SETTINGS); settings.sourceVisibility.youtube = false;
  const coordinator = new RemoteAuthorityCoordinator(store, () => settings, value => { state = value; });
  // A tiny locally synthesized JPEG; no screen capture or user media is used.
  const syntheticJpeg = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAA0JCgsKCA0LCgsODg0PEyAVExISEyccHhcgLikxMC4pLSwzOko+MzZGNywtQFdBRkxOUlNSMj5aYVpQYEpRUk//2wBDAQ4ODhMREyYVFSZPNS01T09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0//wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAgT/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCfALzf/9k=', 'base64');
  const client = new InternetQueueClient({ coordinator, configurationFile: args[1], screenFrame: () => syntheticJpeg });
  let roomCreated = false, cleanupError: unknown;
  try {
    await client.start({ slug }); roomCreated = true;
    // `start` returns before the first long poll marks the public room online.
    let room: Awaited<ReturnType<typeof lookupInternetSingerRoom>> | undefined;
    for (let n = 0; n < 30; n++) {
      try { const candidate = await lookupInternetSingerRoom(slug); if (candidate.online) { room = candidate; break; } } catch { /* retry until online */ }
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    if (!room) throw new Error('Synthetic room did not become online.');
    // Browsers add Origin on POST; Node's fetch does not, so model that browser header explicitly.
    const guestFetch: typeof fetch = (input, init) => fetch(input, { ...init, headers: { ...Object.fromEntries(new Headers(init?.headers)), Origin: INTERNET_QUEUE_ORIGIN } });
    const guest = internetGuestTransport(room, { fetch: guestFetch });
    const admission = await guest.admission('');
    const joined = await guest.join('', randomUUID(), randomBytes(32).toString('base64url'), 'Synthetic Guest', admission.revision);
    const snapshot = await guest.snapshot(joined.session);
    assert.equal(snapshot.catalog.length, 50); assert.equal(snapshot.catalogNextOffset, 50);
    assert.ok(!snapshot.catalog.some(song => song.id === 'qa-song-0062'), 'Target must be beyond first page');
    // The omitted query keeps existing clients compatible with the new relay.
    const legacy = await guest.catalog(joined.session, 0, 50);
    assert.equal(legacy.items.length, 50); assert.equal(legacy.nextOffset, 50);
    assert.deepEqual(Object.keys(legacy.items[0]).sort(), ['artist', 'id', 'title']);
    const match = await guest.catalog(joined.session, 0, 50, 'Needle Synthetic 62');
    assert.deepEqual(match.items.map(song => song.id), ['qa-song-0062']);
    const first = await guest.catalog(joined.session, 0, 50, 'Synthetic Shared');
    assert.equal(first.items.length, 50); assert.equal(first.nextOffset, 50);
    const second = await guest.catalog(joined.session, first.nextOffset!, 50, 'Synthetic Shared');
    assert.equal(second.revision, first.revision); assert.equal(second.items.length, 15); assert.equal(second.nextOffset, null);
    assert.equal(new Set([...first.items, ...second.items].map(song => song.id)).size, 65);
    assert.equal((await guest.catalog(joined.session, 0, 50, 'Synthetic Hidden Song')).items.length, 0);
    assert.equal(state.playback, null); assert.equal(state.requests.length, 0);
    if (args[2] === '--screen-test' || args[2] === '--browser-window') {
      await client.startScreen();
      const privateUrl = client.status().screenUrl;
      assert.ok(privateUrl, 'Sharing must produce a private screen URL.');
      const screen = new URL(privateUrl); assert.equal(screen.origin, 'https://booth.thepropervolume.com');
      const secret = screen.hash.slice(1); assert.match(secret, /^[A-Za-z0-9_-]{43}$/);
      const frameUrl = `${screen.origin}${screen.pathname}/frame`, viewer = randomUUID();
      const getFrame = (token?: string) => fetch(frameUrl, { headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'X-TPV-Screen-Viewer': viewer },
        cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(10000) });
      assert.equal((await getFrame()).status, 401);
      const wrong = randomBytes(32).toString('base64url'); assert.equal((await getFrame(wrong)).status, 404);
      let frame: Response | undefined;
      for (let n = 0; n < 12; n++) { const response = await getFrame(secret); if (response.ok) { frame = response; break; } await new Promise(resolve => setTimeout(resolve, 250)); }
      assert.ok(frame, 'Screen did not publish the synthetic frame.');
      assert.equal(frame.headers.get('content-type'), 'image/jpeg'); assert.deepEqual(Buffer.from(await frame.arrayBuffer()), syntheticJpeg);
      await client.stopScreen(); assert.equal((await getFrame(secret)).status, 404);
      console.log('PASS: private synthetic screen capability and stop revocation on booth hostname.');
    }
    if (args[2] === '--browser-window') {
      console.log(`Synthetic room available for browser review: ${INTERNET_QUEUE_ORIGIN}/${slug}`);
      await new Promise(resolve => setTimeout(resolve, 90_000));
    }
    await client.stop(); roomCreated = false;
    await assert.rejects(guest.catalog(joined.session, 0, 50, 'Needle'));
    const lookup = await fetch(`${INTERNET_QUEUE_ORIGIN}/v1/relay/lookup/${slug}`, { redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(10000) });
    if (lookup.ok) assert.equal((await lookup.json() as { online: boolean }).online, false);
    else assert.ok([404, 410].includes(lookup.status));
    console.log('PASS: synthetic live relay catalog search beyond page one, legacy paging, matching-page pagination, hidden source, public projections, and ended-room fencing.');
  } finally {
    // Try cleanup even after partial startup, including lost open acknowledgements.
    try { if (client.needsShutdownWait() || roomCreated) await client.stop(); } catch (error) { cleanupError = error; }
    store.close();
    if (cleanupError) { console.error(`Synthetic room cleanup was not confirmed for ${slug}; check and end that QA room.`); throw cleanupError; }
  }
}
