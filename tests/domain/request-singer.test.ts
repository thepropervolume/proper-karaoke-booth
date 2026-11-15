import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { requestWithSinger } from '../../src/renderer/request-singer';

test('a rejected request keeps the newly created singer available for a retry', async () => {
  const singers: { id: string; name: string }[] = [];
  const requests: (string | null)[] = [];
  let selected = '', fail = true;
  const callbacks = {
    createSingerId: () => 'new-singer',
    addSinger: async (singer: { id: string; name: string }) => { singers.push(singer); return { ok: true }; },
    singerCreated: (id: string) => { selected = id; },
    addRequest: async (id: string | null) => { requests.push(id); return fail ? { ok: false, error: 'Song unavailable' } : { ok: true }; },
  };
  await assert.rejects(requestWithSinger({ newSingerName: 'Ben' }, callbacks), /Song unavailable/);
  assert.equal(selected, 'new-singer');
  assert.deepEqual(singers, [{ id: 'new-singer', name: 'Ben' }]);
  fail = false;
  await requestWithSinger({ singerId: selected }, callbacks);
  assert.equal(singers.length, 1, 'Retry must not create a duplicate singer');
  assert.deepEqual(requests, ['new-singer', 'new-singer']);
});

test('a singer creation failure does not select a singer or send a request', async () => {
  let selected = false, requests = 0;
  await assert.rejects(requestWithSinger({ newSingerName: 'Ben' }, {
    createSingerId: () => 'new-singer',
    addSinger: async () => ({ ok: false, error: 'Storage failed' }),
    singerCreated: () => { selected = true; },
    addRequest: async () => { requests++; return { ok: true }; },
  }), /Storage failed/);
  assert.equal(selected, false);
  assert.equal(requests, 0);
});

test('an existing singer does not trigger singer creation', async () => {
  let creations = 0, selected = false, requested: string | null = '';
  await requestWithSinger({ singerId: 'existing' }, {
    createSingerId: () => { creations++; return 'new'; },
    addSinger: async () => { creations++; return { ok: true }; },
    singerCreated: () => { selected = true; },
    addRequest: async id => { requested = id; return { ok: true }; },
  });
  assert.equal(creations, 0);
  assert.equal(selected, false);
  assert.equal(requested, 'existing');
});

test('an unassigned request commits null without creating or selecting a singer', async () => {
  let requested: string | null | undefined;
  await requestWithSinger({ singerId: null }, {
    createSingerId: () => { throw new Error('Must not create a placeholder singer'); },
    addSinger: async () => { throw new Error('Must not add a placeholder singer'); },
    singerCreated: () => { throw new Error('Must not select a placeholder singer'); },
    addRequest: async id => { requested = id; return { ok: true }; },
  });
  assert.equal(requested, null);
});
