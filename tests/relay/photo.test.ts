import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MAX_PHOTO_DATA_URL, validPhotoDataUrl } from '../../src/domain/photo';
import { parseGuestRequest } from '../../src/relay/protocol';
import { dispatchInternetGuestCallAsync } from '../../src/main/internet-queue-client';

const secret = 's'.repeat(43);
const command = { commandId: 'command-0001', showId: 'show-00001', hostEpoch: 'epoch-0001', expectedRevision: 3 };
const id = '142bc9d6-36ee-45c1-a932-8eb11fd7619d';

test('photos have a dedicated bounded transport and require an authenticated session', () => {
  const image = 'data:image/jpeg;base64,' + 'a'.repeat(100_000);
  assert.ok(validPhotoDataUrl(image));
  assert.ok(parseGuestRequest('photo', { command: { ...command, dataUrl: image } }, secret));
  assert.equal(parseGuestRequest('photo', { command: { ...command, dataUrl: image } }), null);
  assert.equal(parseGuestRequest('photo', { command: { ...command, dataUrl: 'data:image/svg+xml;base64,PHN2Zz4=' } }, secret), null);
  assert.equal(parseGuestRequest('photo', { command: { ...command, dataUrl: 'data:image/jpeg;base64,' + 'a'.repeat(MAX_PHOTO_DATA_URL) } }, secret), null);
  assert.equal(parseGuestRequest('missing-request', { command: { commandId: command.commandId, title: image, artist: '' } }, secret), null);
});

test('internet dispatcher forwards photo and applause through the matching host authority', async () => {
  const received: string[] = [];
  const authority = {
    applaud: async () => { received.push('applause'); return { ok: true as const, revision: 4 }; },
    submitPhoto: async () => { received.push('photo'); return { ok: true as const, revision: 4 }; },
  } as any;
  for (const operation of ['applause', 'photo']) {
    const result = await dispatchInternetGuestCallAsync(authority, { requestId: id, operation, session: secret,
      payload: { command: operation === 'photo' ? { ...command, dataUrl: 'data:image/jpeg;base64,/9j/2Q==' } : command } }, () => '');
    assert.equal(result.status, 200);
  }
  assert.deepEqual(received, ['applause', 'photo']);
});
