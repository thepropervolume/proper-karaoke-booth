// Real source-build capture, preview IPC and LAN browsers. Every window belongs
// to a new, muted disposable show. Only generated silent media is imported;
// no user song, account or real show is opened.
// Requires FFmpeg on PATH. Run after npm run build:
// node scripts/singer-screen-smoke.mjs
// Optional: --screenshots DIR --rating-profile PRIVATE_JSON
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, lstat, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { createServer, createConnection } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { waitForHostCondition } from './wait-for-host-condition.mjs';

const repo = await realpath(resolve(dirname(fileURLToPath(import.meta.url)), '..'));
const require = createRequire(join(repo, 'package.json')), { _electron: electron } = require('playwright-core');
let screenshots = null, ratingProfile = null;
for (let i = 2; i < process.argv.length; ++i) {
  const option = process.argv[i];
  if (!['--screenshots', '--rating-profile'].includes(option) || !process.argv[i + 1])
    throw new Error('Usage: node scripts/singer-screen-smoke.mjs [--screenshots DIR] [--rating-profile PRIVATE_JSON]');
  if (option === '--screenshots') screenshots = resolve(process.argv[++i]); else ratingProfile = resolve(process.argv[++i]);
}
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
let ratingOrigin = '', ratingHash = '';
if (ratingProfile) {
  const information = await lstat(ratingProfile);
  assert.ok(information.isFile() && !information.isSymbolicLink() && information.size <= 32 * 1024, 'Select a regular private rating profile.');
  const bytes = await readFile(ratingProfile); ratingHash = sha(bytes);
  let origin;
  try { origin = new URL(JSON.parse(bytes.toString('utf8')).baseUrl); }
  catch { throw new Error('The optional private rating profile is invalid.'); }
  assert.ok(origin.protocol === 'https:' && !origin.username && !origin.password && !origin.port && origin.pathname === '/' && !origin.search && !origin.hash,
    'The optional rating profile must name a plain HTTPS service origin.');
  ratingOrigin = origin.origin; // Only this optional empty-key lookup can leave loopback.
}
const parent = await realpath(tmpdir()), temporary = await mkdtemp(join(parent, 'tpv-singer-screen-qa-'));
const profile = join(temporary, 'profile'); await mkdir(profile);
const fixture = join(temporary, 'Synthetic Screen Artist - Compositor Check.mp4');
const fixtureColor = [176, 176, 176], pixelTolerance = 15;
const canonicalProfile = await realpath(profile), entry = await realpath(join(repo, 'dist/main/index.cjs'));
const metadata = JSON.parse(await readFile(join(repo, 'package.json'), 'utf8'));
await writeFile(join(profile, 'settings.json'), JSON.stringify({ sharedCatalogEnabled: false, providerCatalogEnabled: false,
  youtubeSearchEnabled: false, singerDisplayFullscreen: false, singerScreenEnabled: false, hostPreviewPosition: 'above', autoBumper: false }));
const bootstrap = join(temporary, 'bootstrap.cjs');
await writeFile(bootstrap, `const {app,dialog,screen}=require('electron');const fs=require('node:fs');
app.setPath('userData',process.env.TPV_SCREEN_QA_PROFILE);app.setAppPath(process.env.TPV_SCREEN_QA_REPO);
if(fs.realpathSync(app.getPath('userData'))!==fs.realpathSync(process.env.TPV_SCREEN_QA_PROFILE))throw Error('Unsafe QA profile');
app.getVersion=()=>JSON.parse(fs.readFileSync(require('node:path').join(process.env.TPV_SCREEN_QA_REPO,'package.json'),'utf8')).version;
globalThis.singerScreenQa={blockedFetches:0,ratingLookups:0,dialogs:[],allowFixtureImport:false,fixtureImports:0};const nativeFetch=globalThis.fetch;
globalThis.fetch=async(input,options)=>{const url=new URL(typeof input==='string'?input:input.url||String(input));
if(url.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(url.hostname))return nativeFetch(input,options);
let empty=false;try{empty=Array.isArray(JSON.parse(options?.body||'null')?.recordingKeys)&&JSON.parse(options.body).recordingKeys.length===0;}catch{}
if(process.env.TPV_SCREEN_QA_RATING_ORIGIN&&url.origin===process.env.TPV_SCREEN_QA_RATING_ORIGIN&&url.pathname==='/v1/ratings/lookup'&&options?.method==='POST'&&empty){singerScreenQa.ratingLookups++;return nativeFetch(input,options);}
singerScreenQa.blockedFetches++;throw Error('External network disabled in singer-screen rehearsal');};
dialog.showMessageBox=async(first,second)=>{const options=second||first;singerScreenQa.dialogs.push(options?.title||'');
if(options?.title==='Choose singer display'){const primary=(options.buttons||[]).findIndex(label=>label.startsWith('Primary'));return {response:primary,checkboxChecked:false};}
return {response:options?.cancelId??Math.max(0,(options?.buttons?.length||1)-1),checkboxChecked:false};};
dialog.showOpenDialog=async(first,second)=>{const options=second||first;
if(singerScreenQa.allowFixtureImport&&options?.title==='Import local MP4 files'&&options.properties?.includes('openFile')&&!options.properties.includes('openDirectory')&&options.filters?.some(filter=>filter.extensions?.includes('mp4'))){singerScreenQa.allowFixtureImport=false;singerScreenQa.fixtureImports++;return{canceled:false,filePaths:[process.env.TPV_SCREEN_QA_FIXTURE]};}
return{canceled:true,filePaths:[]};};dialog.showSaveDialog=async()=>({canceled:true});
require(process.env.TPV_SCREEN_QA_ENTRY);`);
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('TPV_') && key !== 'ELECTRON_RUN_AS_NODE'));
Object.assign(env, { TPV_SCREEN_QA_PROFILE: canonicalProfile, TPV_SCREEN_QA_REPO: repo, TPV_SCREEN_QA_ENTRY: entry,
  TPV_SCREEN_QA_FIXTURE: fixture,
  TPV_SCREEN_QA_RATING_ORIGIN: ratingOrigin, APPDATA: join(temporary, 'appdata'), LOCALAPPDATA: join(temporary, 'localappdata'),
  XDG_CONFIG_HOME: join(temporary, 'config'), XDG_DATA_HOME: join(temporary, 'data') });
const args = [bootstrap, `--user-data-dir=${canonicalProfile}`, '--mute-audio', '--disable-background-networking', '--disable-component-update'];
if (process.env.TPV_TEST_NO_SANDBOX === '1') args.push('--no-sandbox');
let app, host; const viewerPages = [], viewerIds = [], pageErrors = [];
const availablePort = async () => {
  const socket = createServer(); await new Promise((resolve, reject) => { socket.once('error', reject); socket.listen(0, '127.0.0.1', resolve); });
  const address = socket.address(); assert.ok(address && typeof address === 'object');
  await new Promise(resolve => socket.close(resolve)); assert.ok(address.port >= 1024); return address.port;
};
const portClosed = port => new Promise(resolve => {
  const socket = createConnection({ host: '127.0.0.1', port });
  socket.setTimeout(1500); socket.once('connect', () => { socket.destroy(); resolve(false); });
  socket.once('error', error => { socket.destroy(); resolve(error.code === 'ECONNREFUSED'); });
  socket.once('timeout', () => { socket.destroy(); resolve(false); });
});
const wait = async (predicate, timeout = 15_000) => {
  const deadline = performance.now() + timeout;
  while (performance.now() < deadline) { if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 50)); }
  throw new Error('Singer-screen condition timed out.');
};
const status = () => host.evaluate(() => window.tpv.singerScreens.status());
const waitViewers = count => waitForHostCondition(host, async count => (await window.tpv.singerScreens.status()).viewers === count, count);
const readyImage = async page => {
  try { await page.waitForFunction(() => { const image = document.getElementById('screen'); return image?.naturalWidth > 1 && image.naturalHeight > 1 && document.getElementById('waiting')?.hidden === true; }, undefined, { timeout: 15_000 }); }
  catch (error) {
    console.error('Singer browser image diagnostic:', JSON.stringify(await page.evaluate(async () => {
      const image = document.getElementById('screen'); let server;
      try { const response = await fetch('/status', { cache: 'no-store' }); server = { status: response.status, body: await response.json() }; } catch { server = { unavailable: true }; }
      return { visibility: document.visibilityState, ready: document.readyState, width: image?.naturalWidth, height: image?.naturalHeight,
        complete: image?.complete, source: image?.getAttribute('src'), waitingHidden: document.getElementById('waiting')?.hidden, server };
    })));
    throw error;
  }
};
const openSinger = async () => {
  const created = app.waitForEvent('window'); await host.evaluate(() => window.tpv.openDisplay());
  const page = await created; await page.waitForURL(/\/display\/index\.html/);
  await app.evaluate(({ BrowserWindow, screen }) => {
    const window = BrowserWindow.getAllWindows().find(window => /\/display\/index\.html/.test(window.webContents.getURL()));
    if (!window) throw new Error('Private singer display was not created.');
    const area = screen.getPrimaryDisplay().workArea;
    window.setFullScreen(false); window.setBounds({ x: area.x + 12, y: area.y + 12, width: 640, height: 360 }); window.hide();
  });
  try { await waitForHostCondition(host, async () => (await window.tpv.singerScreens.preview()) !== null, undefined, { timeout: 4000 }); }
  catch {
    // Some window managers cannot capture hidden windows. Show only a small
    // inactive window on the primary display, never an external output.
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => /\/display\/index\.html/.test(window.webContents.getURL()))?.showInactive());
    await waitForHostCondition(host, async () => (await window.tpv.singerScreens.preview()) !== null);
  }
  return page;
};
const newViewer = async origin => {
  const created = app.waitForEvent('window');
  const id = await app.evaluate(({ BrowserWindow }, input) => {
    const viewer = new BrowserWindow({ title: 'Private singer-screen QA viewer', show: false, width: 800, height: 500,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true,
        backgroundThrottling: false, partition: input.partition } });
    viewer.webContents.setAudioMuted(true); void viewer.loadURL(input.origin).catch(() => {}); return viewer.id;
  }, { origin, partition: `tpv-singer-screen-qa-${Date.now()}-${viewerIds.length}` });
  viewerIds.push(id); const page = await created; viewerPages.push(page);
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.waitForURL(origin + '/', { waitUntil: 'domcontentloaded' }); await readyImage(page); return page;
};
const previewPixel = () => host.evaluate(async () => {
  const frame = await window.tpv.singerScreens.preview(); if (!frame) return null;
  const image = new Image(); image.src = frame.image; await image.decode();
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.drawImage(image, Math.floor(image.naturalWidth / 2), Math.floor(image.naturalHeight / 2), 1, 1, 0, 0, 1, 1);
  return [...context.getImageData(0, 0, 1, 1).data];
});
const viewerPixel = page => page.evaluate(() => {
  const image = document.getElementById('screen'); if (!(image?.naturalWidth > 1)) return null;
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.drawImage(image, Math.floor(image.naturalWidth / 2), Math.floor(image.naturalHeight / 2), 1, 1, 0, 0, 1, 1);
  return [...context.getImageData(0, 0, 1, 1).data];
});
const isFixturePixel = pixel => Array.isArray(pixel) && pixel.length === 4 && pixel[3] === 255
  && fixtureColor.every((component, index) => Math.abs(pixel[index] - component) <= pixelTolerance);
const waitFixturePixel = async (label, sample, expected) => {
  let pixel;
  try { await wait(async () => { pixel = await sample(); return !!pixel && isFixturePixel(pixel) === expected; }); }
  catch (error) { console.error(`${label} compositor pixel diagnostic:`, JSON.stringify({ pixel, expected: expected ? fixtureColor : 'idle frame', pixelTolerance })); throw error; }
  assert.equal(isFixturePixel(pixel), expected, `${label} must show ${expected ? 'the synthetic video frame' : 'the idle display after Stop'}.`);
  return pixel;
};
const captureViewer = async (id, path) => {
  // capturePage supports hidden native windows; Page.screenshot may wait for
  // a visible compositor indefinitely even though its image has decoded.
  const captured = await app.evaluate(async ({ BrowserWindow }, id) => {
    const window = BrowserWindow.fromId(id); if (!window) throw new Error('Private viewer was closed.');
    const image = await window.webContents.capturePage(); if (image.isEmpty()) throw new Error('Private browser capture is empty.');
    return { png: image.toPNG().toString('base64'), ...image.getSize() };
  }, id);
  assert.ok(captured.width > 1 && captured.height > 1);
  await writeFile(path, Buffer.from(captured.png, 'base64'));
};
try {
  // A neutral solid color cannot be confused with the dark idle screen. The local
  // file and its silent audio track are generated only inside this QA folder.
  // Explicit BT.709 conversion/tags avoid platform-dependent guesses for an
  // otherwise unspecified YUV matrix; the JPEG tolerance stays intentionally tight.
  // Neutral gray also avoids saturated-color shifts in monitor color profiles.
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=0xb0b0b0:s=320x180:r=10:d=45',
    '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo', '-t', '45', '-c:v', 'libx264', '-preset', 'ultrafast',
    '-vf', 'scale=out_color_matrix=bt709', '-pix_fmt', 'yuv420p', '-colorspace', 'bt709', '-color_primaries', 'bt709',
    '-color_trc', 'bt709', '-color_range', 'tv', '-c:a', 'aac', '-movflags', '+faststart', fixture],
    { windowsHide: true, stdio: 'pipe', timeout: 30_000, maxBuffer: 1024 * 1024 });
  app = await electron.launch({ executablePath: require('electron'), args, env, cwd: temporary, timeout: 30_000 });
  const identity = await app.evaluate(({ app }) => ({ profile: app.getPath('userData'), version: app.getVersion(), packaged: app.isPackaged }));
  assert.equal(await realpath(identity.profile), canonicalProfile, 'Refusing to exercise a real show profile.');
  assert.equal(identity.version, metadata.version); assert.equal(identity.packaged, false);
  host = await app.firstWindow(); host.on('pageerror', error => pageErrors.push(error.message)); await host.waitForFunction(() => !!window.tpv?.singerScreens);
  const initial = await host.evaluate(() => window.tpv.getState()); assert.equal(initial.playback, null); assert.equal(initial.versions.length, 0);
  assert.equal((await status()).status, 'stopped'); assert.equal(await host.evaluate(() => window.tpv.singerScreens.preview()), null);
  await host.evaluate(() => { window.__singerScreenQa = { frames: 0, clears: 0 }; window.__singerScreenQa.off = window.tpv.singerScreens.onPreview(frame => { if (frame) window.__singerScreenQa.frames++; else window.__singerScreenQa.clears++; }); });
  let singer = await openSinger();
  const frame = await host.evaluate(() => window.tpv.singerScreens.preview());
  assert.ok(frame?.image?.startsWith('data:image/jpeg;base64,')); assert.ok(frame.width > 1 && frame.width <= 1600 && frame.height > 1 && frame.height <= 1000);
  const jpeg = Buffer.from(frame.image.split(',')[1], 'base64'); assert.equal(jpeg.readUInt16BE(0), 0xffd8); assert.equal(jpeg.readUInt16BE(jpeg.length - 2), 0xffd9);
  const decoded = await app.evaluate(({ nativeImage }, data) => nativeImage.createFromDataURL(data).getSize(), frame.image);
  assert.deepEqual(decoded, { width: frame.width, height: frame.height });
  await host.getByRole('img', { name: 'Live singer display preview', exact: true }).waitFor();
  const firstPort = await availablePort(), firstOrigin = `http://127.0.0.1:${firstPort}`;
  await host.evaluate(port => window.tpv.saveSettings({ singerScreenPort: port, singerScreenEnabled: true }), firstPort);
  const started = await status(); assert.equal(started.status, 'running'); assert.equal(started.port, firstPort); assert.equal(started.maximumViewers, 64);
  assert.ok(started.urls.length > 0 && started.urls.every(value => { const url = new URL(value); return url.protocol === 'http:' && Number(url.port) === firstPort; }));
  const viewers = [await newViewer(firstOrigin), await newViewer(firstOrigin)]; await waitViewers(2);
  for (const page of viewers) {
    const projection = await page.evaluate(() => ({ controls: document.querySelectorAll('video,audio,iframe,form,input,button').length,
      bridge: typeof window.tpv, require: typeof window.require, process: typeof window.process, html: document.documentElement.outerHTML,
      width: document.getElementById('screen').naturalWidth, height: document.getElementById('screen').naturalHeight }));
    assert.equal(projection.controls, 0); assert.equal(projection.bridge, 'undefined'); assert.equal(projection.require, 'undefined'); assert.equal(projection.process, 'undefined');
    assert.ok(projection.width > 1 && projection.height > 1); assert.ok(!projection.html.includes(canonicalProfile));
    assert.doesNotMatch(projection.html, /providerCatalogProfiles|show\.sqlite|keybindings|account.?email|private.?notes/i);
  }
  await viewers[0].reload({ waitUntil: 'domcontentloaded' }); await readyImage(viewers[0]); await waitViewers(2);
  assert.equal(isFixturePixel(await previewPixel()), false, 'The idle preview must differ from the synthetic video.');
  for (const page of viewers) assert.equal(isFixturePixel(await viewerPixel(page)), false, 'The idle browser must differ from the synthetic video.');
  await app.evaluate(() => { globalThis.singerScreenQa.allowFixtureImport = true; });
  await host.evaluate(() => window.tpv.importFiles('files'));
  await waitForHostCondition(host, async () => (await window.tpv.imports.status())?.phase === 'completed');
  const imported = await host.evaluate(() => window.tpv.getState()); assert.equal(imported.versions.length, 1);
  const importStatus = await host.evaluate(() => window.tpv.imports.status()); assert.equal(importStatus.imported, 1); assert.equal(importStatus.failed, 0);
  await host.evaluate(async versionId => {
    for (const command of [{ type: 'addSinger', singer: { id: 'screen-qa-singer', name: 'Synthetic Screen Singer' } },
      { type: 'request', requestId: 'screen-qa-request', singerId: 'screen-qa-singer', versionId }]) {
      const result = await window.tpv.command(command); if (!result.ok) throw new Error(result.error);
    }
  }, imported.versions[0].id);
  const played = await host.evaluate(() => window.tpv.playPause()); assert.equal(played.ok, true, played.error);
  await waitForHostCondition(host, async () => (await window.tpv.getState()).playback?.status === 'playing');
  await singer.waitForFunction(() => { const video = document.querySelector('#video'); return video?.readyState >= 2 && !video.paused
    && video.currentTime > .1 && video.videoWidth === 320 && video.videoHeight === 180 && !document.body.classList.contains('idle'); });
  const playbackPixels = [await waitFixturePixel('Host preview', previewPixel, true)];
  for (const [index, page] of viewers.entries()) playbackPixels.push(await waitFixturePixel(`LAN viewer ${index + 1}`, () => viewerPixel(page), true));
  assert.equal((await host.evaluate(() => window.tpv.getState())).playback?.requestId, 'screen-qa-request');
  if (screenshots) {
    await mkdir(screenshots, { recursive: true });
    await host.screenshot({ path: join(screenshots, 'host-video-playing.png') });
    await captureViewer(viewerIds[0], join(screenshots, 'lan-video-playing.png'));
    const videoFrame = await host.evaluate(() => window.tpv.singerScreens.preview());
    await writeFile(join(screenshots, 'captured-video-frame.jpg'), Buffer.from(videoFrame.image.split(',')[1], 'base64'));
  }
  const stopped = await host.evaluate(() => window.tpv.command({ type: 'stop' })); assert.equal(stopped.ok, true, stopped.error);
  await waitForHostCondition(host, async () => (await window.tpv.getState()).playback === null);
  await singer.waitForFunction(() => document.body.classList.contains('idle') && !document.querySelector('#video')?.getAttribute('src')
    && !document.getElementById('waiting')?.hidden);
  await waitFixturePixel('Stopped host preview', previewPixel, false);
  for (const [index, page] of viewers.entries()) await waitFixturePixel(`Stopped LAN viewer ${index + 1}`, () => viewerPixel(page), false);
  console.log('Actual video compositor pixels:', JSON.stringify({ expected: fixtureColor, host: playbackPixels[0], viewers: playbackPixels.slice(1), pixelTolerance }));
  const closed = singer.waitForEvent('close'); await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => /\/display\/index\.html/.test(window.webContents.getURL()))?.close()); await closed;
  await waitForHostCondition(host, async () => (await window.tpv.singerScreens.preview()) === null && window.__singerScreenQa.clears > 0);
  await wait(async () => (await (await fetch(firstOrigin + '/status')).json()).frameAvailable === false);
  for (const page of viewers) await page.waitForFunction(() => { const image = document.getElementById('screen'); return !document.getElementById('waiting')?.hidden && image?.naturalWidth === 1 && image.naturalHeight === 1; });
  singer = await openSinger(); for (const page of viewers) await readyImage(page);
  await host.evaluate(() => window.tpv.saveSettings({ singerScreenEnabled: false })); assert.equal((await status()).status, 'stopped'); await wait(() => portClosed(firstPort));
  await host.evaluate(port => window.tpv.saveSettings({ singerScreenEnabled: true, singerScreenPort: port }), firstPort);
  for (const page of viewers) await readyImage(page); await waitViewers(2);
  const secondPort = await availablePort(); assert.notEqual(secondPort, firstPort); const secondOrigin = `http://127.0.0.1:${secondPort}`;
  await host.evaluate(port => window.tpv.saveSettings({ singerScreenPort: port }), secondPort);
  assert.equal((await status()).port, secondPort); await wait(() => portClosed(firstPort));
  for (const page of viewers) { await page.goto(secondOrigin, { waitUntil: 'domcontentloaded' }); await readyImage(page); }
  await waitViewers(2);
  if (screenshots) {
    await mkdir(screenshots, { recursive: true }); await host.screenshot({ path: join(screenshots, 'host-live-preview.png') });
    await captureViewer(viewerIds[0], join(screenshots, 'lan-singer-browser.png'));
  }
  if (ratingProfile) {
    const rating = await host.evaluate(path => window.tpv.ratingProfileStatus(path), ratingProfile);
    assert.equal(rating.status, 'ready'); assert.equal(rating.canVote, true); assert.deepEqual(rating.items, []);
    assert.equal(sha(await readFile(ratingProfile)), ratingHash, 'The optional private rating profile must remain unchanged.');
  }
  await host.evaluate(() => window.tpv.saveSettings({ singerScreenEnabled: false })); assert.equal((await status()).viewers, 0); await wait(() => portClosed(secondPort));
  const final = await host.evaluate(() => window.tpv.getState()); assert.equal(final.playback, null); assert.equal(final.versions.length, 1); assert.equal(final.singers.length, 1);
  assert.equal(final.requests.length, 1); assert.equal(final.requests[0].id, 'screen-qa-request'); assert.equal(final.requests[0].status, 'accepted');
  const audit = await app.evaluate(() => ({ ...globalThis.singerScreenQa })); assert.equal(audit.ratingLookups, ratingProfile ? 1 : 0);
  assert.equal(audit.fixtureImports, 1); assert.equal(audit.allowFixtureImport, false);
  assert.ok((await host.evaluate(() => window.__singerScreenQa.frames)) > 0); assert.deepEqual(pageErrors, []);
  console.log(`PASS: ${metadata.version} actual singer-window video/JPEG compositor pixels and preview events, two isolated visual-only browser decoders, Stop-to-idle, frame clearing, reconnect, port migration and cleanup. Only one generated silent video, synthetic singer and stopped/requeued request were created in the disposable show. Optional global rating lookup: ${ratingProfile ? 'ready with voting permission; no vote sent' : 'not requested'}.`);
} finally {
  if (app) {
    try { if (host && !host.isClosed()) await host.evaluate(async () => { window.__singerScreenQa?.off?.(); await window.tpv.saveSettings({ singerScreenEnabled: false }); }); } catch {}
    await app.close();
  }
  const actual = await realpath(temporary);
  if (dirname(actual) !== parent || !actual.startsWith(parent + sep) || !basename(actual).startsWith('tpv-singer-screen-qa-')) throw new Error('Unsafe singer-screen QA cleanup path.');
  await rm(actual, { recursive: true, force: true });
}
