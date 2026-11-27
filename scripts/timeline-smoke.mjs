// Isolated, muted synthetic media test. Run after building: node scripts/timeline-smoke.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
const repo = await realpath(resolve('.'));
const require = createRequire(join(repo, 'package.json'));
const { _electron: electron } = require('playwright-core');
const tempRoot = await realpath(tmpdir()), temp = await mkdtemp(join(tempRoot, 'tpv-timeline-qa-'));
const profile = join(temp, 'profile'); await mkdir(profile);
await writeFile(join(profile, 'settings.json'), JSON.stringify({ librarySourceFilters: ['local'] }));
const canonicalProfile = await realpath(profile), fixture = join(temp, 'Synthetic Artist - Timeline.mp4');
const bootstrap = join(temp, 'bootstrap.cjs');
await writeFile(bootstrap, `const { app } = require('electron'); const fs = require('node:fs'); app.setPath('userData', process.env.TPV_QA_PROFILE); if (fs.realpathSync(app.getPath('userData')) !== fs.realpathSync(process.env.TPV_QA_PROFILE)) throw Error('Unsafe profile'); require(process.env.TPV_QA_ENTRY);`);
const env = { ...process.env, TPV_QA_PROFILE: canonicalProfile, TPV_QA_ENTRY: await realpath(join(repo, 'dist/main/index.cjs')), APPDATA: join(temp, 'appdata'), LOCALAPPDATA: join(temp, 'localappdata'), XDG_CONFIG_HOME: join(temp, 'xdg-config'), XDG_DATA_HOME: join(temp, 'xdg-data') };
delete env.ELECTRON_RUN_AS_NODE;
const args = [bootstrap, `--user-data-dir=${canonicalProfile}`, '--mute-audio'];
if (process.env.TPV_TEST_NO_SANDBOX === '1') args.push('--no-sandbox');
let app;
const launch = async () => {
  app = await electron.launch({ executablePath: require('electron'), args, env, cwd: repo, timeout: 30000 });
  assert.equal(await realpath(await app.evaluate(({ app }) => app.getPath('userData'))), canonicalProfile);
  await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false }); });
  return app.firstWindow();
};
try {
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=navy:s=320x180:r=10:d=60', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=60', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart', fixture], { stdio: 'pipe' });
  let host = await launch();
  await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }); }, fixture);
  await host.evaluate(() => window.tpv.importFiles('files'));
  await host.getByRole('listbox', { name: 'Songs' }).getByRole('option').first().waitFor();
  await host.evaluate(async () => {
    const version = (await window.tpv.getState()).versions[0];
    for (const command of [{ type: 'addSinger', singer: { id: 'timeline-singer', name: 'Timeline Singer' } }, { type: 'request', requestId: 'timeline-request', singerId: 'timeline-singer', versionId: version.id }, { type: 'stage' }]) {
      const result = await window.tpv.command(command); if (!result.ok) throw Error(result.error);
    }
  });
  const initialDisplay = app.waitForEvent('window');
  await host.evaluate(() => window.tpv.openDisplay());
  let display = await initialDisplay;
  await display.locator('video').waitFor({ state: 'attached' });
  assert.equal((await host.evaluate(() => window.tpv.command({ type: 'start', generationId: crypto.randomUUID() }))).ok, true);
  await display.waitForFunction(() => { const video = document.querySelector('video'); return video && !video.paused && video.currentTime > .1; });
  const playingGeneration = (await host.evaluate(() => window.tpv.getState())).playback.generationId;
  assert.equal((await host.evaluate(input => window.tpv.seek(input), { generation: playingGeneration, position: 8 })).ok, true);
  assert.equal(await display.locator('video').evaluate(video => video.paused), false, 'Seek must preserve playing state');
  assert.equal((await host.evaluate(() => window.tpv.command({ type: 'pause' }))).ok, true);
  await display.waitForFunction(() => document.querySelector('video').paused);
  const generation = (await host.evaluate(() => window.tpv.getState())).playback.generationId;
  assert.equal((await host.evaluate(input => window.tpv.seek(input), { generation, position: 24 })).ok, true);
  await display.waitForFunction(() => Math.abs(document.querySelector('video').currentTime - 24) < .3);
  assert.equal(await display.locator('video').evaluate(video => video.paused), true, 'Seek must not start a paused track');
  await host.getByRole('button', { name: 'Forward 10 seconds', exact: true }).click();
  await display.waitForFunction(() => Math.abs(document.querySelector('video').currentTime - 34) < .3);
  await host.getByRole('button', { name: 'Rewind 10 seconds', exact: true }).click();
  await display.waitForFunction(() => Math.abs(document.querySelector('video').currentTime - 24) < .3);
  const slider = host.getByRole('slider', { name: 'Playback position', exact: true });
  const box = await slider.boundingBox();
  await host.mouse.move(box.x + box.width * .4, box.y + box.height / 2);
  await host.mouse.down(); await host.mouse.move(box.x + box.width * .7, box.y + box.height / 2); await host.mouse.up();
  await display.waitForFunction(() => { const video = document.querySelector('video'); return video.currentTime > 40 && video.currentTime < 44 && video.paused; });
  let acknowledged;
  for (let attempt = 0; attempt < 100; attempt++) {
    acknowledged = await host.evaluate(() => window.tpv.getTimeline());
    if (!acknowledged.seeking && acknowledged.position > 40 && acknowledged.position < 44) break;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.ok(!acknowledged.seeking && acknowledged.position > 40 && acknowledged.position < 44, 'Drag seek must be acknowledged and checkpointed.');
  const savedPosition = acknowledged.position;
  assert.equal((await host.evaluate(input => window.tpv.seek(input), { generation: 'stale', position: 10 })).ok, false);
  await app.close(); app = undefined;
  host = await launch();
  await host.waitForFunction(() => !!window.tpv);
  assert.equal((await host.evaluate(() => window.tpv.getState())).playback?.status, 'paused');
  const restoredDisplay = app.waitForEvent('window');
  await host.evaluate(() => window.tpv.openDisplay());
  display = await restoredDisplay;
  await display.waitForFunction(position => { const video = document.querySelector('video'); return video?.paused && Math.abs(video.currentTime - position) < .3; }, savedPosition);
  assert.equal((await host.evaluate(() => window.tpv.getState())).requests[0].status, 'playing');
  await host.getByRole('button', { name: 'Stop', exact: true }).click();
  assert.equal(await host.getByRole('slider', { name: 'Playback position', exact: true }).isDisabled(), true);
  console.log('Timeline drag, forward/rewind, paused seeking, generation rejection and restart position passed with isolated muted synthetic media.');
} finally {
  if (app) await app.close();
  if (temp.startsWith(tempRoot + sep) && await realpath(temp) === temp) await rm(temp, { recursive: true, force: true });
}
