import { waitForHostWindow } from './wait-for-host-window.mjs';
// Synthetic provider and generated audio only. The test-only bundler replaces
// browser authentication; production has no injection hook or test credential.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, realpath, writeFile, readFile, cp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve, basename } from 'node:path';
import { waitForHostCondition } from './wait-for-host-condition.mjs';
const repo = await realpath(resolve(process.argv[2] ?? '.')), require = createRequire(join(repo, 'package.json'));
const { build } = require('esbuild'), { _electron: electron } = require('playwright-core');
const root = await realpath(tmpdir()), dir = await mkdtemp(join(root, 'tpv-karafun-native-qa-'));
const profile = join(dir, 'profile'), stage = join(dir, 'app');
await mkdir(profile); await mkdir(join(stage, 'main'), { recursive: true });
const canonicalProfile = await realpath(profile);
function kit(parts) {
  const data = Buffer.alloc(4 + parts.length * 5 + parts.reduce((sum, [, bytes]) => sum + 9 + bytes.length, 0));
  data.set([1, 0xce, 0xd7, parts.length]); let at = 4;
  for (const [id, bytes] of parts) { data[at] = id; data.writeUInt32BE(bytes.length, at + 1); at += 5; }
  for (const [id, bytes] of parts) { data[at] = id; data.writeUInt32BE(bytes.length, at + 1); bytes.copy(data, at + 9); at += 9 + bytes.length; }
  return data;
}
let app, qaHost;
try {
  const ogg = join(dir, 'synthetic.ogg');
  const made = spawnSync('ffmpeg', ['-hide_banner', '-nostdin', '-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=330:duration=45', '-ar', '24000', '-ac', '1', '-c:a', 'libvorbis', ogg], { windowsHide: true });
  assert.equal(made.status, 0, 'Synthetic audio needs FFmpeg.');
  const xml = Buffer.from('<root><files><file index="7" label="ins.ogg"/><file index="8" label="bv_High.ogg"/><file index="9" label="bv_Low.ogg"/><file index="10" label="ld_Alice.ogg"/><file index="11" label="ld_Bob.ogg"/></files><karaoke duration="45"><page fadeinstart="00:00:00,000" fadeoutstart="00:00:44,000" fadeoutduration="00:00:01,000"><line><position x="20" y="120" width="600" height="80"/><word><syllabe><start>00:00:00,500</start><end>00:00:43,000</end><text>Synthetic karaoke lyric</text></syllabe></word></line></page></karaoke></root>');
  const audio = await readFile(ogg);
  const media = kit([[1, xml], ...[7, 8, 9, 10, 11].map(id => [id, audio])]), mediaPath = join(dir, 'synthetic.kit'); await writeFile(mediaPath, media);
  const md5 = createHash('md5').update(media).digest('hex');
  await build({ entryPoints: [join(repo, 'src/main/index.ts')], outfile: join(stage, 'main/index.cjs'), bundle: true, platform: 'node', format: 'cjs', target: 'node24', external: ['electron'],
    plugins: [{ name: 'synthetic-account-only', setup(builder) {
      builder.onResolve({ filter: /karafun-account-auth$/ }, () => ({ path: 'synthetic-auth', namespace: 'tpv-qa' }));
      builder.onLoad({ filter: /.*/, namespace: 'tpv-qa' }, () => ({ contents: 'exports.authenticateKaraFunAccount=async()=>({sessionKey:"synthetic-test-session"});', loader: 'js' }));
    } }] });
  await cp(join(repo, 'dist/preload'), join(stage, 'preload'), { recursive: true });
  await cp(join(repo, 'dist/ui'), join(stage, 'ui'), { recursive: true });
  // Instrument only the disposable display bundle to observe real Web Audio
  // gains/source counts. There is no production debug global or account hook.
  const displayHtml = join(stage, 'ui/src/display/index.html');
  await build({ entryPoints: [join(repo, 'src/display/index.ts')], outfile: join(stage, 'ui/assets/native-mix-qa.js'), bundle: true, platform: 'browser', format: 'esm',
    banner: { js: `globalThis.__tpvAudioContexts=[];const NativeContext=globalThis.AudioContext;globalThis.AudioContext=class extends NativeContext {
constructor(...args){super(...args);this.qaGains=[];this.qaSources=[];globalThis.__tpvAudioContexts.push(this);}
createGain(){const gain=super.createGain();this.qaGains.push(gain);return gain;}
createBufferSource(){const source=super.createBufferSource();this.qaSources.push(source);return source;}};` } });
  const originalHtml = await readFile(displayHtml, 'utf8');
  assert.match(originalHtml, /src="[^"]*display-[^"]+\.js"/);
  await writeFile(displayHtml, originalHtml.replace(/src="[^"]*display-[^"]+\.js"/, 'src="../../assets/native-mix-qa.js"'));
  const bootstrap = join(dir, 'bootstrap.cjs');
  await writeFile(bootstrap, `const {app,dialog,ipcMain}=require('electron');const fs=require('node:fs');
app.setPath('userData',process.env.TPV_NATIVE_QA_PROFILE);app.setAppPath(process.env.TPV_NATIVE_QA_REPO);
app.getVersion=()=>JSON.parse(fs.readFileSync(require('node:path').join(process.env.TPV_NATIVE_QA_REPO,'package.json'),'utf8')).version;
if(fs.realpathSync(app.getPath('userData'))!==fs.realpathSync(process.env.TPV_NATIVE_QA_PROFILE))throw Error('Unsafe test profile');
globalThis.nativeQa={authorizations:0,downloads:0,dialogs:[],events:[]};
ipcMain.on('display:event',(_e,value)=>{nativeQa.events.push(value);if(nativeQa.events.length>40)nativeQa.events.shift();});
dialog.showMessageBox=async(_window,options)=>{nativeQa.dialogs.push(options?.message||'');return{response:0}};
globalThis.fetch=async value=>{const url=new URL(String(value));const xml=body=>new Response('<response status="ok">'+body+'</response>',{headers:{'Content-Type':'application/xml'}});
if(url.hostname==='api.karafun.com')switch(url.pathname){
case '/session/info':return xml('<session/>');
case '/search/top':return xml('<list><song id="6229"/></list>');
case '/song/info':return xml('<song id="6229"><title>Synthetic KaraFun Song</title><artist>QA Artist</artist><len>18</len><explicit>0</explicit></song>');
case '/song/request':nativeQa.authorizations++;return xml('<song><stream>https://cdnaws.recis.io/synthetic.kit</stream><md5>${md5}</md5><filesize>${media.length}</filesize></song>');}
if(url.hostname==='cdnaws.recis.io'){nativeQa.downloads++;return new Response(fs.readFileSync(process.env.TPV_NATIVE_QA_MEDIA));}return new Response('Offline test',{status:503});};
require(process.env.TPV_NATIVE_QA_ENTRY);`);
  const env = { ...process.env, TPV_NATIVE_QA_PROFILE: canonicalProfile, TPV_NATIVE_QA_REPO: repo, TPV_NATIVE_QA_MEDIA: mediaPath, TPV_NATIVE_QA_ENTRY: join(stage, 'main/index.cjs'), APPDATA: join(dir, 'appdata'), LOCALAPPDATA: join(dir, 'localappdata'), XDG_CONFIG_HOME: join(dir, 'config'), XDG_DATA_HOME: join(dir, 'data') }; delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({ executablePath: require('electron'), args: [bootstrap, '--user-data-dir=' + canonicalProfile, '--mute-audio'], cwd: repo, env });
  const host = await waitForHostWindow(app); qaHost = host; await host.waitForFunction(() => !!window.tpv?.karaFun);
  app.on('window', page => { page.on('console', message => { if(message.type() === 'error') console.error('Synthetic renderer:',message.text()); }); });
  assert.equal(await realpath(await app.evaluate(({ app }) => app.getPath('userData'))), canonicalProfile);
  assert.equal((await host.evaluate(() => window.tpv.karaFun.status())).state, 'disconnected');
  await host.getByRole('button', { name: 'Sources', exact: true }).click();
  await host.getByRole('button', { name: 'Sign In to KaraFun', exact: true }).click();
  await waitForHostCondition(host, async () => (await window.tpv.karaFun.status()).state === 'connected');
  await host.getByRole('button', { name: 'Library', exact: true }).click();
  await host.getByRole('searchbox', { name: 'Search library' }).fill('synthetic');
  await host.getByRole('option').filter({ hasText: 'Synthetic KaraFun Song' }).dblclick();
  const dialog = host.getByRole('dialog', { name: 'Add to Queue', exact: true });
  await dialog.getByRole('combobox').selectOption('__new__'); await dialog.getByLabel('New singer name').fill('Native QA');
  await dialog.getByRole('button', { name: 'Add to Queue', exact: true }).click();
  await waitForHostCondition(host, async () => (await window.tpv.karaFun.preparations()).some(item => item.phase === 'ready'));
  let show = await host.evaluate(() => window.tpv.getState());
  assert.equal(show.requests.length, 1); assert.equal(show.requests[0].status, 'staged'); assert.equal(show.playback, null); assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter(window => window.webContents.getURL().includes('/display/') && window.isVisible()).length), 0);
  assert.equal(show.versions[0].source.provider, 'karafun'); assert.equal(JSON.stringify(show).includes('synthetic-test-session'), false); assert.equal(JSON.stringify(show).includes('https://'), false);
  assert.equal((await host.evaluate(() => window.tpv.playPause())).ok, true);
  await waitForHostCondition(host, async () => { const timeline = await window.tpv.getTimeline(); return timeline.seekable && timeline.position > .2; }, undefined, {timeout:10000});
  const singer = app.windows().find(page => page !== host); assert.ok(singer);
  assert.equal(await singer.locator('#karafun-lyrics').isVisible(), true);
  show = await host.evaluate(() => window.tpv.getState()); const generation = show.playback.generationId;
  assert.equal(show.playback.status, 'playing');
  const firstMix = await host.evaluate(() => window.tpv.karaFunMix.status());
  assert.deepEqual(firstMix.stems.map(stem => stem.volume), [1, 1, 1, 0, 0]);
  await host.getByRole('button', { name: 'Vocal Mix', exact: true }).click();
  const mixDialog = host.getByRole('dialog', { name: 'Vocal Mix', exact: true });
  assert.equal(await mixDialog.getByRole('slider').count(), 5);
  const sourcesBefore = await singer.evaluate(() => globalThis.__tpvAudioContexts.find(context => context.qaSources.length === 5).qaSources.length);
  await mixDialog.getByRole('slider', { name: 'Lead Vocals 1 · Alice Volume', exact: true }).press('End');
  await mixDialog.getByRole('slider', { name: 'Backing Vocals 1 · High Volume', exact: true }).press('Home');
  await waitForHostCondition(host, async () => { const mix = await window.tpv.karaFunMix.status(); return mix.stems.find(stem => stem.id === 10).volume === 1 && mix.stems.find(stem => stem.id === 8).volume === 0; });
  await host.evaluate(() => window.tpv.saveSettings({ masterVolume: .31 }));
  await singer.waitForFunction(() => { const context = globalThis.__tpvAudioContexts.find(context => context.qaSources.length === 5); return context && Math.abs(context.qaGains[4].gain.value - 1) < .001 && Math.abs(context.qaGains[2].gain.value) < .001; });
  const levels = await singer.evaluate(() => { const context = globalThis.__tpvAudioContexts.find(context => context.qaSources.length === 5); return { levels: context.qaGains.map(node => node.gain.value), sources: context.qaSources.length }; });
  assert.deepEqual(levels.levels.slice(1), [1, 0, 1, 1, 0]); assert.ok(Math.abs(levels.levels[0] - .31) < .001); assert.equal(levels.sources, sourcesBefore);
  assert.equal((await host.evaluate(() => window.tpv.getState())).playback.status, 'playing', 'Mix and volume leave transport playing');
  // Keyboard changes also work when the preview's singer window is hidden.
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('/display/')).close());
  assert.equal((await host.evaluate(() => window.tpv.getState())).playback.status, 'playing', 'Hiding singer display leaves transport playing');
  await mixDialog.getByRole('slider', { name: 'Lead Vocals 2 · Bob Volume', exact: true }).press('End');
  await waitForHostCondition(host, async () => (await window.tpv.karaFunMix.status()).stems.find(stem => stem.id === 11).volume === 1);
  if (process.env.TPV_KARAFUN_QA_SCREENSHOT) await host.screenshot({ path: process.env.TPV_KARAFUN_QA_SCREENSHOT });
  await mixDialog.getByRole('button', { name: 'Done', exact: true }).click();
  assert.equal((await host.evaluate(() => window.tpv.getState())).playback.status, 'playing', 'Closing Vocal Mix leaves transport playing');
  assert.equal((await host.evaluate(() => window.tpv.playPause())).ok, true);
  assert.equal((await host.evaluate(() => window.tpv.getState())).playback.status, 'paused');
  const seek = await host.evaluate(generation => window.tpv.seek({ generation, position: 5 }), generation);
  assert.equal(seek.ok, true, JSON.stringify({ seek, timeline: await host.evaluate(() => window.tpv.getTimeline()), playback: (await host.evaluate(() => window.tpv.getState())).playback }));
  assert.deepEqual((await host.evaluate(() => window.tpv.karaFunMix.status())).stems.map(stem => stem.volume), [1, 0, 1, 1, 1]);
  await host.evaluate(generation => window.tpv.karaFunMix.set({ generation, reset: true }), generation);
  assert.deepEqual((await host.evaluate(() => window.tpv.karaFunMix.status())).stems.map(stem => stem.volume), [1, 1, 1, 0, 0]);
  assert.equal((await host.evaluate(() => window.tpv.restartTrack())).ok, true);
  assert.equal((await host.evaluate(() => window.tpv.playPause())).ok, true);
  await host.evaluate(() => window.tpv.karaFun.signOut());
  assert.equal(await host.evaluate(() => window.tpv.karaFunMix.status()), null);
  assert.equal(await host.evaluate(async generation => { try { await window.tpv.karaFunMix.set({ generation, stemId: 10, volume: 1 }); return false; } catch { return true; } }, generation), true);
  assert.equal((await host.evaluate(() => window.tpv.getState())).playback.status, 'paused');
  assert.equal((await host.evaluate(() => window.tpv.playPause())).ok, false);
  assert.equal(await singer.locator('#waiting').isVisible(), true);
  const counters = await app.evaluate(() => ({ ...globalThis.nativeQa }));
  assert.equal(counters.downloads, 1); assert.ok(counters.authorizations >= 3);
  assert.deepEqual(counters.dialogs, []);
  console.log('Native KaraFun synthetic account → library → queue → five independent duet/backing stems, live gains without restarting, hidden preview, pause/seek/reset/Previous → sign-out fencing passed. No provider or real show was accessed.');
} catch (error) {
  if (qaHost) { await qaHost.screenshot({ path: join(root, 'tpv-karafun-native-failure.png') }).catch(() => {}); console.error((await qaHost.locator('body').ariaSnapshot().catch(() => '')).slice(-10000)); console.error('Events',JSON.stringify(await app.evaluate(()=>globalThis.nativeQa.events))); }
  throw error;
} finally {
  if (app) await app.close().catch(() => {});
  const actual = await realpath(dir); assert.equal(dirname(actual), root); assert.ok(basename(actual).startsWith('tpv-karafun-native-qa-'));
  await rm(actual, { recursive: true, force: true, maxRetries: 8, retryDelay: 300 });
}
