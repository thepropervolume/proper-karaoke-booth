// Isolated Electron regression: a restored, ineligible staged song stays locked.
import { _electron as electron } from 'playwright-core';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, rm, writeFile, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { strict as assert } from 'node:assert';
import electronPath from 'electron';

if (!process.argv[2]) throw new Error('Usage: node scripts/policy-lock-smoke.mjs <synthetic-mp4>');
const fixture = await realpath(resolve(process.argv[2]));
const profile = await mkdtemp(join(tmpdir(), 'tpv-policy-lock-'));
const bootstrap = join(profile, 'bootstrap.cjs');
await writeFile(bootstrap, "const { app } = require('electron'); app.setPath('userData', process.env.TPV_TEST_PROFILE); require(process.env.TPV_TEST_ENTRY);\n");
const launch = async () => {
  const app = await electron.launch({ executablePath: electronPath, args: [bootstrap, `--user-data-dir=${profile}`, '--mute-audio'],
    env: { ...process.env, XDG_CONFIG_HOME: profile, XDG_DATA_HOME: profile, TPV_TEST_PROFILE: profile, TPV_TEST_ENTRY: resolve('dist/main/index.cjs') } });
  assert.equal(await realpath(await app.evaluate(({ app }) => app.getPath('userData'))), await realpath(profile));
  await app.evaluate(({ dialog }, selected) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selected] }); }, fixture);
  return app;
};
let app;
try {
  app = await launch();
  let host = await app.firstWindow();
  await host.waitForFunction(() => !!window.tpv);
  await host.evaluate(() => window.tpv.importFiles('files'));
  let state;
  for (let n = 0; n < 150; n++) {
    state = await host.evaluate(() => window.tpv.getState());
    if (state.versions.length) break;
    await new Promise(r => setTimeout(r, 100));
  }
  assert.equal(state.versions.length, 1, 'synthetic import');
  assert.equal(state.versions[0].rating, 'unrated');
  await host.evaluate(async version => {
    for (const cmd of [ {type: 'addSinger', singer: {id: 's1', name: 'Singer'}},
      {type: 'request', requestId: 'r1', singerId: 's1', versionId: version}, {type: 'stage'} ]) {
      const result = await window.tpv.command(cmd);
      if (!result.ok) throw new Error(result.error);
    }
  }, state.versions[0].id);
  await app.close(); app = undefined;
  // A private fixture simulates a future policy change while preserving a staged row.
  const db = new DatabaseSync(join(profile, 'show.sqlite'));
  const saved = JSON.parse(db.prepare('SELECT value FROM show_state WHERE id = 1').get().value);
  assert.equal(saved.stagedRequestId, 'r1');
  saved.policy.ageRestricted = true;
  db.prepare('UPDATE show_state SET value = ? WHERE id = 1').run(JSON.stringify(saved));
  db.close();
  app = await launch(); host = await app.firstWindow();
  await host.getByText('Staged · locked · unavailable under current policy').waitFor();
  assert.equal(await host.getByRole('button', { name: 'Play/Pause' }).isDisabled(), true);
  assert.equal(await host.getByRole('button', { name: 'Release staged song' }).isEnabled(), true);
  const results = await host.evaluate(async () => ({ viaPlay: await window.tpv.playPause(),
    viaCommand: await window.tpv.command({ type: 'start', generationId: crypto.randomUUID() }), state: await window.tpv.getState() }));
  assert.equal(results.viaPlay.ok, false); assert.match(results.viaPlay.error, /policy/i);
  assert.equal(results.viaCommand.ok, false); assert.match(results.viaCommand.error, /policy/i);
  assert.equal(results.state.stagedRequestId, 'r1'); assert.equal(results.state.playback, null);
  assert.equal(app.windows().length, 1, 'blocked start must not open a singer window');
  await host.getByRole('button', { name: 'Release staged song' }).click();
  let released = false;
  for (let n = 0; n < 100; n++) {
    released = (await host.evaluate(() => window.tpv.getState())).stagedRequestId === null;
    if (released) break;
    await new Promise(r => setTimeout(r, 100));
  }
  assert.equal(released, true, 'explicit release must clear the staged lock');
  await app.close(); app = undefined;
  // A second isolated restore exercises the missing YouTube-media preparation path.
  const youtubeDb = new DatabaseSync(join(profile, 'show.sqlite'));
  saved.versions[0].source = { provider: 'youtube', videoId: 'abcdefghijk' };
  youtubeDb.prepare('UPDATE show_state SET value = ? WHERE id = 1').run(JSON.stringify(saved));
  youtubeDb.prepare('DELETE FROM media WHERE id = ?').run(saved.versions[0].id);
  youtubeDb.close();
  app = await launch(); host = await app.firstWindow();
  await host.getByText('Staged · locked · unavailable under current policy').waitFor();
  const youtube = await host.evaluate(async () => ({
    result: await window.tpv.command({type:'start', generationId:crypto.randomUUID()}),
    status: await window.tpv.youtubeDownloads.status(), state: await window.tpv.getState()
  }));
  assert.equal(youtube.result.ok, false); assert.match(youtube.result.error, /policy/i);
  assert.equal(youtube.status.job, null, 'restricted Start must not dispatch a video download');
  assert.deepEqual(youtube.status.queue.pendingVersionIds, []);
  assert.equal(youtube.state.stagedRequestId, 'r1');
  console.log('PASS: restricted staged local and YouTube tracks remain locked; Play and direct Start reject before display or download preparation; explicit release works.');
} finally {
  if (app) await app.close().catch(() => {});
  await rm(profile, { recursive: true, force: true });
}
