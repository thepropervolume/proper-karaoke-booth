// Run with: node --import tsx scripts/lrc-vtt-smoke.mjs <synthetic-mp4>
// On a headless Linux host, prefix with xvfb-run -a. Audio is muted.
import { mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { strict as assert } from 'node:assert';
import { parseLrc } from '../src/domain/lrc.ts';
import { exportLrcWebVtt } from '../src/domain/lrc-vtt.ts';

if (!process.argv[2]) throw new Error('Supply a synthetic MP4 fixture at least 8 seconds long.');
const fixture = await realpath(resolve(process.argv[2]));
const size = (await stat(fixture)).size;
if (size < 1 || size > 32 * 1024 * 1024) throw new Error('The synthetic MP4 must be between 1 byte and 32 MiB.');
const requireFromRepo = createRequire(new URL('../package.json', import.meta.url));
const { _electron: electron } = requireFromRepo('playwright-core');
const executablePath = requireFromRepo('electron');
const dir = await mkdtemp(join(tmpdir(), 'tpv-vtt-probe-'));
const bootstrap = join(dir, 'main.cjs');
await writeFile(bootstrap, "const {app,BrowserWindow}=require('electron');app.setPath('userData',process.env.TPV_PROBE_DIR);app.whenReady().then(()=>{let w=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true}});w.loadURL('about:blank');});app.on('window-all-closed',()=>app.quit());\n");
const videoBytes = await readFile(fixture);
const vtt = exportLrcWebVtt(parseLrc('[00:01.001]<script>synthetic & check</script>\n[00:03.500]\n[00:07.000]Next line'), 8000).text;
let app;
try {
  const env = { ...process.env, TPV_PROBE_DIR: dir, XDG_CONFIG_HOME: dir, XDG_DATA_HOME: dir };
  delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({ executablePath, args: [bootstrap, `--user-data-dir=${dir}`, '--mute-audio'], env });
  assert.equal(await realpath(await app.evaluate(({ app }) => app.getPath('userData'))), await realpath(dir), 'Refusing to use a non-disposable profile.');
  const page = await app.firstWindow();
  await page.evaluate(({ media, captions }) => {
    const bytes = Uint8Array.from(atob(media), c => c.charCodeAt(0));
    const video = document.createElement('video'); video.preload = 'auto';
    video.src = URL.createObjectURL(new Blob([bytes], { type: 'video/mp4' }));
    const track = document.createElement('track'); track.kind = 'captions'; track.label = 'Synthetic'; track.srclang = 'en';
    track.src = URL.createObjectURL(new Blob([captions], { type: 'text/vtt' }));
    video.append(track); document.body.append(video); track.track.mode = 'hidden';
  }, { media: videoBytes.toString('base64'), captions: vtt });
  await page.waitForFunction(() => document.querySelector('video')?.readyState >= 1 && document.querySelector('track')?.readyState === 2, null, { timeout: 15000 });
  const duration = await page.evaluate(() => document.querySelector('video').duration);
  assert.ok(Number.isFinite(duration) && duration >= 8, 'The synthetic MP4 must be at least eight seconds long.');
  const seek = async seconds => {
    await page.evaluate(value => { document.querySelector('video').currentTime = value; }, seconds);
    await page.waitForFunction(value => { const video = document.querySelector('video'); return !video.seeking && Math.abs(video.currentTime - value) < .05; }, seconds, { timeout: 10000 });
  };
  await seek(2);
  await page.waitForFunction(() => document.querySelector('track').track.activeCues?.length === 1, null, { timeout: 10000 });
  assert.equal(await page.evaluate(() => document.querySelector('track').track.activeCues[0].getCueAsHTML().textContent), '<script>synthetic & check</script>');
  await seek(4);
  await page.waitForFunction(() => document.querySelector('track').track.activeCues?.length === 0, null, { timeout: 10000 });
  await seek(7.5);
  await page.waitForFunction(() => document.querySelector('track').track.activeCues?.length === 1, null, { timeout: 10000 });
  assert.equal(await page.evaluate(() => document.querySelector('track').track.activeCues[0].getCueAsHTML().textContent), 'Next line');
  console.log('PASS: Electron parsed escaped captions, cleared a gap and selected cues after seeks; audio muted.');
} finally {
  if (app) await app.close().catch(() => {});
  await rm(dir, { recursive: true, force: true });
}
